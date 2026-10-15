import type { Db } from "../db/tipos";
import { chaveEstabelecimento } from "../classification/classificador";
import { normalizar } from "../parsing/text";
import { somarMeses } from "../parsing/tempo";

/**
 * Controle de pagamentos do mês (o que a planilha fazia pintando de amarelo):
 *  planejado -> lancado (o usuário informa o valor real do boleto) -> pago (à mão ou conferido no extrato importado).
 * Os compromissos NÃO são lançamentos: não entram nos totais; servem para acompanhar o que falta pagar. Quando o extrato ou a
 * fatura chega, o pagamento é conferido contra o lançamento real (`conciliarCompromissos`), sem contar nada duas vezes.
 */
export type EstadoCompromisso = "planejado" | "lancado" | "pago";

export interface Compromisso {
  id: number;
  mes: string;
  descricao: string;
  categoria: string;
  valor_planejado_centavos: number;
  /** Valor do boleto ou da fatura, quando informado. */
  valor_real_centavos: number | null;
  vencimento: string | null;
  estado: EstadoCompromisso;
  pago_em: string | null;
  /** Marcado à mão pelo usuário (e, depois, conferido ou não no extrato). */
  pago_manual: boolean;
  /** Lançamento do extrato ou da fatura que comprova o pagamento. */
  lancamento_id: number | null;
  /** Pago à mão com valor diferente do que o extrato mostrou. */
  divergencia_centavos: number | null;
  recorrencia_id: number | null;
}

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const COLS = "id, mes, descricao, categoria, valor_planejado_centavos, valor_real_centavos, vencimento, estado, pago_em, pago_pelo_usuario, lancamento_id, divergencia_centavos, recorrencia_id";

interface Linha extends Omit<Compromisso, "pago_manual"> { pago_pelo_usuario: number }
const paraCompromisso = (r: Linha): Compromisso => { const { pago_pelo_usuario, ...resto } = r; return { ...resto, pago_manual: pago_pelo_usuario === 1 }; };

