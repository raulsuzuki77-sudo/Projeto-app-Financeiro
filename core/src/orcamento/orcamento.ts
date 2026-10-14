import { CATEGORIAS, CLASSES, classePadraoDaCategoria, rotuloCategoria, type ClasseId } from "../classification/categorias";
import type { Db } from "../db/tipos";
import { cenariosDaMeta, listarMetas } from "../metas/servico";

export const ITEM_RECEITA = "__receita";
const PADRAO = "*";
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const IDS_CLASSE = new Set<string>(CLASSES.map((c) => c.id));

/** Classe do orçamento da categoria: a escolhida pelo usuário ou, na falta, a padrão. */
export function classeDaCategoria(db: Db, usuarioId: string, categoria: string): ClasseId | null {
  const r = db.prepare("SELECT classe FROM classe_categoria WHERE usuario_id = ? AND categoria = ?").get(usuarioId, categoria) as { classe: string } | undefined;
  return r ? (r.classe as ClasseId) : classePadraoDaCategoria(categoria);
}

export function mapaDeClasses(db: Db, usuarioId: string): Map<string, ClasseId | null> {
  const m = new Map<string, ClasseId | null>(CATEGORIAS.map((c) => [c.id, c.classe]));
  for (const r of db.prepare("SELECT categoria, classe FROM classe_categoria WHERE usuario_id = ?").all(usuarioId) as { categoria: string; classe: string }[]) m.set(r.categoria, r.classe as ClasseId);
  return m;
}

/** Muda a classe de uma categoria; `null` volta ao padrão. */
export function definirClasse(db: Db, usuarioId: string, categoria: string, classe: ClasseId | null): void {
  if (classe === null) {
    db.prepare("DELETE FROM classe_categoria WHERE usuario_id = ? AND categoria = ?").run(usuarioId, categoria);
    return;
  }
  if (!IDS_CLASSE.has(classe)) throw new Error("Classe inválida.");
  db.prepare("INSERT INTO classe_categoria (usuario_id, categoria, classe) VALUES (?,?,?) ON CONFLICT (usuario_id, categoria) DO UPDATE SET classe = excluded.classe").run(usuarioId, categoria, classe);
}

/** Define o valor planejado de um item (categoria ou receita). `mes` = "*" vale para todos os meses sem valor próprio. */
export function definirOrcamento(db: Db, usuarioId: string, mes: string, item: string, valorCentavos: number): void {
  if (mes !== PADRAO && !MES.test(mes)) throw new Error("Mês inválido (use AAAA-MM ou *).");
  if (!Number.isInteger(valorCentavos) || valorCentavos < 0) throw new Error("O valor planejado não pode ser negativo.");
  if (item !== ITEM_RECEITA && !item.trim()) throw new Error("Item inválido.");
  db.prepare("INSERT INTO orcamento (usuario_id, mes, item, valor_centavos) VALUES (?,?,?,?) ON CONFLICT (usuario_id, mes, item) DO UPDATE SET valor_centavos = excluded.valor_centavos").run(usuarioId, mes, item, valorCentavos);
}

export function removerOrcamento(db: Db, usuarioId: string, mes: string, item: string): void {
  db.prepare("DELETE FROM orcamento WHERE usuario_id = ? AND mes = ? AND item = ?").run(usuarioId, mes, item);
}

interface Plano {
  valor: number;
  origem: "mes" | "padrao";
}

/** Valores planejados válidos para o mês: o do próprio mês, ou o padrão ("*") quando não há. */
export function planoDoMes(db: Db, usuarioId: string, mes: string): Map<string, Plano> {
  const m = new Map<string, Plano>();
  const rows = db.prepare("SELECT mes, item, valor_centavos FROM orcamento WHERE usuario_id = ? AND mes IN (?, ?)").all(usuarioId, PADRAO, mes) as { mes: string; item: string; valor_centavos: number }[];
  for (const r of rows.filter((x) => x.mes === PADRAO)) m.set(r.item, { valor: r.valor_centavos, origem: "padrao" });
  for (const r of rows.filter((x) => x.mes === mes)) m.set(r.item, { valor: r.valor_centavos, origem: "mes" });
  return m;
}

