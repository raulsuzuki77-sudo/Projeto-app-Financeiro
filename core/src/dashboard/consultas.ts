import type { Db } from "../db/tipos";
import { CLASSES, grupoDaCategoria, rotuloCategoria } from "../classification/categorias";
import { mapaDeClasses } from "../orcamento/orcamento";
import { normalizar } from "../parsing/text";

export interface ResumoMensal {
  mes: string;
  receitas_centavos: number;
  despesas_centavos: number;
  investimentos_centavos: number;
  saldo_centavos: number;
  taxa_poupanca: number | null;
  pendentes: number;
  por_categoria: { categoria: string; total_centavos: number }[];
  por_natureza: { natureza: string; total_centavos: number }[];
}

/**
 * Despesas do mês por categoria e natureza, já abatidos os estornos. As duas visões saem da MESMA matriz (categoria x natureza),
 * então o total por categoria, o total por natureza e `despesas_centavos` são sempre iguais. O estorno abate a natureza dominante
 * da própria categoria; o que sobrar acima do gasto da categoria é descartado (a categoria não fica negativa).
 */
export function despesasLiquidas(db: Db, usuarioId: string, mes: string): { categoria: string; natureza: string; total_centavos: number }[] {
  const base = "usuario_id = ? AND status != 'cancelado' AND substr(data_local,1,7) = ?";
  const gastos = db.prepare(`SELECT categoria, natureza, SUM(valor_centavos) t FROM lancamento WHERE ${base} AND tipo = 'despesa' GROUP BY categoria, natureza`).all(usuarioId, mes) as { categoria: string; natureza: string; t: number }[];
  const estornos = new Map((db.prepare(`SELECT categoria, SUM(valor_centavos) t FROM lancamento WHERE ${base} AND tipo = 'receita' AND natureza = 'estorno' GROUP BY categoria`).all(usuarioId, mes) as { categoria: string; t: number }[]).map((r) => [r.categoria, r.t]));
  const porCategoria = new Map<string, { natureza: string; t: number }[]>();
  for (const g of gastos) (porCategoria.get(g.categoria) ?? porCategoria.set(g.categoria, []).get(g.categoria)!).push({ natureza: g.natureza, t: g.t });
  const out: { categoria: string; natureza: string; total_centavos: number }[] = [];
  for (const [categoria, celulas] of porCategoria) {
    let abater = estornos.get(categoria) ?? 0;
    for (const c of [...celulas].sort((x, y) => y.t - x.t)) {
      const tira = Math.min(abater, c.t);
      abater -= tira;
      if (c.t - tira > 0) out.push({ categoria, natureza: c.natureza, total_centavos: c.t - tira });
    }
  }
  return out;
}

