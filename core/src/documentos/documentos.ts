import type { Db } from "../db/tipos";
import { TABELAS } from "../backup/dados";
import { hashDeLancamento } from "../ingest/lancamentos";
import { paraInstanteUTC, somarMeses } from "../parsing/tempo";
import type { Lancamento } from "../domain/types";

export type TipoDocumento = "extrato_conta" | "fatura_cartao" | "comprovante" | "extrato_investimento" | "legado";

export interface NovoDocumento {
  usuario_id: string;
  tipo: TipoDocumento;
  formato: string | null;
  nome: string;
  /** SHA-256 do conteúdo do arquivo (hex). Dois arquivos com o mesmo conteúdo são o mesmo documento. */
  hash_arquivo: string | null;
  cartao_id?: number | null;
  origem?: "manual" | "pasta";
}

/** De onde vem o documento: a tabela `documento` (lançamentos) ou `extrato_investimento` (posições e movimentos). */
export type FonteDocumento = "documento" | "extrato_investimento";
export interface RefDocumento {
  fonte: FonteDocumento;
  id: number;
}

export interface DocumentoRegistrado {
  fonte: FonteDocumento;
  id: number;
  nome: string;
  importado_em: string;
}

export interface RelatorioDoDocumento {
  lidos: number;
  criados: number;
  mesclados: number;
  ja_processados: number;
  periodo: { de: string; ate: string } | null;
}

const agoraISO = () => new Date().toISOString();

export function registrarDocumento(db: Db, d: NovoDocumento): number {
  const info = db
    .prepare("INSERT INTO documento (usuario_id, tipo, formato, nome, hash_arquivo, cartao_id, origem, importado_em) VALUES (?,?,?,?,?,?,?,?)")
    .run(d.usuario_id, d.tipo, d.formato, d.nome.slice(0, 200), d.hash_arquivo, d.cartao_id ?? null, d.origem ?? "manual", agoraISO());
  return Number(info.lastInsertRowid);
}

/** Documento já importado com este conteúdo (arquivo de lançamentos ou extrato de investimento), se houver. */
export function documentoPorHash(db: Db, usuarioId: string, hash: string): DocumentoRegistrado | undefined {
  const d = db.prepare("SELECT id, nome, importado_em FROM documento WHERE usuario_id = ? AND hash_arquivo = ?").get(usuarioId, hash) as { id: number; nome: string; importado_em: string } | undefined;
  if (d) return { fonte: "documento", ...d };
  const e = db.prepare("SELECT id, instituicao, conta, periodo_fim, importado_em FROM extrato_investimento WHERE usuario_id = ? AND hash_arquivo = ?").get(usuarioId, hash) as { id: number; instituicao: string; conta: string; periodo_fim: string; importado_em: string } | undefined;
  if (e) return { fonte: "extrato_investimento", id: e.id, nome: nomeDoExtrato(e), importado_em: e.importado_em };
  return undefined;
}

function nomeDoExtrato(e: { instituicao: string; conta: string; periodo_fim: string }): string {
  return `Extrato de investimentos ${e.instituicao}${e.conta ? ` (conta final ${e.conta.slice(-4)})` : ""}, ${e.periodo_fim.slice(0, 7)}`;
}

/** Fecha o registro do documento com o resultado da leitura. Um documento que não trouxe nada novo nem repetido é descartado. */
export function concluirDocumento(db: Db, id: number, rel: RelatorioDoDocumento): void {
  db.prepare("UPDATE documento SET lidos = ?, criados = ?, mesclados = ?, ja_processados = ?, periodo_inicio = ?, periodo_fim = ? WHERE id = ?").run(
    rel.lidos, rel.criados, rel.mesclados, rel.ja_processados, rel.periodo?.de ?? null, rel.periodo?.ate ?? null, id,
  );
  const v = versaoAnterior(db, id);
  if (v) db.prepare("UPDATE documento SET versao_de = ? WHERE id = ?").run(v.documento_id, id);
}

