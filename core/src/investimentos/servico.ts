import type { Db } from "../db/tipos";
import { mapaCadastro } from "./cadastro";
import { chaveDoAtivo } from "./dicionario";
import { CLASSES_ATIVO, ROTULO_CLASSE, type ClasseAtivo, type DetalhePosicao, type ExtratoLido, type Moeda, type TipoMovimento } from "./tipos";

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

function validarMes(mes: string): void {
  if (!RE_MES.test(mes)) throw new Error("mês inválido (use AAAA-MM)");
}

/** Soma `delta` meses a um AAAA-MM. */
function deslocar(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const idx = a * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMesPt = (mes: string): string => `${MESES_PT[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`;

/** Arredondamento simetrico em torno de zero. */
const arred = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

export const NOTA_ESTIMATIVA = "estimativa: variação menos aportes registrados nos extratos";

// ---------------------------------------------------------------------------------------------
// Gravacao
// ---------------------------------------------------------------------------------------------

export type ResultadoSalvarExtrato =
  | { status: "salvo"; extrato_id: number; posicoes: number; movimentos: number; substituidas: number }
  | { status: "ja_importado"; extrato_id: number };

/**
 * Grava um extrato lido. Idempotente pelo hash do arquivo. Um novo extrato da mesma conta e do mesmo mes substitui as
 * posicoes anteriores desse mes e conta; extratos anteriores do mesmo periodo exato saem por inteiro (com seus movimentos).
 */
export function salvarExtrato(db: Db, usuarioId: string, e: ExtratoLido, hashArquivo: string): ResultadoSalvarExtrato {
  if (!hashArquivo.trim()) throw new Error("hash do arquivo obrigatório");
  if (e.posicoes.length === 0) throw new Error("extrato sem posições");
  const mes = e.periodo_fim.slice(0, 7);
  validarMes(mes);
  const agora = new Date().toISOString();
  return db.transaction((): ResultadoSalvarExtrato => {
    const ja = db.prepare("SELECT id FROM extrato_investimento WHERE usuario_id = ? AND hash_arquivo = ?").get(usuarioId, hashArquivo) as { id: number } | undefined;
    if (ja) return { status: "ja_importado", extrato_id: ja.id };

    const iguais = db
      .prepare("SELECT id FROM extrato_investimento WHERE usuario_id = ? AND instituicao = ? AND conta = ? AND moeda = ? AND periodo_inicio = ? AND periodo_fim = ?")
      .all(usuarioId, e.instituicao, e.conta, e.moeda, e.periodo_inicio, e.periodo_fim) as { id: number }[];
    let substituidas = 0;
    for (const x of iguais) {
      db.prepare("DELETE FROM movimento_investimento WHERE extrato_id = ?").run(x.id);
      substituidas += db.prepare("DELETE FROM posicao_investimento WHERE extrato_id = ?").run(x.id).changes;
      db.prepare("DELETE FROM extrato_investimento WHERE id = ?").run(x.id);
    }
    const sub = db
      .prepare("DELETE FROM posicao_investimento WHERE usuario_id = ? AND mes = ? AND instituicao = ? AND conta = ? AND moeda = ? AND origem = 'extrato'")
      .run(usuarioId, mes, e.instituicao, e.conta, e.moeda);

    const r = db
      .prepare("INSERT INTO extrato_investimento (usuario_id, instituicao, conta, moeda, periodo_inicio, periodo_fim, hash_arquivo, total_declarado_centavos, importado_em, distribuicao_setorial_json) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(usuarioId, e.instituicao, e.conta, e.moeda, e.periodo_inicio, e.periodo_fim, hashArquivo, e.total_declarado_centavos, agora, e.distribuicao_setorial && e.distribuicao_setorial.length > 0 ? JSON.stringify(e.distribuicao_setorial) : null);
    const id = Number(r.lastInsertRowid);
    const insPos = db.prepare(
      "INSERT INTO posicao_investimento (usuario_id, extrato_id, mes, instituicao, conta, classe_ativo, ativo, codigo, quantidade, moeda, valor_centavos, origem, criada_em, especie, cnpj, preco_fechamento, preco_medio, custo_total_centavos, detalhe_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,'extrato',?,?,?,?,?,?,?)",
    );
    for (const p of e.posicoes) {
      insPos.run(
        usuarioId, id, mes, e.instituicao, e.conta, p.classe_ativo, p.ativo, p.codigo, p.quantidade, e.moeda, p.valor_centavos, agora,
        p.especie ?? null, p.cnpj ?? null, p.preco_fechamento ?? null, p.preco_medio != null && p.preco_medio > 0 ? p.preco_medio : null, p.custo_total_centavos ?? null,
        p.detalhe && Object.keys(p.detalhe).length > 0 ? JSON.stringify(p.detalhe) : null,
      );
    }
    const insMov = db.prepare("INSERT INTO movimento_investimento (usuario_id, extrato_id, data_local, instituicao, conta, tipo, descricao, codigo, moeda, valor_centavos, em_transito, quantidade, preco) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const m of e.movimentos) insMov.run(usuarioId, id, m.data_local, e.instituicao, e.conta, m.tipo, m.descricao, m.codigo, e.moeda, m.valor_centavos, m.em_transito ? 1 : 0, m.quantidade ?? null, m.preco ?? null);
    return { status: "salvo", extrato_id: id, posicoes: e.posicoes.length, movimentos: e.movimentos.length, substituidas: substituidas + sub.changes };
  })();
}

export function extratoJaImportado(db: Db, usuarioId: string, hashArquivo: string): boolean {
  return !!db.prepare("SELECT 1 FROM extrato_investimento WHERE usuario_id = ? AND hash_arquivo = ?").get(usuarioId, hashArquivo);
}

export interface ExtratoSalvo {
  id: number;
  instituicao: string;
  conta: string;
  moeda: Moeda;
  periodo_inicio: string;
  periodo_fim: string;
  total_declarado_centavos: number | null;
  soma_posicoes_centavos: number;
  posicoes: number;
  movimentos: number;
  importado_em: string;
}

export function listarExtratos(db: Db, usuarioId: string): ExtratoSalvo[] {
  return db
    .prepare(
      `SELECT e.id, e.instituicao, e.conta, e.moeda, e.periodo_inicio, e.periodo_fim, e.total_declarado_centavos, e.importado_em,
              COALESCE((SELECT SUM(valor_centavos) FROM posicao_investimento p WHERE p.extrato_id = e.id), 0) AS soma_posicoes_centavos,
              (SELECT COUNT(*) FROM posicao_investimento p WHERE p.extrato_id = e.id) AS posicoes,
              (SELECT COUNT(*) FROM movimento_investimento m WHERE m.extrato_id = e.id) AS movimentos
         FROM extrato_investimento e WHERE e.usuario_id = ? ORDER BY e.periodo_fim DESC, e.id DESC`,
    )
    .all(usuarioId) as ExtratoSalvo[];
}

/** Remove um extrato importado com suas posicoes e movimentos. */
export function removerExtrato(db: Db, usuarioId: string, extratoId: number): boolean {
  return db.transaction(() => {
    const x = db.prepare("SELECT id FROM extrato_investimento WHERE id = ? AND usuario_id = ?").get(extratoId, usuarioId);
    if (!x) return false;
    db.prepare("DELETE FROM movimento_investimento WHERE extrato_id = ? AND usuario_id = ?").run(extratoId, usuarioId);
    db.prepare("DELETE FROM posicao_investimento WHERE extrato_id = ? AND usuario_id = ?").run(extratoId, usuarioId);
    db.prepare("DELETE FROM extrato_investimento WHERE id = ? AND usuario_id = ?").run(extratoId, usuarioId);
    return true;
  })();
}

export interface PosicaoManual {
  mes: string;
  instituicao: string;
  classe_ativo: ClasseAtivo;
  ativo: string;
  valor_centavos: number;
  moeda?: Moeda;
  codigo?: string | null;
  quantidade?: number | null;
  especie?: string | null;
}

export function adicionarPosicaoManual(db: Db, usuarioId: string, p: PosicaoManual): number {
  validarMes(p.mes);
  if (!p.instituicao.trim()) throw new Error("instituição obrigatória");
  if (!p.ativo.trim()) throw new Error("descrição obrigatória");
  if (!(CLASSES_ATIVO as readonly string[]).includes(p.classe_ativo)) throw new Error("classe de ativo inválida");
  if (!Number.isInteger(p.valor_centavos) || p.valor_centavos === 0) throw new Error("valor inválido");
  const moeda = p.moeda ?? "BRL";
  if (moeda !== "BRL" && moeda !== "USD") throw new Error("moeda inválida");
  const r = db
    .prepare("INSERT INTO posicao_investimento (usuario_id, extrato_id, mes, instituicao, conta, classe_ativo, ativo, codigo, quantidade, moeda, valor_centavos, origem, criada_em, especie) VALUES (?,NULL,?,?,'',?,?,?,?,?,?,'manual',?,?)")
    .run(usuarioId, p.mes, p.instituicao.trim(), p.classe_ativo, p.ativo.trim(), p.codigo ?? null, p.quantidade ?? null, moeda, p.valor_centavos, new Date().toISOString(), p.especie?.trim() || null);
  return Number(r.lastInsertRowid);
}

/** Remove uma posicao manual. Posicao vinda de extrato so sai com o extrato (ou substituida por outro do mesmo mes). */
export function removerPosicao(db: Db, usuarioId: string, id: number): boolean {
  const p = db.prepare("SELECT origem FROM posicao_investimento WHERE id = ? AND usuario_id = ?").get(id, usuarioId) as { origem: string } | undefined;
  if (!p) return false;
  if (p.origem !== "manual") throw new Error("Esta posição veio de um extrato: remova o extrato inteiro ou importe o extrato corrigido do mesmo mês.");
  return db.prepare("DELETE FROM posicao_investimento WHERE id = ? AND usuario_id = ?").run(id, usuarioId).changes > 0;
}

// ---------------------------------------------------------------------------------------------
// Cambio
// ---------------------------------------------------------------------------------------------

export interface CambioMes {
  mes: string;
  moeda: string;
  /** Reais por unidade da moeda, com 4 casas (ex.: 5,4321). */
  taxa: number;
  taxa_x10000: number;
}

export function definirCambio(db: Db, usuarioId: string, mes: string, moeda: string, taxa: number): void {
  validarMes(mes);
  if (moeda === "BRL" || !/^[A-Z]{3}$/.test(moeda)) throw new Error("moeda inválida");
  if (!Number.isFinite(taxa) || taxa <= 0 || taxa > 1000) throw new Error("taxa de câmbio inválida");
  db.prepare("INSERT INTO cambio (usuario_id, mes, moeda, taxa_x10000) VALUES (?,?,?,?) ON CONFLICT (usuario_id, mes, moeda) DO UPDATE SET taxa_x10000 = excluded.taxa_x10000").run(usuarioId, mes, moeda, Math.round(taxa * 10000));
}

export function removerCambio(db: Db, usuarioId: string, mes: string, moeda: string): boolean {
  return db.prepare("DELETE FROM cambio WHERE usuario_id = ? AND mes = ? AND moeda = ?").run(usuarioId, mes, moeda).changes > 0;
}

export function listarCambios(db: Db, usuarioId: string): CambioMes[] {
  const rows = db.prepare("SELECT mes, moeda, taxa_x10000 FROM cambio WHERE usuario_id = ? ORDER BY mes DESC, moeda").all(usuarioId) as { mes: string; moeda: string; taxa_x10000: number }[];
  return rows.map((r) => ({ ...r, taxa: r.taxa_x10000 / 10000 }));
}

interface TaxaUsada {
  taxa_x10000: number;
  mes_taxa: string;
}

/** Taxa do mes pedido ou, na falta, a ultima conhecida ate ele; null se nao houver nenhuma. */
function taxaAte(db: Db, usuarioId: string, moeda: string, mes: string): TaxaUsada | null {
  const r = db.prepare("SELECT taxa_x10000, mes AS mes_taxa FROM cambio WHERE usuario_id = ? AND moeda = ? AND mes <= ? ORDER BY mes DESC LIMIT 1").get(usuarioId, moeda, mes) as TaxaUsada | undefined;
  return r ?? null;
}

// ---------------------------------------------------------------------------------------------
// Patrimonio
// ---------------------------------------------------------------------------------------------

export interface PosicaoPatrimonio {
  id: number;
  extrato_id: number | null;
  instituicao: string;
  conta: string;
  classe_ativo: ClasseAtivo;
  ativo: string;
  codigo: string | null;
  quantidade: number | null;
  moeda: string;
  valor_original_centavos: number;
  /** Em reais; null quando a moeda e estrangeira e nao ha taxa de cambio. */
  valor_centavos: number | null;
  mes_snapshot: string;
  defasado: boolean;
  origem: string;
  especie: string | null;
  cnpj: string | null;
  /** Preco de fechamento / cotacao, na moeda da posicao (unidade). */
  preco_fechamento: number | null;
  /** Preco medio do EXTRATO; null = o extrato nao informa (ver o cadastro do ativo). */
  preco_medio: number | null;
  custo_total_centavos: number | null;
  detalhe: DetalhePosicao;
  /** Chave do cadastro do ativo (codigo ou nome). */
  chave: string;
  /** Marcada como Meta (reserva/provisao) no cadastro: renda fixa fora da liberdade financeira. */
  meta: boolean;
}

export interface ContaPatrimonio {
  instituicao: string;
  conta: string;
  moeda: string;
  mes_snapshot: string;
  defasado: boolean;
  posicoes: number;
  total_original_centavos: number;
  total_centavos: number | null;
  taxa_x10000: number | null;
  mes_taxa: string | null;
  /** Nao ha taxa nenhuma ate o mes: o valor fica fora do total em reais. */
  cambio_ausente: boolean;
  /** A taxa usada e de mes anterior ao pedido. */
  cambio_defasado: boolean;
}

export interface Patrimonio {
  mes: string;
  sem_dados: boolean;
  /** Patrimonio total, incluindo o que esta marcado como Meta. */
  total_centavos: number;
  /** Parte do total marcada como Meta (reserva/provisao que o usuario saca quando o fato provisionado ocorre). */
  meta_centavos: number;
  /** Base da liberdade financeira: total menos Meta. */
  liberdade_centavos: number;
  posicoes: PosicaoPatrimonio[];
  contas: ContaPatrimonio[];
  por_classe: { classe: ClasseAtivo; rotulo: string; total_centavos: number }[];
  por_instituicao: { instituicao: string; total_centavos: number }[];
  defasadas: ContaPatrimonio[];
  cambio_ausente: ContaPatrimonio[];
}

function lerDetalhe(json: string | null): DetalhePosicao {
  if (!json) return {};
  try {
    const d = JSON.parse(json) as unknown;
    return d && typeof d === "object" && !Array.isArray(d) ? (d as DetalhePosicao) : {};
  } catch {
    return {};
  }
}

export function patrimonio(db: Db, usuarioId: string, mes: string): Patrimonio {
  validarMes(mes);
  const rows = db
    .prepare(
      `SELECT p.id, p.extrato_id, p.instituicao, p.conta, p.classe_ativo, p.ativo, p.codigo, p.quantidade, p.moeda, p.valor_centavos, p.mes, p.origem,
              p.especie, p.cnpj, p.preco_fechamento, p.preco_medio, p.custo_total_centavos, p.detalhe_json
         FROM posicao_investimento p
         JOIN (SELECT instituicao, conta, moeda, MAX(mes) AS mes FROM posicao_investimento WHERE usuario_id = ? AND mes <= ? GROUP BY instituicao, conta, moeda) u
           ON u.instituicao = p.instituicao AND u.conta = p.conta AND u.moeda = p.moeda AND u.mes = p.mes
        WHERE p.usuario_id = ? ORDER BY p.id`,
    )
    .all(usuarioId, mes, usuarioId) as { id: number; extrato_id: number | null; instituicao: string; conta: string; classe_ativo: ClasseAtivo; ativo: string; codigo: string | null; quantidade: number | null; moeda: string; valor_centavos: number; mes: string; origem: string; especie: string | null; cnpj: string | null; preco_fechamento: number | null; preco_medio: number | null; custo_total_centavos: number | null; detalhe_json: string | null }[];
  const cadastro = mapaCadastro(db, usuarioId);

  const taxas = new Map<string, TaxaUsada | null>();
  const taxa = (moeda: string): TaxaUsada | null => {
    if (moeda === "BRL") return { taxa_x10000: 10000, mes_taxa: mes };
    if (!taxas.has(moeda)) taxas.set(moeda, taxaAte(db, usuarioId, moeda, mes));
    return taxas.get(moeda)!;
  };

  const posicoes: PosicaoPatrimonio[] = rows.map((r) => {
    const t = taxa(r.moeda);
    const chave = chaveDoAtivo(r.classe_ativo === "transito" ? null : r.codigo, r.ativo);
    return {
      id: r.id,
      extrato_id: r.extrato_id,
      instituicao: r.instituicao,
      conta: r.conta,
      classe_ativo: r.classe_ativo,
      ativo: r.ativo,
      codigo: r.codigo,
      quantidade: r.quantidade,
      moeda: r.moeda,
      valor_original_centavos: r.valor_centavos,
      valor_centavos: t ? (r.moeda === "BRL" ? r.valor_centavos : arred((r.valor_centavos * t.taxa_x10000) / 10000)) : null,
      mes_snapshot: r.mes,
      defasado: r.mes < mes,
      origem: r.origem,
      especie: r.especie,
      cnpj: r.cnpj,
      preco_fechamento: r.preco_fechamento,
      preco_medio: r.preco_medio,
      custo_total_centavos: r.custo_total_centavos,
      detalhe: lerDetalhe(r.detalhe_json),
      chave,
      meta: r.classe_ativo === "renda_fixa" && cadastro.get(chave)?.meta === true,
    };
  });

  const mapa = new Map<string, ContaPatrimonio>();
  for (const p of posicoes) {
    const k = `${p.instituicao}\u0000${p.conta}\u0000${p.moeda}`;
    let c = mapa.get(k);
    if (!c) {
      const t = taxa(p.moeda);
      c = {
        instituicao: p.instituicao,
        conta: p.conta,
        moeda: p.moeda,
        mes_snapshot: p.mes_snapshot,
        defasado: p.defasado,
        posicoes: 0,
        total_original_centavos: 0,
        total_centavos: t ? 0 : null,
        taxa_x10000: p.moeda === "BRL" ? null : (t?.taxa_x10000 ?? null),
        mes_taxa: p.moeda === "BRL" ? null : (t?.mes_taxa ?? null),
        cambio_ausente: !t,
        cambio_defasado: !!t && p.moeda !== "BRL" && t.mes_taxa < mes,
      };
      mapa.set(k, c);
    }
    c.posicoes++;
    c.total_original_centavos += p.valor_original_centavos;
    if (c.total_centavos !== null && p.valor_centavos !== null) c.total_centavos += p.valor_centavos;
  }
  const contas = [...mapa.values()].sort((a, b) => a.instituicao.localeCompare(b.instituicao, "pt-BR") || a.conta.localeCompare(b.conta) || a.moeda.localeCompare(b.moeda));

  const emReais = posicoes.filter((p) => p.valor_centavos !== null);
  const total = emReais.reduce((s, p) => s + p.valor_centavos!, 0);
  const meta = emReais.filter((p) => p.meta).reduce((s, p) => s + p.valor_centavos!, 0);
  const porClasse = new Map<ClasseAtivo, number>();
  const porInst = new Map<string, number>();
  for (const p of emReais) {
    porClasse.set(p.classe_ativo, (porClasse.get(p.classe_ativo) ?? 0) + p.valor_centavos!);
    porInst.set(p.instituicao, (porInst.get(p.instituicao) ?? 0) + p.valor_centavos!);
  }
  return {
    mes,
    sem_dados: posicoes.length === 0,
    total_centavos: total,
    meta_centavos: meta,
    liberdade_centavos: total - meta,
    posicoes,
    contas,
    por_classe: CLASSES_ATIVO.filter((c) => porClasse.has(c)).map((c) => ({ classe: c, rotulo: ROTULO_CLASSE[c], total_centavos: porClasse.get(c)! })),
    por_instituicao: [...porInst.entries()].map(([instituicao, t]) => ({ instituicao, total_centavos: t })).sort((a, b) => b.total_centavos - a.total_centavos),
    defasadas: contas.filter((c) => c.defasado),
    cambio_ausente: contas.filter((c) => c.cambio_ausente),
  };
}

export interface PontoEvolucao {
  mes: string;
  total_centavos: number;
  /** Total menos o que esta marcado como Meta (base da liberdade financeira). */
  liberdade_centavos: number;
  sem_dados: boolean;
  /** Contas cujo snapshot e de mes anterior ao do ponto. */
  defasadas: number;
  cambio_ausente: boolean;
}

/** Patrimonio de cada um dos `n` meses ate `ateMes` (inclusive), em ordem cronologica. */
export function evolucaoPatrimonio(db: Db, usuarioId: string, ateMes: string, n = 12): PontoEvolucao[] {
  validarMes(ateMes);
  const out: PontoEvolucao[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const mes = deslocar(ateMes, -i);
    const p = patrimonio(db, usuarioId, mes);
    out.push({ mes, total_centavos: p.total_centavos, liberdade_centavos: p.liberdade_centavos, sem_dados: p.sem_dados, defasadas: p.defasadas.length, cambio_ausente: p.cambio_ausente.length > 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Movimentos, aportes e rentabilidade estimada
// ---------------------------------------------------------------------------------------------

export interface MovimentoDoMes {
  id: number;
  extrato_id: number;
  data_local: string;
  instituicao: string;
  conta: string;
  tipo: TipoMovimento;
  descricao: string;
  codigo: string | null;
  moeda: string;
  valor_centavos: number;
  /** Em reais, na taxa do mes; null sem taxa de cambio. */
  valor_brl_centavos: number | null;
  em_transito: boolean;
  /** Aporte ou resgate que o extrato do mes anterior ja trazia como "em transito": nao entra de novo nos aportes do mes. */
  ja_contado: boolean;
}

type LinhaMov = { id: number; extrato_id: number; data_local: string; instituicao: string; conta: string; tipo: TipoMovimento; descricao: string; codigo: string | null; moeda: string; valor_centavos: number; em_transito: number };

const COLUNAS_MOV = "m.id, m.extrato_id, m.data_local, m.instituicao, m.conta, m.tipo, m.descricao, m.codigo, m.moeda, m.valor_centavos, m.em_transito";

/** Movimentos dos extratos cujo periodo termina no mes (explicam a variacao entre o fim do mes anterior e o fim deste). */
export function movimentosDoMes(db: Db, usuarioId: string, mes: string): MovimentoDoMes[] {
  validarMes(mes);
  const rows = db
    .prepare(`SELECT ${COLUNAS_MOV} FROM movimento_investimento m JOIN extrato_investimento e ON e.id = m.extrato_id WHERE m.usuario_id = ? AND substr(e.periodo_fim, 1, 7) = ? ORDER BY m.data_local, m.id`)
    .all(usuarioId, mes) as LinhaMov[];
  const anteriores = db
    .prepare(`SELECT ${COLUNAS_MOV} FROM movimento_investimento m JOIN extrato_investimento e ON e.id = m.extrato_id WHERE m.usuario_id = ? AND substr(e.periodo_fim, 1, 7) = ? AND m.em_transito = 1 AND m.tipo IN ('aporte','resgate')`)
    .all(usuarioId, deslocar(mes, -1)) as LinhaMov[];
  // multiconjunto de "em transito" do mes anterior: cada item cobre no maximo um movimento igual deste mes
  const pendentes = new Map<string, number>();
  const chave = (m: LinhaMov) => `${m.instituicao}|${m.conta}|${m.moeda}|${m.tipo}|${Math.abs(m.valor_centavos)}`;
  for (const a of anteriores) pendentes.set(chave(a), (pendentes.get(chave(a)) ?? 0) + 1);

  const taxas = new Map<string, TaxaUsada | null>();
  const taxa = (moeda: string): TaxaUsada | null => {
    if (moeda === "BRL") return { taxa_x10000: 10000, mes_taxa: mes };
    if (!taxas.has(moeda)) taxas.set(moeda, taxaAte(db, usuarioId, moeda, mes));
    return taxas.get(moeda)!;
  };
  return rows.map((r) => {
    let jaContado = false;
    if (!r.em_transito && (r.tipo === "aporte" || r.tipo === "resgate")) {
      const n = pendentes.get(chave(r)) ?? 0;
      if (n > 0) {
        pendentes.set(chave(r), n - 1);
        jaContado = true;
      }
    }
    const t = taxa(r.moeda);
    return { ...r, em_transito: !!r.em_transito, ja_contado: jaContado, valor_brl_centavos: t ? (r.moeda === "BRL" ? r.valor_centavos : arred((r.valor_centavos * t.taxa_x10000) / 10000)) : null };
  });
}

export interface LancamentoInvestimento {
  id: number;
  data_local: string;
  descricao: string;
  valor_centavos: number;
  status: string;
}

/** Lancamentos do aplicativo do tipo investimento no mes (para comparar com os movimentos dos extratos). */
export function aportesLancamentos(db: Db, usuarioId: string, mes: string): { mes: string; total_centavos: number; itens: LancamentoInvestimento[] } {
  validarMes(mes);
  const itens = db
    .prepare("SELECT id, data_local, descricao, valor_centavos, status FROM lancamento WHERE usuario_id = ? AND tipo = 'investimento' AND status != 'cancelado' AND substr(data_local, 1, 7) = ? ORDER BY data_local, id")
    .all(usuarioId, mes) as LancamentoInvestimento[];
  return { mes, total_centavos: itens.reduce((s, i) => s + i.valor_centavos, 0), itens };
}

export interface VariacaoDoMes {
  mes: string;
  mes_anterior: string;
  patrimonio_centavos: number;
  patrimonio_anterior_centavos: number | null;
  /** null sem patrimonio do mes anterior ou com cambio ausente em algum dos dois meses. */
  variacao_centavos: number | null;
  /** Aportes e contribuicoes (inclui "em transito"), em reais. */
  aportes_centavos: number;
  /** Transferencias de custodia (depositos de ativos), com sinal. */
  custodia_centavos: number;
  resgates_centavos: number;
  /** aportes + custodia - resgates. */
  aportes_liquidos_centavos: number;
  /** Movimentos que ja haviam sido contados como "em transito" no mes anterior. */
  ja_contados: number;
  /** Algum movimento em moeda estrangeira ficou sem taxa de cambio e fora dos aportes. */
  aportes_sem_cambio: number;
  /** ESTIMATIVA: variacao menos aportes liquidos. null quando nao ha base comparavel. */
  rentabilidade_estimada_centavos: number | null;
  /** Sobre o patrimonio do mes anterior, sem ponderar pelo momento dos aportes. */
  rentabilidade_estimada_pct: number | null;
  estimativa: true;
  nota: string;
  /** Por que a rentabilidade estimada nao foi calculada. */
  motivo_indisponivel: string | null;
  /** O patrimonio inclui contas em moeda estrangeira: a estimativa embute a variacao cambial. */
  inclui_cambio: boolean;
}

const nomeConta = (c: { instituicao: string; conta: string }) => (c.conta ? `${c.instituicao} (conta ${c.conta})` : c.instituicao);

export function variacaoDoMes(db: Db, usuarioId: string, mes: string): VariacaoDoMes {
  validarMes(mes);
  const ant = deslocar(mes, -1);
  const atual = patrimonio(db, usuarioId, mes);
  const anterior = patrimonio(db, usuarioId, ant);
  const movs = movimentosDoMes(db, usuarioId, mes);

  let aportes = 0;
  let custodia = 0;
  let resgates = 0;
  let semCambio = 0;
  for (const m of movs) {
    if (m.ja_contado || (m.tipo !== "aporte" && m.tipo !== "custodia" && m.tipo !== "resgate")) continue;
    if (m.valor_brl_centavos === null) {
      semCambio++;
      continue;
    }
    if (m.tipo === "aporte") aportes += m.valor_brl_centavos;
    else if (m.tipo === "custodia") custodia += m.valor_brl_centavos;
    else resgates += m.valor_brl_centavos;
  }
  const liquidos = aportes + custodia - resgates;

  const cambioOk = atual.cambio_ausente.length === 0 && anterior.cambio_ausente.length === 0;
  const variacao = !anterior.sem_dados && !atual.sem_dados && cambioOk ? atual.total_centavos - anterior.total_centavos : null;

  let motivo: string | null = null;
  if (atual.sem_dados) motivo = "Não há posições até este mês.";
  else if (anterior.sem_dados) motivo = `Não há posições de ${nomeMesPt(ant)} para comparar.`;
  else if (!cambioOk) motivo = "Falta a taxa de câmbio de uma conta em moeda estrangeira (neste mês ou no anterior).";
  else if (semCambio > 0) motivo = "Há movimentos em moeda estrangeira sem taxa de câmbio.";
  else {
    const doMes = atual.contas.filter((c) => !c.defasado);
    if (doMes.length === 0) motivo = "Nenhuma posição foi informada para este mês: os dados são de meses anteriores.";
    else {
      const semBase = doMes.filter((c) => !anterior.contas.some((a) => a.instituicao === c.instituicao && a.conta === c.conta && a.moeda === c.moeda && !a.defasado));
      if (semBase.length > 0) motivo = `Sem posição de ${nomeMesPt(ant)} para: ${semBase.map(nomeConta).join(", ")}.`;
    }
  }
  const rent = motivo === null && variacao !== null ? variacao - liquidos : null;
  return {
    mes,
    mes_anterior: ant,
    patrimonio_centavos: atual.total_centavos,
    patrimonio_anterior_centavos: anterior.sem_dados ? null : anterior.total_centavos,
    variacao_centavos: variacao,
    aportes_centavos: aportes,
    custodia_centavos: custodia,
    resgates_centavos: resgates,
    aportes_liquidos_centavos: liquidos,
    ja_contados: movs.filter((m) => m.ja_contado).length,
    aportes_sem_cambio: semCambio,
    rentabilidade_estimada_centavos: rent,
    rentabilidade_estimada_pct: rent !== null && anterior.total_centavos > 0 ? rent / anterior.total_centavos : null,
    estimativa: true,
    nota: NOTA_ESTIMATIVA,
    motivo_indisponivel: motivo,
    inclui_cambio: atual.contas.some((c) => c.moeda !== "BRL"),
  };
}