function diaDoMes(mes: string, dia: number): string {
  const ultimo = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
  return `${mes}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

/** Cria os compromissos do mês a partir das recorrências ativas (aluguel, plano de saúde, sindicato...). Idempotente. */
export function gerarCompromissosDoMes(db: Db, usuarioId: string, mes: string): number {
  if (!MES.test(mes)) throw new Error("Mês inválido (use AAAA-MM).");
  const recs = db.prepare("SELECT id, descricao, valor_centavos, categoria, dia_mes FROM recorrencia WHERE usuario_id = ? AND ativa = 1 AND tipo != 'receita' AND inicio_mes <= ?").all(usuarioId, mes) as { id: number; descricao: string; valor_centavos: number; categoria: string; dia_mes: number }[];
  let n = 0;
  const agora = new Date().toISOString();
  db.transaction(() => {
    for (const r of recs) {
      if (db.prepare("SELECT 1 FROM compromisso WHERE usuario_id = ? AND mes = ? AND recorrencia_id = ?").get(usuarioId, mes, r.id)) continue;
      db.prepare("INSERT INTO compromisso (usuario_id, mes, descricao, categoria, valor_planejado_centavos, vencimento, estado, recorrencia_id, criado_em) VALUES (?,?,?,?,?,?,'planejado',?,?)").run(usuarioId, mes, r.descricao, r.categoria, r.valor_centavos, diaDoMes(mes, r.dia_mes), r.id, agora);
      n++;
    }
  })();
  return n;
}

export function listarCompromissos(db: Db, usuarioId: string, mes: string): Compromisso[] {
  return (db.prepare(`SELECT ${COLS} FROM compromisso WHERE usuario_id = ? AND mes = ? ORDER BY CASE estado WHEN 'pago' THEN 1 ELSE 0 END, vencimento IS NULL, vencimento, id`).all(usuarioId, mes) as Linha[]).map(paraCompromisso);
}

export function criarCompromisso(db: Db, usuarioId: string, c: { mes: string; descricao: string; valor_planejado_centavos: number; vencimento?: string | null; categoria?: string }): number {
  if (!MES.test(c.mes)) throw new Error("Mês inválido (use AAAA-MM).");
  if (!c.descricao.trim() || c.descricao.trim().length > 80) throw new Error("A descrição deve ter de 1 a 80 caracteres.");
  if (!Number.isInteger(c.valor_planejado_centavos) || c.valor_planejado_centavos < 0) throw new Error("O valor não pode ser negativo.");
  if (c.vencimento && !DATA.test(c.vencimento)) throw new Error("Vencimento inválido.");
  const info = db.prepare("INSERT INTO compromisso (usuario_id, mes, descricao, categoria, valor_planejado_centavos, vencimento, estado, criado_em) VALUES (?,?,?,?,?,?,'planejado',?)").run(usuarioId, c.mes, c.descricao.trim(), c.categoria ?? "nao_classificado", c.valor_planejado_centavos, c.vencimento ?? null, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function obter(db: Db, usuarioId: string, id: number): Compromisso {
  const r = db.prepare(`SELECT ${COLS} FROM compromisso WHERE id = ? AND usuario_id = ?`).get(id, usuarioId) as Linha | undefined;
  if (!r) throw new Error("Compromisso não encontrado.");
  return paraCompromisso(r);
}

/** Informa o valor real do boleto/fatura (e o vencimento). Um compromisso planejado passa a "lançado"; um já pago continua pago. */
export function lancarValorReal(db: Db, usuarioId: string, id: number, p: { valor_real_centavos: number; vencimento?: string | null; descricao?: string }): Compromisso {
  const c = obter(db, usuarioId, id);
  if (!Number.isInteger(p.valor_real_centavos) || p.valor_real_centavos <= 0) throw new Error("Informe o valor do boleto.");
  if (p.vencimento && !DATA.test(p.vencimento)) throw new Error("Vencimento inválido.");
  const descricao = p.descricao?.trim() || c.descricao;
  db.prepare("UPDATE compromisso SET valor_real_centavos = ?, vencimento = ?, descricao = ?, estado = CASE WHEN estado = 'pago' THEN 'pago' ELSE 'lancado' END WHERE id = ?").run(p.valor_real_centavos, p.vencimento === undefined ? c.vencimento : p.vencimento, descricao, id);
  return obter(db, usuarioId, id);
}

/** Marca como pago à mão (na data informada, por padrão hoje) ou desfaz a marcação. O extrato importado depois confere o pagamento. */
export function marcarPago(db: Db, usuarioId: string, id: number, pago: boolean, dataPagamento: string): Compromisso {
  const c = obter(db, usuarioId, id);
  if (pago) {
    if (!DATA.test(dataPagamento)) throw new Error("Data de pagamento inválida.");
    db.prepare("UPDATE compromisso SET estado = 'pago', pago_em = ?, pago_pelo_usuario = 1 WHERE id = ?").run(dataPagamento, id);
  } else {
    db.prepare("UPDATE compromisso SET estado = ?, pago_em = NULL, pago_pelo_usuario = 0, lancamento_id = NULL, divergencia_centavos = NULL WHERE id = ?").run(c.valor_real_centavos !== null ? "lancado" : "planejado", id);
  }
  return obter(db, usuarioId, id);
}

export function removerCompromisso(db: Db, usuarioId: string, id: number): void {
  obter(db, usuarioId, id);
  db.prepare("DELETE FROM compromisso WHERE id = ?").run(id);
}

export interface ResultadoConciliacao {
  /** Compromissos que o extrato comprovou e passaram a "pago". */
  pagos: number;
  /** Compromissos marcados à mão que o extrato confirmou. */
  confirmados: number;
  /** Marcados à mão, mas com valor diferente do extrato. */
  divergentes: number;
}

/**
 * Confere os compromissos do mês com os lançamentos reais (extratos, faturas): um lançamento de despesa, aporte ou pagamento de fatura
 * com valor praticamente igual (diferença de até 1%) ou do mesmo estabelecimento (até 30%), no mês do vencimento ou nos dias vizinhos, e
 * ainda não usado por outro compromisso, comprova o pagamento. Idempotente; pode ser chamada depois de cada importação.
 */
export function conciliarCompromissos(db: Db, usuarioId: string, mes: string): ResultadoConciliacao {
  const res: ResultadoConciliacao = { pagos: 0, confirmados: 0, divergentes: 0 };
  const abertos = db.prepare(`SELECT ${COLS} FROM compromisso WHERE usuario_id = ? AND mes = ? AND lancamento_id IS NULL`).all(usuarioId, mes) as Linha[];
  const ini = somarMeses(`${mes}-01`, 0);
  const de = somarDias10(ini, -10);
  const ate = somarDias10(diaDoMes(mes, 31), 10);
  const usados = new Set((db.prepare("SELECT lancamento_id FROM compromisso WHERE usuario_id = ? AND lancamento_id IS NOT NULL").all(usuarioId) as { lancamento_id: number }[]).map((r) => r.lancamento_id));
  const candidatos = (db.prepare(
    `SELECT id, estabelecimento_norm, valor_centavos, data_local FROM lancamento
     WHERE usuario_id = ? AND status != 'cancelado' AND natureza != 'estorno' AND tipo IN ('despesa','investimento','transferencia') AND data_local BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = lancamento.id AND o.origem IN ('recorrente','parcela_prevista') AND NOT EXISTS (SELECT 1 FROM lancamento_origem o2 WHERE o2.lancamento_id = lancamento.id AND o2.origem NOT IN ('recorrente','parcela_prevista')))
     ORDER BY data_local`,
  ).all(usuarioId, de, ate) as { id: number; estabelecimento_norm: string; valor_centavos: number; data_local: string }[]).filter((l) => !usados.has(l.id));
  db.transaction(() => {
    for (const a of abertos) {
      const alvo = a.valor_real_centavos ?? a.valor_planejado_centavos;
      if (alvo <= 0) continue;
      const chaveA = chaveEstabelecimento(normalizar(a.descricao));
      // prefere o valor mais proximo; entre iguais, a data mais proxima do vencimento
      const achado = candidatos
        .filter((l) => !usados.has(l.id) && combina(chaveA, l.estabelecimento_norm, alvo, l.valor_centavos))
        .sort((x, y) => Math.abs(x.valor_centavos - alvo) - Math.abs(y.valor_centavos - alvo) || Math.abs(dias(x.data_local, a.vencimento)) - Math.abs(dias(y.data_local, a.vencimento)))[0];
      if (!achado) continue;
      usados.add(achado.id);
      const dif = achado.valor_centavos - alvo;
      const divergente = a.pago_pelo_usuario === 1 && Math.abs(dif) > Math.max(1, alvo * 0.01);
      if (a.estado === "pago") {
        db.prepare("UPDATE compromisso SET lancamento_id = ?, divergencia_centavos = ? WHERE id = ?").run(achado.id, divergente ? dif : null, a.id);
        if (divergente) res.divergentes++; else res.confirmados++;
      } else {
        db.prepare("UPDATE compromisso SET estado = 'pago', pago_em = ?, pago_pelo_usuario = 0, lancamento_id = ?, valor_real_centavos = COALESCE(valor_real_centavos, ?) WHERE id = ?").run(achado.data_local, achado.id, achado.valor_centavos, a.id);
        res.pagos++;
      }
    }
  })();
  return res;
}

/** Mesmo valor (até 1%), ou mesmo estabelecimento (um nome é o começo do outro) com valor até 30% diferente (contas variáveis). */
function combina(chaveA: string, estabLancamento: string, alvo: number, valor: number): boolean {
  const dif = Math.abs(valor - alvo);
  if (dif <= Math.max(1, Math.max(alvo, valor) * 0.01)) return true;
  const b = chaveEstabelecimento(estabLancamento);
  const mesmo = chaveA !== "" && b !== "" && (chaveA === b || chaveA.startsWith(`${b} `) || b.startsWith(`${chaveA} `));
  return mesmo && dif <= Math.max(alvo, valor) * 0.3;
}

function somarDias10(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function dias(a: string, b: string | null): number {
  return b ? Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000) : 0;
}

export interface ResumoDePagamentos {
  mes: string;
  planejado_centavos: number;
  /** Valor real quando informado; senão o planejado. */
  previsto_centavos: number;
  pago_centavos: number;
  a_pagar_centavos: number;
  em_atraso_centavos: number;
  em_atraso: number;
  a_pagar: number;
  pagos: number;
}

export function resumoDePagamentos(db: Db, usuarioId: string, mes: string, hoje: string): ResumoDePagamentos {
  const itens = listarCompromissos(db, usuarioId, mes);
  const valor = (c: Compromisso) => c.valor_real_centavos ?? c.valor_planejado_centavos;
  const abertos = itens.filter((c) => c.estado !== "pago");
  const atrasados = abertos.filter((c) => c.vencimento !== null && c.vencimento < hoje);
  return {
    mes,
    planejado_centavos: itens.reduce((s, c) => s + c.valor_planejado_centavos, 0),
    previsto_centavos: itens.reduce((s, c) => s + valor(c), 0),
    pago_centavos: itens.filter((c) => c.estado === "pago").reduce((s, c) => s + valor(c), 0),
    a_pagar_centavos: abertos.reduce((s, c) => s + valor(c), 0),
    em_atraso_centavos: atrasados.reduce((s, c) => s + valor(c), 0),
    em_atraso: atrasados.length,
    a_pagar: abertos.length,
    pagos: itens.length - abertos.length,
  };
}

/** Pagamentos que vencem nos próximos `dias` dias (ou já venceram) em todos os meses, para o aviso do Início. */
export function pagamentosProximos(db: Db, usuarioId: string, hoje: string, diasAdiante = 7): { atrasados: number; proximos: number } {
  const limite = somarDias10(hoje, diasAdiante);
  const r = db.prepare("SELECT SUM(CASE WHEN vencimento < ? THEN 1 ELSE 0 END) a, SUM(CASE WHEN vencimento >= ? AND vencimento <= ? THEN 1 ELSE 0 END) p FROM compromisso WHERE usuario_id = ? AND estado != 'pago' AND vencimento IS NOT NULL").get(hoje, hoje, limite, usuarioId) as { a: number | null; p: number | null };
  return { atrasados: r.a ?? 0, proximos: r.p ?? 0 };
}