/** Descarta o registro de um documento cuja leitura falhou (nada foi gravado), liberando o arquivo para nova tentativa. */
export function descartarDocumento(db: Db, id: number): void {
  const n = (db.prepare("SELECT COUNT(*) c FROM lancamento_origem WHERE documento_id = ?").get(id) as { c: number }).c;
  if (n === 0) db.prepare("DELETE FROM documento WHERE id = ?").run(id);
}

export interface VersaoAnterior {
  documento_id: number;
  nome: string;
  importado_em: string;
  /** Lançamentos do documento novo que já existiam por causa desse documento anterior. */
  compartilhados: number;
}

/**
 * O documento parece uma nova versão de outro já importado (mesmo extrato ou fatura exportado de novo, com itens a mais ou a menos)?
 * Sim quando a maior parte dos lançamentos dele já existia por causa de um mesmo documento anterior. Os itens repetidos não são
 * contados duas vezes: cada lançamento existe uma vez só.
 */
export function versaoAnterior(db: Db, documentoId: number): VersaoAnterior | null {
  const doc = db.prepare("SELECT lidos FROM documento WHERE id = ?").get(documentoId) as { lidos: number } | undefined;
  const linha = db
    .prepare(
      `SELECT d.id documento_id, d.nome, d.importado_em, COUNT(DISTINCT o.lancamento_id) compartilhados
       FROM lancamento_origem o JOIN documento d ON d.id = o.documento_id
       WHERE o.documento_id != ? AND d.tipo != 'legado' AND o.lancamento_id IN (SELECT lancamento_id FROM lancamento_origem WHERE documento_id = ?)
       GROUP BY d.id ORDER BY compartilhados DESC LIMIT 1`,
    )
    .get(documentoId, documentoId) as VersaoAnterior | undefined;
  if (!linha || !doc) return null;
  return linha.compartilhados >= Math.max(2, Math.ceil(doc.lidos * 0.5)) ? linha : null;
}

export interface DocumentoListado {
  fonte: FonteDocumento;
  id: number;
  tipo: TipoDocumento;
  nome: string;
  formato: string | null;
  cartao: string | null;
  origem: string;
  importado_em: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  /** Lançamentos ligados ao documento (todos os meses) e, se pedido um mês, quantos caem nele. */
  lancamentos: number;
  lancamentos_no_mes: number | null;
  saidas_centavos: number;
  entradas_centavos: number;
  /** Só extratos de investimento. */
  posicoes: number;
  versao_de: number | null;
  /** Mês (AAAA-MM) do primeiro lançamento do documento, ou do fim do período do extrato: base para mover o documento de mês. */
  mes_referencia: string | null;
}