/**
 * Realizado do mês por categoria. Gastos e aportes somam; estornos abatem; resgates de investimento abatem o aporte da categoria
 * "investimento" (aporte líquido), pois as caixinhas giram o mesmo dinheiro. Pendentes entram, mas são contados à parte.
 */
function realizadoPorCategoria(db: Db, usuarioId: string, mes: string): Map<string, { valor: number; quantidade: number; pendentes: number }> {
  const rows = db
    .prepare(
      `SELECT CASE WHEN categoria = 'resgate_investimento' THEN 'investimento' ELSE categoria END cat,
              SUM(CASE WHEN tipo IN ('despesa','investimento') THEN valor_centavos ELSE -valor_centavos END) valor,
              COUNT(*) quantidade, SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) pendentes
       FROM lancamento
       WHERE usuario_id = ? AND status != 'cancelado' AND substr(data_local,1,7) = ?
         AND (tipo IN ('despesa','investimento') OR (tipo = 'receita' AND natureza = 'estorno') OR (tipo = 'transferencia' AND categoria = 'resgate_investimento'))
       GROUP BY cat`,
    )
    .all(usuarioId, mes) as { cat: string; valor: number; quantidade: number; pendentes: number }[];
  return new Map(rows.map((r) => [r.cat, { valor: r.valor, quantidade: r.quantidade, pendentes: r.pendentes }]));
}

export type Situacao = "ok" | "atencao" | "estourou" | "sem_plano";

function situacao(planejado: number, realizado: number): Situacao {
  if (planejado <= 0) return realizado > 0 ? "sem_plano" : "ok";
  if (realizado > planejado) return "estourou";
  return realizado >= planejado * 0.8 ? "atencao" : "ok";
}

export interface ItemOrcamento {
  categoria: string;
  rotulo: string;
  planejado_centavos: number;
  realizado_centavos: number;
  /** De onde vem o valor planejado: do próprio mês, do padrão, ou nenhum. */
  origem_plano: "mes" | "padrao" | null;
  quantidade: number;
  pendentes: number;
  situacao: Situacao;
}

export interface ClasseOrcamento {
  id: ClasseId | "sem_classe";
  rotulo: string;
  exemplos: string;
  planejado_centavos: number;
  realizado_centavos: number;
  situacao: Situacao;
  itens: ItemOrcamento[];
}

export interface PainelOrcamento {
  mes: string;
  receita: { planejada_centavos: number; realizada_centavos: number; origem_plano: "mes" | "padrao" | null };
  despesa: { planejada_centavos: number; realizada_centavos: number };
  superavit: { planejado_centavos: number; realizado_centavos: number };
  superavit_diario_planejado_centavos: number;
  classes: ClasseOrcamento[];
  /** Categorias que podem receber valor planejado, com a classe em vigor. */
  categorias: { id: string; rotulo: string; classe: ClasseId }[];
  alertas: { tipo: "estourou" | "atencao" | "sem_plano"; item: string; rotulo: string; planejado_centavos: number; realizado_centavos: number }[];
  pendentes: number;
}

function diasDoMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

