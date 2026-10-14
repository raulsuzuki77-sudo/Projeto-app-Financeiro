import type { Db } from "../db/tipos";
import { naturezaPadraoDaCategoria } from "../classification/categorias";
import { chaveEstabelecimento, classificar } from "../classification/classificador";
import { FORMAS_PAGAMENTO, NATUREZAS, type FormaPagamento, type Natureza } from "../domain/types";
import { registrarLancamento } from "../ingest/lancamentos";
import { dataValida } from "../parsing/tempo";
import { normalizar } from "../parsing/text";
import { mesmoCompromisso } from "./casamento";

export interface Recorrencia {
  id: number;
  descricao: string;
  tipo: "despesa" | "receita" | "investimento";
  valor_centavos: number;
  categoria: string;
  natureza: Natureza;
  dia_mes: number;
  forma_pagamento: FormaPagamento | null;
  cartao_id: number | null;
  inicio_mes: string;
  ativa: number;
}

export interface NovaRecorrencia {
  descricao: string;
  valor_centavos: number;
  dia_mes: number;
  tipo?: Recorrencia["tipo"];
  categoria?: string;
  natureza?: Natureza;
  forma_pagamento?: FormaPagamento | null;
  cartao_id?: number | null;
  /** Primeiro mês (AAAA-MM) em que a recorrência vale. Padrão: o mês de `hoje`. */
  inicio_mes?: string;
}

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export function ultimoDiaDoMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

function proximoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

function validar(r: Required<Pick<NovaRecorrencia, "descricao" | "valor_centavos" | "dia_mes">> & Partial<NovaRecorrencia>): void {
  if (!r.descricao.trim() || r.descricao.trim().length > 120) throw new Error("A descrição deve ter de 1 a 120 caracteres.");
  if (!Number.isInteger(r.valor_centavos) || r.valor_centavos <= 0) throw new Error("O valor deve ser maior que zero.");
  if (!Number.isInteger(r.dia_mes) || r.dia_mes < 1 || r.dia_mes > 31) throw new Error("O dia do mês deve estar entre 1 e 31.");
  if (r.tipo !== undefined && !["despesa", "receita", "investimento"].includes(r.tipo)) throw new Error("Tipo inválido.");
  if (r.natureza !== undefined && !(NATUREZAS as readonly string[]).includes(r.natureza)) throw new Error("Natureza inválida.");
  if (r.forma_pagamento != null && !(FORMAS_PAGAMENTO as readonly string[]).includes(r.forma_pagamento)) throw new Error("Forma de pagamento inválida.");
  if (r.inicio_mes !== undefined && !MES.test(r.inicio_mes)) throw new Error("Mês inicial inválido (use AAAA-MM).");
}