/** Documentos do usuário; com `mes`, só os que têm lançamentos nesse mês (ou extrato de investimento do mês). */
export function listarDocumentos(db: Db, usuarioId: string, filtro: { mes?: string } = {}): DocumentoListado[] {
  const mes = filtro.mes ?? null;
  const docs = db
    .prepare(
      `SELECT d.*, c.apelido cartao,
         (SELECT COUNT(DISTINCT o.lancamento_id) FROM lancamento_origem o WHERE o.documento_id = d.id) lancamentos,
         (SELECT MIN(substr(l.data_local,1,7)) FROM lancamento l WHERE l.id IN (SELECT lancamento_id FROM lancamento_origem WHERE documento_id = d.id)) mes_ref,
         (SELECT COUNT(DISTINCT o.lancamento_id) FROM lancamento_origem o JOIN lancamento l ON l.id = o.lancamento_id WHERE o.documento_id = d.id AND (? IS NULL OR substr(l.data_local,1,7) = ?)) no_mes,
         (SELECT COALESCE(SUM(l.valor_centavos),0) FROM lancamento l WHERE l.status != 'cancelado' AND l.tipo = 'despesa' AND (? IS NULL OR substr(l.data_local,1,7) = ?) AND l.id IN (SELECT lancamento_id FROM lancamento_origem WHERE documento_id = d.id)) saidas,
         (SELECT COALESCE(SUM(l.valor_centavos),0) FROM lancamento l WHERE l.status != 'cancelado' AND l.tipo = 'receita' AND (? IS NULL OR substr(l.data_local,1,7) = ?) AND l.id IN (SELECT lancamento_id FROM lancamento_origem WHERE documento_id = d.id)) entradas
       FROM documento d LEFT JOIN cartao c ON c.id = d.cartao_id WHERE d.usuario_id = ? ORDER BY d.importado_em DESC, d.id DESC`,
    )
    .all(mes, mes, mes, mes, mes, mes, usuarioId) as (Record<string, unknown> & { id: number; tipo: TipoDocumento; nome: string; formato: string | null; cartao: string | null; origem: string; importado_em: string; periodo_inicio: string | null; periodo_fim: string | null; versao_de: number | null; lancamentos: number; mes_ref: string | null; no_mes: number; saidas: number; entradas: number })[];
  const saida: DocumentoListado[] = docs
    .filter((d) => mes === null || d.no_mes > 0)
    .map((d) => ({
      fonte: "documento", id: d.id, tipo: d.tipo, nome: d.nome, formato: d.formato, cartao: d.cartao, origem: d.origem, importado_em: d.importado_em,
      periodo_inicio: d.periodo_inicio, periodo_fim: d.periodo_fim, lancamentos: d.lancamentos, lancamentos_no_mes: mes === null ? null : d.no_mes,
      saidas_centavos: d.saidas, entradas_centavos: d.entradas, posicoes: 0, versao_de: d.versao_de, mes_referencia: d.mes_ref,
    }));
  const extratos = db
    .prepare("SELECT e.*, (SELECT COUNT(*) FROM posicao_investimento p WHERE p.extrato_id = e.id) posicoes FROM extrato_investimento e WHERE e.usuario_id = ? ORDER BY e.importado_em DESC, e.id DESC")
    .all(usuarioId) as { id: number; instituicao: string; conta: string; periodo_inicio: string; periodo_fim: string; importado_em: string; posicoes: number }[];
  for (const e of extratos) {
    if (mes !== null && e.periodo_fim.slice(0, 7) !== mes) continue;
    saida.push({
      fonte: "extrato_investimento", id: e.id, tipo: "extrato_investimento", nome: nomeDoExtrato(e), formato: "pdf", cartao: null, origem: "manual", importado_em: e.importado_em,
      periodo_inicio: e.periodo_inicio, periodo_fim: e.periodo_fim, lancamentos: 0, lancamentos_no_mes: mes === null ? null : 0, saidas_centavos: 0, entradas_centavos: 0, posicoes: e.posicoes, versao_de: null, mes_referencia: e.periodo_fim.slice(0, 7),
    });
  }
  return saida.sort((a, b) => (a.importado_em < b.importado_em ? 1 : -1));
}

/** Lançamentos manuais (digitados, mensagens, recorrências) do mês, que não vieram de nenhum arquivo. */
export function resumoDeManuaisDoMes(db: Db, usuarioId: string, mes: string): { quantidade: number; saidas_centavos: number; entradas_centavos: number } {
  const r = db
    .prepare(
      `SELECT COUNT(*) q, COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor_centavos ELSE 0 END),0) s, COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor_centavos ELSE 0 END),0) e FROM lancamento l
       WHERE usuario_id = ? AND status != 'cancelado' AND substr(data_local,1,7) = ? AND NOT EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = l.id AND o.documento_id IS NOT NULL)`,
    )
    .get(usuarioId, mes) as { q: number; s: number; e: number };
  return { quantidade: r.q, saidas_centavos: r.s, entradas_centavos: r.e };
}