export function painelOrcamento(db: Db, usuarioId: string, mes: string): PainelOrcamento {
  if (!MES.test(mes)) throw new Error("Mês inválido (use AAAA-MM).");
  const plano = planoDoMes(db, usuarioId, mes);
  const real = realizadoPorCategoria(db, usuarioId, mes);
  const classes = mapaDeClasses(db, usuarioId);
  const itensPorClasse = new Map<string, ItemOrcamento[]>();

  const considerados = new Set<string>([...[...plano.keys()].filter((k) => k !== ITEM_RECEITA), ...real.keys()]);
  for (const cat of considerados) {
    const classe = classes.get(cat) ?? null;
    // categorias sem classe (transferencias, receitas) nao entram; "sem categoria" e personalizadas aparecem em "sem_classe"
    if (classe === null && CATEGORIAS.some((c) => c.id === cat) && cat !== "nao_classificado") continue;
    const chave = classe ?? "sem_classe";
    const p = plano.get(cat);
    const r = real.get(cat);
    const item: ItemOrcamento = {
      categoria: cat,
      rotulo: rotuloCategoria(cat),
      planejado_centavos: p?.valor ?? 0,
      realizado_centavos: r?.valor ?? 0,
      origem_plano: p?.origem ?? null,
      quantidade: r?.quantidade ?? 0,
      pendentes: r?.pendentes ?? 0,
      situacao: situacao(p?.valor ?? 0, r?.valor ?? 0),
    };
    if (item.planejado_centavos === 0 && item.realizado_centavos === 0) continue;
    (itensPorClasse.get(chave) ?? itensPorClasse.set(chave, []).get(chave)!).push(item);
  }

  const lista: ClasseOrcamento[] = [...CLASSES.map((c) => ({ id: c.id as ClasseOrcamento["id"], rotulo: c.rotulo, exemplos: c.exemplos })), { id: "sem_classe" as const, rotulo: "Sem classe", exemplos: "Gastos sem categoria ou de categoria personalizada" }]
    .map((c) => {
      const itens = (itensPorClasse.get(c.id) ?? []).sort((a, b) => b.realizado_centavos - a.realizado_centavos || b.planejado_centavos - a.planejado_centavos);
      const planejado = itens.reduce((s, i) => s + i.planejado_centavos, 0);
      const realizado = itens.reduce((s, i) => s + i.realizado_centavos, 0);
      return { ...c, planejado_centavos: planejado, realizado_centavos: realizado, situacao: situacao(planejado, realizado), itens };
    })
    .filter((c) => c.itens.length > 0 || c.id !== "sem_classe");

  const despPlan = lista.reduce((s, c) => s + c.planejado_centavos, 0);
  const despReal = lista.reduce((s, c) => s + c.realizado_centavos, 0);
  const receitaReal = (db.prepare("SELECT COALESCE(SUM(valor_centavos),0) t FROM lancamento WHERE usuario_id = ? AND status != 'cancelado' AND tipo = 'receita' AND natureza != 'estorno' AND substr(data_local,1,7) = ?").get(usuarioId, mes) as { t: number }).t;
  const recPlan = plano.get(ITEM_RECEITA);
  const alertas: PainelOrcamento["alertas"] = [];
  for (const c of lista) for (const i of c.itens) if (i.situacao !== "ok") alertas.push({ tipo: i.situacao, item: i.categoria, rotulo: i.rotulo, planejado_centavos: i.planejado_centavos, realizado_centavos: i.realizado_centavos });
  const ordem = { estourou: 0, atencao: 1, sem_plano: 2 } as const;
  alertas.sort((a, b) => ordem[a.tipo] - ordem[b.tipo] || b.realizado_centavos - a.realizado_centavos);
  const supPlan = (recPlan?.valor ?? 0) - despPlan;
  return {
    mes,
    receita: { planejada_centavos: recPlan?.valor ?? 0, realizada_centavos: receitaReal, origem_plano: recPlan?.origem ?? null },
    despesa: { planejada_centavos: despPlan, realizada_centavos: despReal },
    superavit: { planejado_centavos: supPlan, realizado_centavos: receitaReal - despReal },
    superavit_diario_planejado_centavos: Math.round(supPlan / diasDoMes(mes)),
    classes: lista,
    categorias: CATEGORIAS.map((c) => ({ id: c.id, rotulo: c.rotulo, classe: classes.get(c.id) ?? null })).filter((c): c is { id: string; rotulo: string; classe: ClasseId } => c.classe !== null),
    alertas,
    pendentes: [...real.values()].reduce((s, r) => s + r.pendentes, 0),
  };
}