export function criarRecorrencia(db: Db, usuarioId: string, r: NovaRecorrencia, hojeLocal: string): number {
  validar(r);
  const tipo = r.tipo ?? "despesa";
  const palpite = r.categoria ? null : classificar(db, usuarioId, r.descricao, tipo);
  const categoria = r.categoria ?? (palpite && palpite.fonte !== "nenhuma" ? palpite.categoria : "nao_classificado");
  const natureza = r.natureza ?? naturezaPadraoDaCategoria(categoria) ?? "fixo";
  if (r.cartao_id != null && !db.prepare("SELECT 1 FROM cartao WHERE id = ? AND usuario_id = ?").get(r.cartao_id, usuarioId)) throw new Error("Cartão inexistente.");
  const info = db
    .prepare(
      `INSERT INTO recorrencia (usuario_id, descricao, tipo, valor_centavos, categoria, natureza, dia_mes, forma_pagamento, cartao_id, inicio_mes, ativa, criada_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
    )
    .run(usuarioId, r.descricao.trim(), tipo, r.valor_centavos, categoria, natureza, r.dia_mes, r.forma_pagamento ?? null, r.cartao_id ?? null, r.inicio_mes ?? hojeLocal.slice(0, 7), new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function listarRecorrencias(db: Db, usuarioId: string): Recorrencia[] {
  return db.prepare("SELECT id, descricao, tipo, valor_centavos, categoria, natureza, dia_mes, forma_pagamento, cartao_id, inicio_mes, ativa FROM recorrencia WHERE usuario_id = ? ORDER BY dia_mes, id").all(usuarioId) as Recorrencia[];
}

export function atualizarRecorrencia(db: Db, usuarioId: string, id: number, p: Partial<Pick<NovaRecorrencia, "descricao" | "valor_centavos" | "dia_mes" | "categoria" | "natureza">> & { ativa?: boolean }): void {
  const atual = listarRecorrencias(db, usuarioId).find((x) => x.id === id);
  if (!atual) throw new Error("Recorrência não encontrada.");
  const novo = { descricao: p.descricao ?? atual.descricao, valor_centavos: p.valor_centavos ?? atual.valor_centavos, dia_mes: p.dia_mes ?? atual.dia_mes, categoria: p.categoria ?? atual.categoria, natureza: p.natureza ?? atual.natureza };
  validar(novo);
  db.prepare("UPDATE recorrencia SET descricao = ?, valor_centavos = ?, dia_mes = ?, categoria = ?, natureza = ?, ativa = ? WHERE id = ? AND usuario_id = ?").run(
    novo.descricao.trim(), novo.valor_centavos, novo.dia_mes, novo.categoria, novo.natureza, p.ativa === undefined ? atual.ativa : p.ativa ? 1 : 0, id, usuarioId,
  );
}

/** Remove a regra. Os lançamentos já gerados permanecem (são histórico). */
export function removerRecorrencia(db: Db, usuarioId: string, id: number): boolean {
  return db.prepare("DELETE FROM recorrencia WHERE id = ? AND usuario_id = ?").run(id, usuarioId).changes > 0;
}

export interface ResultadoGeracao {
  criados: number;
  /** Meses em que um lançamento já existente (de extrato ou fatura) cobre a recorrência: nada foi criado, para não contar duas vezes. */
  contemplados: number;
}

interface LinhaLanc {
  id: number;
  descricao: string;
  estabelecimento_norm: string;
  valor_centavos: number;
  data_local: string;
}

/** Lançamentos reais do mês que já contemplam a recorrência (não gerados por ela). */
function contemplam(db: Db, usuarioId: string, r: Pick<Recorrencia, "descricao" | "tipo" | "valor_centavos"> & { id?: number }, mes: string): LinhaLanc[] {
  const alvo = { estabelecimento_norm: normalizar(r.descricao), valor_centavos: r.valor_centavos };
  const linhas = db
    .prepare(
      `SELECT l.id, l.descricao, l.estabelecimento_norm, l.valor_centavos, l.data_local FROM lancamento l
       WHERE l.usuario_id = ? AND l.tipo = ? AND l.status != 'cancelado' AND substr(l.data_local,1,7) = ?
         AND NOT EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = l.id AND o.origem = 'recorrente')`,
    )
    .all(usuarioId, r.tipo, mes) as LinhaLanc[];
  return linhas.filter((l) => mesmoCompromisso(l, alvo));
}

export interface Cobertura {
  mes: string;
  lancamento_id: number;
  descricao: string;
  valor_centavos: number;
}

/** Em quais meses (do início até o mês de `hojeLocal`) os extratos e faturas importados já contemplam esta recorrência? */
export function coberturaDaRecorrencia(db: Db, usuarioId: string, id: number, hojeLocal: string): Cobertura[] {
  const r = listarRecorrencias(db, usuarioId).find((x) => x.id === id);
  if (!r) throw new Error("Recorrência não encontrada.");
  const mesHoje = hojeLocal.slice(0, 7);
  const out: Cobertura[] = [];
  for (let mes = r.inicio_mes; mes <= mesHoje; mes = proximoMes(mes)) {
    // contemplada tambem quando o vinculo ja foi registrado por gerarRecorrencias
    const vinc = db
      .prepare("SELECT l.id, l.descricao, l.valor_centavos FROM lancamento_origem o JOIN lancamento l ON l.id = o.lancamento_id WHERE o.origem = 'recorrente' AND o.referencia = ? AND l.usuario_id = ? AND l.status != 'cancelado' AND EXISTS (SELECT 1 FROM lancamento_origem x WHERE x.lancamento_id = l.id AND x.origem != 'recorrente')")
      .get(`rec:${r.id}:${mes}`, usuarioId) as { id: number; descricao: string; valor_centavos: number } | undefined;
    const c = vinc ? { id: vinc.id, descricao: vinc.descricao, valor_centavos: vinc.valor_centavos } : contemplam(db, usuarioId, r, mes)[0];
    if (c) out.push({ mes, lancamento_id: c.id, descricao: c.descricao, valor_centavos: c.valor_centavos });
  }
  return out;
}

/** Antes de cadastrar: em quais dos últimos `nMeses` meses (contando o atual) já existe um lançamento que contempla este compromisso? */
export function coberturaPrevia(db: Db, usuarioId: string, r: { descricao: string; tipo: Recorrencia["tipo"]; valor_centavos: number }, hojeLocal: string, nMeses = 4): Cobertura[] {
  if (!r.descricao.trim() || !(r.valor_centavos > 0)) return [];
  const mesHoje = hojeLocal.slice(0, 7);
  const out: Cobertura[] = [];
  for (let k = nMeses - 1; k >= 0; k--) {
    const mes = mesesAtrasInterno(mesHoje, k);
    const c = contemplam(db, usuarioId, r, mes)[0];
    if (c) out.push({ mes, lancamento_id: c.id, descricao: c.descricao, valor_centavos: c.valor_centavos });
  }
  return out;
}

function mesesAtrasInterno(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const t = a * 12 + (m - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/**
 * Gera os lançamentos devidos das recorrências ativas, de `inicio_mes` até o mês de `hojeLocal` (no máximo 24 meses para trás).
 * Em meses curtos, o dia é ajustado ao último dia (dia 31 em fevereiro vira 28 ou 29). Só gera datas que já chegaram.
 * Idempotente: a referência `rec:<id>:<AAAA-MM>` impede duplicar, e um lançamento apagado pelo usuário não é recriado.
 * Se o mês já tem um lançamento importado que cobre a recorrência (mesmo valor, ou mesmo estabelecimento com valor próximo),
 * nada é criado: o lançamento importado passa a ser a ocorrência do mês, e o gasto é contado uma só vez.
 */
export function gerarRecorrenciasDetalhado(db: Db, usuarioId: string, hojeLocal: string): ResultadoGeracao {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hojeLocal)) throw new Error("data de referência inválida");
  const mesHoje = hojeLocal.slice(0, 7);
  const [aH, mH] = mesHoje.split("-").map(Number) as [number, number];
  const limite = (() => { const t = aH * 12 + (mH - 1) - 24; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; })();
  const res: ResultadoGeracao = { criados: 0, contemplados: 0 };
  for (const r of listarRecorrencias(db, usuarioId).filter((x) => x.ativa === 1)) {
    for (let mes = r.inicio_mes < limite ? limite : r.inicio_mes; mes <= mesHoje; mes = proximoMes(mes)) {
      const dia = Math.min(r.dia_mes, ultimoDiaDoMes(mes));
      const data = `${mes}-${String(dia).padStart(2, "0")}`;
      if (data > hojeLocal) break;
      const [a, m, d] = data.split("-").map(Number) as [number, number, number];
      if (!dataValida(a, m, d)) continue;
      const referencia = `rec:${r.id}:${mes}`;
      if (db.prepare("SELECT 1 FROM lancamento_origem WHERE origem = 'recorrente' AND referencia = ?").get(referencia)) continue;
      const cobre = contemplam(db, usuarioId, r, mes)[0];
      if (cobre) {
        db.prepare("INSERT INTO lancamento_origem (lancamento_id, origem, referencia, texto_bruto, criado_em) VALUES (?,?,?,?,?)").run(cobre.id, "recorrente", referencia, "contemplada por lançamento importado", new Date().toISOString());
        res.contemplados++;
        continue;
      }
      const reg = registrarLancamento(db, {
        usuario_id: usuarioId,
        tipo: r.tipo,
        valor_centavos: r.valor_centavos,
        descricao: r.descricao,
        categoria: r.categoria,
        natureza: r.natureza,
        forma_pagamento: r.forma_pagamento,
        cartao_id: r.cartao_id,
        data_local: data,
        hora_local: null,
        precisao_horario: "desconhecido",
        origem: "recorrente",
        referencia,
      });
      if (reg.resultado === "criado") res.criados++;
    }
  }
  return res;
}

export function gerarRecorrencias(db: Db, usuarioId: string, hojeLocal: string): number {
  return gerarRecorrenciasDetalhado(db, usuarioId, hojeLocal).criados;
}

export interface RecorrenteDetectada {
  chave: string;
  descricao: string;
  tipo: "despesa" | "receita" | "investimento";
  categoria: string;
  /** Valor típico (mediano) do compromisso. */
  valor_centavos: number;
  /** O valor oscila mais de 2% entre os meses (conta variável). */
  variavel: boolean;
  meses: string[];
  dia_tipico: number;
  ultimo_mes: string;
  /** Já existe uma recorrência cadastrada para isto. */
  cadastrada: boolean;
  /** Não aparece há mais de dois meses: provavelmente encerrada. */
  encerrada: boolean;
}

function mesesAtras(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const t = a * 12 + (m - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

const mediana = (v: number[]) => {
  const o = [...v].sort((x, y) => x - y);
  const k = Math.floor(o.length / 2);
  return o.length % 2 ? o[k]! : Math.round((o[k - 1]! + o[k]!) / 2);
};

/**
 * Compromissos que se repetem mês a mês, identificados nos lançamentos importados ou digitados: mesmo estabelecimento, valores
 * parecidos (agrupados com até 15% de diferença), no máximo duas ocorrências por mês e presença em `minMeses` meses ou mais.
 * Compras parceladas, transferências, estornos e lançamentos gerados por uma recorrência não entram.
 */
export function detectarRecorrentes(db: Db, usuarioId: string, hojeLocal: string, minMeses = 2): RecorrenteDetectada[] {
  const linhas = db
    .prepare(
      `SELECT l.tipo, l.descricao, l.estabelecimento_norm, l.categoria, l.valor_centavos, l.data_local FROM lancamento l
       WHERE l.usuario_id = ? AND l.status != 'cancelado' AND l.tipo IN ('despesa','receita','investimento')
         AND l.natureza NOT IN ('estorno','parcelado','transferencia')
         AND NOT (EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = l.id AND o.origem = 'recorrente')
                  AND NOT EXISTS (SELECT 1 FROM lancamento_origem o2 WHERE o2.lancamento_id = l.id AND o2.origem != 'recorrente'))
       ORDER BY l.data_local, l.id`,
    )
    .all(usuarioId) as { tipo: RecorrenteDetectada["tipo"]; descricao: string; estabelecimento_norm: string; categoria: string; valor_centavos: number; data_local: string }[];
  const grupos = new Map<string, typeof linhas>();
  for (const l of linhas) {
    const chave = chaveEstabelecimento(l.estabelecimento_norm);
    if (!chave) continue;
    const k = `${l.tipo}|${chave}`;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(l);
  }
  const cadastradas = listarRecorrencias(db, usuarioId).filter((x) => x.ativa === 1);
  const limiteEncerrada = mesesAtras(hojeLocal.slice(0, 7), 2);
  const out: RecorrenteDetectada[] = [];
  for (const [k, itens] of grupos) {
    const [tipo, chave] = [k.slice(0, k.indexOf("|")) as RecorrenteDetectada["tipo"], k.slice(k.indexOf("|") + 1)];
    // agrupa por faixa de valor (a mesma marca pode ter dois compromissos, como duas linhas de telefone)
    const porValor = [...itens].sort((a, b) => a.valor_centavos - b.valor_centavos);
    const faixas: (typeof linhas)[] = [];
    for (const it of porValor) {
      const atual = faixas[faixas.length - 1];
      if (atual && it.valor_centavos <= atual[0]!.valor_centavos * 1.15) atual.push(it);
      else faixas.push([it]);
    }
    for (const f of faixas) {
      const porMes = new Map<string, number>();
      for (const it of f) porMes.set(it.data_local.slice(0, 7), (porMes.get(it.data_local.slice(0, 7)) ?? 0) + 1);
      if (porMes.size < minMeses || [...porMes.values()].some((n) => n > 2)) continue;
      // Aplicacoes e resgates genericos (caixinhas) giram o mesmo dinheiro; corridas e pequenos gastos de valor oscilante nao sao compromissos.
      if (f.every((x) => x.categoria === "investimento")) continue;
      const vs = f.map((x) => x.valor_centavos);
      if ((Math.max(...vs) - Math.min(...vs)) / mediana(vs) > 0.02 && mediana(vs) < 3000) continue;
      const ordenada = [...f].sort((a, b) => a.data_local.localeCompare(b.data_local));
      const ultima = ordenada[ordenada.length - 1]!;
      const valores = f.map((x) => x.valor_centavos);
      const valor = mediana(valores);
      const meses = [...porMes.keys()].sort();
      out.push({
        chave,
        descricao: ultima.descricao,
        tipo,
        categoria: ultima.categoria,
        valor_centavos: valor,
        variavel: (Math.max(...valores) - Math.min(...valores)) / valor > 0.02,
        meses,
        dia_tipico: mediana(f.map((x) => Number(x.data_local.slice(8, 10)))),
        ultimo_mes: meses[meses.length - 1]!,
        cadastrada: cadastradas.some((c) => c.tipo === tipo && mesmoCompromisso({ estabelecimento_norm: normalizar(c.descricao), valor_centavos: c.valor_centavos }, { estabelecimento_norm: ultima.estabelecimento_norm, valor_centavos: valor })),
        encerrada: meses[meses.length - 1]! < limiteEncerrada,
      });
    }
  }
  return out.sort((a, b) => Number(a.encerrada) - Number(b.encerrada) || b.valor_centavos - a.valor_centavos);
}