/** Remove lançamentos de vez (e o que dependem deles). Parcelas previstas que ficaram sem a compra real também saem. */
function removerLancamentos(db: Db, ids: number[]): number {
  let n = 0;
  for (const id of ids) {
    db.prepare("UPDATE lancamento SET possivel_duplicado_de = NULL WHERE possivel_duplicado_de = ?").run(id);
    db.prepare("DELETE FROM lancamento_origem WHERE lancamento_id = ?").run(id);
    db.prepare("DELETE FROM auditoria WHERE lancamento_id = ?").run(id);
    n += db.prepare("DELETE FROM lancamento WHERE id = ?").run(id).changes;
  }
  if (n > 0) removerParcelasPrevistasOrfas(db);
  return n;
}

function removerParcelasPrevistasOrfas(db: Db): void {
  const orfas = db
    .prepare(
      `SELECT p.id FROM lancamento p
       WHERE EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = p.id AND o.origem = 'parcela_prevista')
         AND NOT EXISTS (SELECT 1 FROM lancamento_origem o2 WHERE o2.lancamento_id = p.id AND o2.origem != 'parcela_prevista')
         AND NOT EXISTS (SELECT 1 FROM lancamento r WHERE r.id != p.id AND r.usuario_id = p.usuario_id AND r.estabelecimento_norm = p.estabelecimento_norm AND r.parcela_total = p.parcela_total
                         AND r.cartao_id IS p.cartao_id AND NOT EXISTS (SELECT 1 FROM lancamento_origem o3 WHERE o3.lancamento_id = r.id AND o3.origem = 'parcela_prevista' AND NOT EXISTS (SELECT 1 FROM lancamento_origem o4 WHERE o4.lancamento_id = r.id AND o4.origem != 'parcela_prevista')))`,
    )
    .all() as { id: number }[];
  for (const o of orfas) {
    db.prepare("DELETE FROM lancamento_origem WHERE lancamento_id = ?").run(o.id);
    db.prepare("DELETE FROM auditoria WHERE lancamento_id = ?").run(o.id);
    db.prepare("DELETE FROM lancamento WHERE id = ?").run(o.id);
  }
}