function mesesAnteriores(mes: string, n: number): string[] {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let k = n; k >= 1; k--) {
    const t = a * 12 + (m - 1) - k;
    out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Sugestão de orçamento: média dos `n` meses anteriores a `mes`, por categoria (arredondada a R$ 10), com a receita média.
 * Só sugere; o usuário decide se grava (como padrão de todos os meses ou só para um mês).
 */
export function sugerirOrcamentoPelaMedia(db: Db, usuarioId: string, mes: string, n = 3): { item: string; rotulo: string; valor_centavos: number }[] {
  const meses = mesesAnteriores(mes, n);
  const soma = new Map<string, number>();
  for (const m of meses) for (const [cat, r] of realizadoPorCategoria(db, usuarioId, m)) soma.set(cat, (soma.get(cat) ?? 0) + r.valor);
  const classes = mapaDeClasses(db, usuarioId);
  const arred = (v: number) => Math.round(v / n / 1000) * 1000;
  const itens = [...soma.entries()]
    .filter(([cat, v]) => v > 0 && cat !== "nao_classificado" && (classes.get(cat) ?? "x") !== null)
    .map(([cat, v]) => ({ item: cat, rotulo: rotuloCategoria(cat), valor_centavos: arred(v) }))
    .filter((i) => i.valor_centavos > 0)
    .sort((a, b) => b.valor_centavos - a.valor_centavos);
  const marcas = meses.map(() => "?").join(",");
  const rec = (db.prepare(`SELECT COALESCE(SUM(valor_centavos),0) t FROM lancamento WHERE usuario_id = ? AND status != 'cancelado' AND tipo = 'receita' AND natureza != 'estorno' AND substr(data_local,1,7) IN (${marcas})`).get(usuarioId, ...meses) as { t: number }).t;
  if (rec > 0) itens.unshift({ item: ITEM_RECEITA, rotulo: "Receita", valor_centavos: arred(rec) });
  return itens;
}

/** Copia os valores em vigor de um mês para outro (como valores próprios do mês de destino). */
export function copiarOrcamento(db: Db, usuarioId: string, deMes: string, paraMes: string): number {
  if (!MES.test(deMes) || !MES.test(paraMes)) throw new Error("Mês inválido (use AAAA-MM).");
  const origem = planoDoMes(db, usuarioId, deMes);
  const tx = db.transaction(() => {
    for (const [item, p] of origem) definirOrcamento(db, usuarioId, paraMes, item, p.valor);
  });
  tx();
  return origem.size;
}

export interface OrcamentoVsMetas {
  mes: string;
  /** Planejado no orçamento para a classe "Liberdade financeira" (aportes, previdência, parcela do apartamento). */
  planejado_liberdade_centavos: number;
  realizado_liberdade_centavos: number;
  superavit_planejado_centavos: number;
  /** Soma dos aportes mensais necessários das metas ativas, no cenário do perfil de risco de cada uma. */
  aporte_necessario_metas_centavos: number;
  metas: { id: number; nome: string; perfil: string; aporte_mensal_necessario_centavos: number }[];
  /** Quanto falta (positivo) ou sobra (negativo) para cobrir as metas, contando só a Liberdade financeira. */
  lacuna_liberdade_centavos: number;
  /** Idem, contando também o superávit planejado (se positivo). */
  lacuna_com_superavit_centavos: number;
}

/**
 * Liga metas e orçamento: o orçamento diz quanto está reservado para investir; as metas dizem quanto precisam por mês
 * (simulação educacional, premissas editáveis). A comparação mostra se o planejado cobre o necessário.
 */
export function orcamentoVsMetas(db: Db, usuarioId: string, mes: string): OrcamentoVsMetas {
  const p = painelOrcamento(db, usuarioId, mes);
  const liberdade = p.classes.find((c) => c.id === "liberdade");
  const metas = listarMetas(db, usuarioId).map((m) => {
    const c = cenariosDaMeta(db, usuarioId, m).cenarios.find((x) => x.perfil_da_meta)!;
    return { id: m.id, nome: m.nome, perfil: m.perfil, aporte_mensal_necessario_centavos: c.aporte_mensal_necessario_centavos };
  });
  const necessario = metas.reduce((s, m) => s + m.aporte_mensal_necessario_centavos, 0);
  const plan = liberdade?.planejado_centavos ?? 0;
  const folga = Math.max(p.superavit.planejado_centavos, 0);
  return {
    mes,
    planejado_liberdade_centavos: plan,
    realizado_liberdade_centavos: liberdade?.realizado_centavos ?? 0,
    superavit_planejado_centavos: p.superavit.planejado_centavos,
    aporte_necessario_metas_centavos: necessario,
    metas,
    lacuna_liberdade_centavos: necessario - plan,
    lacuna_com_superavit_centavos: necessario - plan - folga,
  };
}