// Transferencias (ex.: pagamento de fatura) nunca entram em despesa: evita contar a mesma compra duas vezes.
// Lancamentos pendentes entram nos totais, mas sao contados em "pendentes" para o usuario revisar.
export function resumoMensal(db: Db, usuarioId: string, mes: string): ResumoMensal {
  const base = "usuario_id = ? AND status != 'cancelado' AND substr(data_local,1,7) = ?";
  const soma = (tipo: string) =>
    (db.prepare(`SELECT COALESCE(SUM(valor_centavos),0) t FROM lancamento WHERE ${base} AND tipo = ?`).get(usuarioId, mes, tipo) as { t: number }).t;
  // Estornos e descontos (natureza "estorno") entram como entrada no banco, mas abatem a despesa em vez de contarem como renda.
  const estornos = (db.prepare(`SELECT COALESCE(SUM(valor_centavos),0) t FROM lancamento WHERE ${base} AND tipo = 'receita' AND natureza = 'estorno'`).get(usuarioId, mes) as { t: number }).t;
  const receitas = soma("receita") - estornos;
  const investimentos = soma("investimento");
  const pendentes = (db.prepare(`SELECT COUNT(*) c FROM lancamento WHERE ${base} AND status = 'pendente'`).get(usuarioId, mes) as { c: number }).c;
  const celulas = despesasLiquidas(db, usuarioId, mes);
  const soma_por = (chave: "categoria" | "natureza") => {
    const m = new Map<string, number>();
    for (const c of celulas) m.set(c[chave], (m.get(c[chave]) ?? 0) + c.total_centavos);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const por_categoria = soma_por("categoria").map(([categoria, total_centavos]) => ({ categoria, total_centavos }));
  const por_natureza = soma_por("natureza").map(([natureza, total_centavos]) => ({ natureza, total_centavos }));
  const despesas = celulas.reduce((s, c) => s + c.total_centavos, 0);
  return {
    mes,
    receitas_centavos: receitas,
    despesas_centavos: despesas,
    investimentos_centavos: investimentos,
    saldo_centavos: receitas - despesas - investimentos,
    taxa_poupanca: receitas > 0 ? (receitas - despesas) / receitas : null,
    pendentes,
    por_categoria,
    por_natureza,
  };
}

export interface FatiaDespesa {
  id: string;
  rotulo: string;
  total_centavos: number;
}

/**
 * As mesmas despesas do mês vistas por categoria, por grupo (Alimentação, Transporte...) e por classe do orçamento.
 * As três listas somam exatamente o mesmo total: mudar a forma de agrupar não muda o valor. Sem categoria aparece em todas.
 */
export function visoesDeDespesa(db: Db, usuarioId: string, mes: string): { total_centavos: number; categoria: FatiaDespesa[]; grupo: FatiaDespesa[]; classe: FatiaDespesa[] } {
  const r = resumoMensal(db, usuarioId, mes);
  const classes = mapaDeClasses(db, usuarioId);
  const soma = (chave: (c: string) => { id: string; rotulo: string }) => {
    const m = new Map<string, FatiaDespesa>();
    for (const c of r.por_categoria) {
      const k = chave(c.categoria);
      const atual = m.get(k.id) ?? { id: k.id, rotulo: k.rotulo, total_centavos: 0 };
      atual.total_centavos += c.total_centavos;
      m.set(k.id, atual);
    }
    return [...m.values()].sort((a, b) => b.total_centavos - a.total_centavos);
  };
  const semCategoria = (c: string) => c === "nao_classificado";
  return {
    total_centavos: r.despesas_centavos,
    categoria: soma((c) => ({ id: c, rotulo: rotuloCategoria(c) })),
    grupo: soma((c) => (semCategoria(c) ? { id: "sem_categoria", rotulo: "Sem categoria" } : { id: grupoDaCategoria(c), rotulo: grupoDaCategoria(c) })),
    classe: soma((c) => {
      const k = semCategoria(c) ? null : classes.get(c) ?? null;
      return k ? { id: k, rotulo: CLASSES.find((x) => x.id === k)?.rotulo ?? k } : { id: "sem_classe", rotulo: "Sem classe" };
    }),
  };
}

export interface CelulaMapaCalor {
  dia_semana: number; // 0 = domingo
  hora: number;
  total_centavos: number;
  quantidade: number;
}

/**
 * Mapa de calor dia da semana x hora. Exclui lancamentos de horario desconhecido
 * e os de horario "aproximado" so entram se incluirAproximados for verdadeiro.
 */
export function mapaCalor(db: Db, usuarioId: string, de: string, ate: string, incluirAproximados = true): { celulas: CelulaMapaCalor[]; excluidos_sem_horario: number } {
  const precisoes = incluirAproximados ? "('exato','aproximado')" : "('exato')";
  const celulas = db
    .prepare(
      `SELECT CAST(strftime('%w', data_local) AS INTEGER) dia_semana, hora_local hora,
              SUM(valor_centavos) total_centavos, COUNT(*) quantidade
       FROM lancamento
       WHERE usuario_id = ? AND tipo = 'despesa' AND status != 'cancelado'
         AND data_local BETWEEN ? AND ? AND precisao_horario IN ${precisoes} AND hora_local IS NOT NULL
       GROUP BY dia_semana, hora ORDER BY dia_semana, hora`,
    )
    .all(usuarioId, de, ate) as CelulaMapaCalor[];
  const excluidos = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM lancamento WHERE usuario_id = ? AND tipo = 'despesa' AND status != 'cancelado'
         AND data_local BETWEEN ? AND ? AND (hora_local IS NULL OR precisao_horario NOT IN ${precisoes})`,
      )
      .get(usuarioId, de, ate) as { c: number }
  ).c;
  return { celulas, excluidos_sem_horario: excluidos };
}

export function calendarioMensal(db: Db, usuarioId: string, mes: string): { data: string; total_centavos: number; quantidade: number }[] {
  const dias = db
    .prepare(
      `SELECT data_local data, SUM(CASE WHEN tipo = 'despesa' THEN valor_centavos ELSE -valor_centavos END) total_centavos, SUM(CASE WHEN tipo = 'despesa' THEN 1 ELSE 0 END) quantidade FROM lancamento
       WHERE usuario_id = ? AND status != 'cancelado' AND substr(data_local,1,7) = ? AND (tipo = 'despesa' OR (tipo = 'receita' AND natureza = 'estorno'))
       GROUP BY data_local ORDER BY data_local`,
    )
    .all(usuarioId, mes) as { data: string; total_centavos: number; quantidade: number }[];
  // Um dia so com estorno ficaria negativo: o valor abate o gasto do dia anterior mais proximo (ou, na falta, do seguinte),
  // para que o total do calendario seja igual ao total de despesas do mes.
  for (let i = 0; i < dias.length; i++) {
    if (dias[i]!.total_centavos >= 0) continue;
    let falta = -dias[i]!.total_centavos;
    dias[i]!.total_centavos = 0;
    const ordem = [...dias.keys()].filter((k) => k !== i).sort((x, y) => (x < i ? 0 : 1) - (y < i ? 0 : 1) || Math.abs(x - i) - Math.abs(y - i));
    for (const k of ordem) {
      const tira = Math.min(falta, Math.max(0, dias[k]!.total_centavos));
      dias[k]!.total_centavos -= tira;
      falta -= tira;
      if (falta === 0) break;
    }
  }
  return dias.filter((d) => d.total_centavos > 0 || d.quantidade > 0).filter((d) => d.total_centavos > 0);
}

export interface FiltroLancamentos {
  mes?: string;
  /** Sem `status`, cancelados (excluídos) não aparecem. */
  status?: string;
  tipo?: string;
  categoria?: string;
  /** Busca por parte da descrição, sem distinguir acentos nem maiúsculas. */
  busca?: string;
  /** Só lançamentos de um evento (número) ou só os que não pertencem a nenhum ("nenhum"). */
  evento?: number | "nenhum";
  /** Só lançamentos até esta data (inclusive), AAAA-MM-DD: deixa de fora parcelas futuras previstas. */
  ate?: string;
  ordem?: "data_desc" | "data_asc" | "valor_desc" | "valor_asc";
  limite?: number;
}

const ORDENS: Record<NonNullable<FiltroLancamentos["ordem"]>, string> = {
  data_desc: "data_local DESC, id DESC",
  data_asc: "data_local ASC, id ASC",
  valor_desc: "valor_centavos DESC, data_local DESC, id DESC",
  valor_asc: "valor_centavos ASC, data_local DESC, id DESC",
};

export function listarLancamentos(db: Db, usuarioId: string, filtro: FiltroLancamentos) {
  const cond = ["usuario_id = ?"];
  const args: (string | number)[] = [usuarioId];
  if (filtro.mes) { cond.push("substr(data_local,1,7) = ?"); args.push(filtro.mes); }
  if (filtro.status) { cond.push("status = ?"); args.push(filtro.status); } else cond.push("status != 'cancelado'");
  if (filtro.tipo) { cond.push("tipo = ?"); args.push(filtro.tipo); }
  if (filtro.categoria) { cond.push("categoria = ?"); args.push(filtro.categoria); }
  if (filtro.busca?.trim()) { cond.push("estabelecimento_norm LIKE ?"); args.push(`%${normalizar(filtro.busca)}%`); }
  if (filtro.evento === "nenhum") cond.push("evento_id IS NULL");
  else if (typeof filtro.evento === "number") { cond.push("evento_id = ?"); args.push(filtro.evento); }
  if (filtro.ate) { cond.push("data_local <= ?"); args.push(filtro.ate); }
  const lim = Math.min(Math.max(filtro.limite ?? 500, 1), 2000);
  // "prevista": parcela futura projetada, ainda sem lancamento real de extrato ou fatura.
  const prevista = "(EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = lancamento.id AND o.origem = 'parcela_prevista') AND NOT EXISTS (SELECT 1 FROM lancamento_origem o2 WHERE o2.lancamento_id = lancamento.id AND o2.origem != 'parcela_prevista'))";
  return db.prepare(`SELECT lancamento.*, ${prevista} AS prevista FROM lancamento WHERE ${cond.join(" AND ")} ORDER BY ${ORDENS[filtro.ordem ?? "data_desc"]} LIMIT ${lim}`).all(...args);
}


export interface ParcelasDoMes {
  mes: string;
  total_centavos: number;
  quantidade: number;
  itens: { id: number; descricao: string; data_local: string; parcela_atual: number; parcela_total: number; valor_centavos: number }[];
}

/**
 * Fluxo de caixa das compras parceladas: o que já está comprometido nos meses seguintes (parcelas previstas, ainda sem lançamento
 * real de fatura), mês a mês, a partir de `mesInicial`.
 */
export function parcelasFuturas(db: Db, usuarioId: string, mesInicial: string, n = 6): ParcelasDoMes[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.descricao, l.data_local, l.parcela_atual, l.parcela_total, l.valor_centavos FROM lancamento l
       WHERE l.usuario_id = ? AND l.status != 'cancelado' AND l.tipo = 'despesa' AND substr(l.data_local,1,7) >= ?
         AND EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = l.id AND o.origem = 'parcela_prevista')
         AND NOT EXISTS (SELECT 1 FROM lancamento_origem o2 WHERE o2.lancamento_id = l.id AND o2.origem != 'parcela_prevista')
       ORDER BY l.data_local, l.id`,
    )
    .all(usuarioId, mesInicial) as ParcelasDoMes["itens"];
  const meses = new Map<string, ParcelasDoMes>();
  for (const r of rows) {
    const mes = r.data_local.slice(0, 7);
    const m = meses.get(mes) ?? { mes, total_centavos: 0, quantidade: 0, itens: [] };
    m.total_centavos += r.valor_centavos;
    m.quantidade++;
    m.itens.push(r);
    meses.set(mes, m);
  }
  return [...meses.values()].slice(0, n);
}