/** Tabelas (além de `extrato_investimento`) que guardam dados de um extrato de investimento, identificadas pela coluna `extrato_id`. */
function tabelasDoExtrato(db: Db): string[] {
  return TABELAS.filter((t) => t !== "extrato_investimento" && (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((c) => c.name === "extrato_id"));
}

export interface ResultadoExclusao {
  lancamentos_removidos: number;
  lancamentos_mantidos: number;
}

/**
 * Exclui o documento e o que veio só dele. Um lançamento que também veio de outro arquivo (ou foi digitado) continua, ligado
 * às outras origens. Excluir libera o arquivo para ser importado de novo.
 */
export function excluirDocumento(db: Db, usuarioId: string, ref: RefDocumento): ResultadoExclusao {
  let res: ResultadoExclusao = { lancamentos_removidos: 0, lancamentos_mantidos: 0 };
  const tx = db.transaction(() => {
    if (ref.fonte === "extrato_investimento") {
      if (!db.prepare("SELECT 1 FROM extrato_investimento WHERE id = ? AND usuario_id = ?").get(ref.id, usuarioId)) throw new Error("Documento não encontrado.");
      for (const t of tabelasDoExtrato(db)) db.prepare(`DELETE FROM ${t} WHERE extrato_id = ?`).run(ref.id);
      db.prepare("DELETE FROM extrato_investimento WHERE id = ? AND usuario_id = ?").run(ref.id, usuarioId);
      return;
    }
    if (!db.prepare("SELECT 1 FROM documento WHERE id = ? AND usuario_id = ?").get(ref.id, usuarioId)) throw new Error("Documento não encontrado.");
    const ids = (db.prepare("SELECT DISTINCT lancamento_id id FROM lancamento_origem WHERE documento_id = ?").all(ref.id) as { id: number }[]).map((r) => r.id);
    db.prepare("DELETE FROM lancamento_origem WHERE documento_id = ?").run(ref.id);
    const sozinhos = ids.filter((id) => !db.prepare("SELECT 1 FROM lancamento_origem WHERE lancamento_id = ?").get(id));
    res = { lancamentos_removidos: removerLancamentos(db, sozinhos), lancamentos_mantidos: ids.length - sozinhos.length };
    db.prepare("DELETE FROM documento WHERE id = ?").run(ref.id);
  });
  tx();
  return res;
}

function recalcularData(db: Db, l: Lancamento, novaData: string): void {
  const hash = hashDeLancamento({ ...l, data_local: novaData });
  db.prepare("UPDATE lancamento SET data_local = ?, ocorrido_em = ?, hash_dedup = ?, atualizado_em = ? WHERE id = ?").run(novaData, paraInstanteUTC(novaData, l.hora_local), hash, agoraISO(), l.id);
}

/** Diferença em meses entre dois meses AAAA-MM (destino menos origem). */
export function diferencaDeMeses(de: string, para: string): number {
  const [a1, m1] = de.split("-").map(Number) as [number, number];
  const [a2, m2] = para.split("-").map(Number) as [number, number];
  return a2 * 12 + m2 - (a1 * 12 + m1);
}

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Soma meses a uma data; se era o último dia do mês, continua sendo o último dia do mês de destino. */
function deslocarData(data: string, meses: number): string {
  const [a, m, d] = data.split("-").map(Number) as [number, number, number];
  const ultimoOrigem = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const r = somarMeses(data, meses);
  if (d !== ultimoOrigem) return r;
  const [ar, mr] = r.split("-").map(Number) as [number, number];
  return `${ar}-${String(mr).padStart(2, "0")}-${String(new Date(Date.UTC(ar, mr, 0)).getUTCDate()).padStart(2, "0")}`;
}

export interface ResultadoMudanca {
  lancamentos_movidos: number;
  /** Lançamentos que também vieram de outro arquivo e por isso ficaram onde estavam. */
  lancamentos_mantidos: number;
}

/**
 * Desloca o documento `deltaMeses` meses (para uma fatura ou extrato subido no mês errado), mantendo o intervalo entre as datas.
 * Lançamentos que também vieram de outro arquivo (ou foram digitados) não se movem.
 */
export function moverDocumento(db: Db, usuarioId: string, ref: RefDocumento, deltaMeses: number): ResultadoMudanca {
  if (!Number.isInteger(deltaMeses) || Math.abs(deltaMeses) > 600) throw new Error("Deslocamento inválido.");
  const res: ResultadoMudanca = { lancamentos_movidos: 0, lancamentos_mantidos: 0 };
  if (deltaMeses === 0) return res;
  const tx = db.transaction(() => {
    if (ref.fonte === "extrato_investimento") {
      const e = db.prepare("SELECT * FROM extrato_investimento WHERE id = ? AND usuario_id = ?").get(ref.id, usuarioId) as { id: number; instituicao: string; conta: string; moeda: string; periodo_inicio: string; periodo_fim: string } | undefined;
      if (!e) throw new Error("Documento não encontrado.");
      const paraMes = deslocarData(e.periodo_fim, deltaMeses).slice(0, 7);
      const conflito = db
        .prepare("SELECT id FROM extrato_investimento WHERE usuario_id = ? AND id != ? AND instituicao = ? AND conta = ? AND moeda = ? AND substr(periodo_fim,1,7) = ?")
        .get(usuarioId, e.id, e.instituicao, e.conta, e.moeda, paraMes);
      if (conflito) throw new Error(`Já existe um extrato desta conta em ${paraMes}. Exclua-o antes de mover este.`);
      db.prepare("UPDATE extrato_investimento SET periodo_inicio = ?, periodo_fim = ? WHERE id = ?").run(deslocarData(e.periodo_inicio, deltaMeses), deslocarData(e.periodo_fim, deltaMeses), e.id);
      for (const t of tabelasDoExtrato(db)) {
        const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
        if (cols.includes("mes")) for (const r of db.prepare(`SELECT id, mes FROM ${t} WHERE extrato_id = ?`).all(e.id) as { id: number; mes: string }[]) db.prepare(`UPDATE ${t} SET mes = ? WHERE id = ?`).run(deslocarData(`${r.mes}-01`, deltaMeses).slice(0, 7), r.id);
        if (cols.includes("data_local")) for (const r of db.prepare(`SELECT id, data_local FROM ${t} WHERE extrato_id = ?`).all(e.id) as { id: number; data_local: string }[]) db.prepare(`UPDATE ${t} SET data_local = ? WHERE id = ?`).run(deslocarData(r.data_local, deltaMeses), r.id);
      }
      return;
    }
    const d = db.prepare("SELECT * FROM documento WHERE id = ? AND usuario_id = ?").get(ref.id, usuarioId) as { id: number; periodo_inicio: string | null; periodo_fim: string | null } | undefined;
    if (!d) throw new Error("Documento não encontrado.");
    const ls = db.prepare("SELECT l.* FROM lancamento l WHERE l.id IN (SELECT lancamento_id FROM lancamento_origem WHERE documento_id = ?)").all(ref.id) as Lancamento[];
    for (const l of ls) {
      const outros = (db.prepare("SELECT COUNT(*) c FROM lancamento_origem WHERE lancamento_id = ? AND (documento_id IS NULL OR documento_id != ?)").get(l.id, ref.id) as { c: number }).c;
      if (outros > 0) { res.lancamentos_mantidos++; continue; }
      recalcularData(db, l, deslocarData(l.data_local, deltaMeses));
      res.lancamentos_movidos++;
    }
    if (d.periodo_inicio) db.prepare("UPDATE documento SET periodo_inicio = ?, periodo_fim = ? WHERE id = ?").run(deslocarData(d.periodo_inicio, deltaMeses), d.periodo_fim ? deslocarData(d.periodo_fim, deltaMeses) : null, d.id);
  });
  tx();
  return res;
}

export type EscopoDoMes = "tudo" | "documentos" | "manuais" | "investimentos";

function idsDoMes(db: Db, usuarioId: string, mes: string, escopo: EscopoDoMes): number[] {
  if (escopo === "investimentos") return [];
  const filtro = escopo === "documentos" ? "AND EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = l.id AND o.documento_id IS NOT NULL)" : escopo === "manuais" ? "AND NOT EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = l.id AND o.documento_id IS NOT NULL)" : "";
  return (db.prepare(`SELECT l.id FROM lancamento l WHERE l.usuario_id = ? AND substr(l.data_local,1,7) = ? ${filtro}`).all(usuarioId, mes) as { id: number }[]).map((r) => r.id);
}

export interface PreviaDoMes {
  lancamentos: number;
  extratos_investimento: number;
}

/** O que cada ação sobre o mês alcançaria (para o usuário conferir antes de confirmar). */
export function previaDoMes(db: Db, usuarioId: string, mes: string, escopo: EscopoDoMes): PreviaDoMes {
  const extratos = escopo === "tudo" || escopo === "investimentos" ? (db.prepare("SELECT COUNT(*) c FROM extrato_investimento WHERE usuario_id = ? AND substr(periodo_fim,1,7) = ?").get(usuarioId, mes) as { c: number }).c : 0;
  return { lancamentos: idsDoMes(db, usuarioId, mes, escopo).length, extratos_investimento: extratos };
}

/** Exclui de vez o que o escopo escolhido alcança no mês. Documentos que ficarem sem nenhum lançamento são removidos do registro. */
export function excluirMes(db: Db, usuarioId: string, mes: string, escopo: EscopoDoMes): PreviaDoMes {
  if (!MES.test(mes)) throw new Error("Mês inválido (use AAAA-MM).");
  let res: PreviaDoMes = { lancamentos: 0, extratos_investimento: 0 };
  const tx = db.transaction(() => {
    res.lancamentos = removerLancamentos(db, idsDoMes(db, usuarioId, mes, escopo));
    if (escopo === "tudo" || escopo === "investimentos") {
      for (const e of db.prepare("SELECT id FROM extrato_investimento WHERE usuario_id = ? AND substr(periodo_fim,1,7) = ?").all(usuarioId, mes) as { id: number }[]) {
        excluirDocumento(db, usuarioId, { fonte: "extrato_investimento", id: e.id });
        res.extratos_investimento++;
      }
    }
    limparDocumentosVazios(db, usuarioId);
  });
  tx();
  return res;
}

/** Passa o que o escopo alcança em `mes` para `paraMes` (por exemplo, uma fatura ou um mês lançado com a data errada). */
export function moverMes(db: Db, usuarioId: string, mes: string, paraMes: string, escopo: EscopoDoMes): PreviaDoMes {
  if (!MES.test(mes) || !MES.test(paraMes)) throw new Error("Mês inválido (use AAAA-MM).");
  if (mes === paraMes) throw new Error("Escolha um mês diferente.");
  const delta = diferencaDeMeses(mes, paraMes);
  const res: PreviaDoMes = { lancamentos: 0, extratos_investimento: 0 };
  const tx = db.transaction(() => {
    for (const id of idsDoMes(db, usuarioId, mes, escopo)) {
      const l = db.prepare("SELECT * FROM lancamento WHERE id = ?").get(id) as Lancamento;
      recalcularData(db, l, deslocarData(l.data_local, delta));
      res.lancamentos++;
    }
    if (escopo === "tudo" || escopo === "investimentos") {
      for (const e of db.prepare("SELECT id FROM extrato_investimento WHERE usuario_id = ? AND substr(periodo_fim,1,7) = ?").all(usuarioId, mes) as { id: number }[]) {
        moverDocumento(db, usuarioId, { fonte: "extrato_investimento", id: e.id }, delta);
        res.extratos_investimento++;
      }
    }
  });
  tx();
  return res;
}

function limparDocumentosVazios(db: Db, usuarioId: string): void {
  db.prepare("DELETE FROM documento WHERE usuario_id = ? AND NOT EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.documento_id = documento.id)").run(usuarioId);
}

export type EscopoApagar = "movimentacoes" | "tudo";

/** Tabelas apagadas ao zerar só as movimentações (lançamentos, arquivos e extratos), mantendo cartões, regras aprendidas, orçamento e metas. */
const TABELAS_DE_MOVIMENTACAO = ["auditoria", "lancamento_origem", "lancamento", "documento", "arquivo_pasta", "posicao_investimento", "movimento_investimento", "extrato_investimento", "mensagem_processada"];

/**
 * Apaga dados de vez. "movimentacoes": lançamentos, documentos e extratos de investimento (mantém cartões, regras de classificação,
 * orçamento, metas, eventos e recorrências). "tudo": todas as tabelas. A confirmação do usuário é responsabilidade de quem chama.
 */
export function apagarDados(db: Db, escopo: EscopoApagar): { linhas: number } {
  let linhas = 0;
  const tx = db.transaction(() => {
    const todas = [...TABELAS].reverse() as string[];
    const alvo = escopo === "tudo" ? todas : todas.filter((t) => TABELAS_DE_MOVIMENTACAO.includes(t) || tabelasDoExtrato(db).includes(t));
    // eventos e recorrencias ficam quando so as movimentacoes sao apagadas
    for (const t of alvo) linhas += db.prepare(`DELETE FROM ${t}`).run().changes;
  });
  tx();
  return { linhas };
}
