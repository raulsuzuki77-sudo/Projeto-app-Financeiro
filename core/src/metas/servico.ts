import type { Db } from "../db/tipos";
import { aporteNecessario, prazoParaAtingir, projetar, reservaEmergencia, type ModoIR } from "./calculos";

export const CENARIOS = ["conservador", "moderado", "arrojado"] as const;
export type Cenario = (typeof CENARIOS)[number];

export interface Premissa {
  chave: Cenario | "ipca";
  retorno_nominal_aa: number;
  ir_modo: "regressivo" | "fixa" | "isento";
  ir_aliquota: number | null;
  atualizada_em: string | null;
}

/**
 * Valores iniciais ILUSTRATIVOS, escolhidos para exemplo; não refletem a taxa Selic, o CDI ou o IPCA atuais
 * nem qualquer projeção. O usuário deve atualizá-los com fontes oficiais (ex.: séries do Banco Central).
 * Enquanto não forem editados, `atualizada_em` vem nulo e a API sinaliza premissas_padrao = true.
 */
const PADRAO: Record<Premissa["chave"], Omit<Premissa, "chave" | "atualizada_em">> = {
  conservador: { retorno_nominal_aa: 0.08, ir_modo: "regressivo", ir_aliquota: null },
  moderado: { retorno_nominal_aa: 0.1, ir_modo: "regressivo", ir_aliquota: null },
  arrojado: { retorno_nominal_aa: 0.12, ir_modo: "fixa", ir_aliquota: 0.15 },
  ipca: { retorno_nominal_aa: 0.045, ir_modo: "isento", ir_aliquota: null },
};

export function lerPremissas(db: Db, usuarioId: string): { premissas: Premissa[]; premissas_padrao: boolean } {
  const rows = db.prepare("SELECT chave, retorno_nominal_aa, ir_modo, ir_aliquota, atualizada_em FROM premissa WHERE usuario_id = ?").all(usuarioId) as Premissa[];
  const porChave = new Map(rows.map((r) => [r.chave, r]));
  const premissas = (["conservador", "moderado", "arrojado", "ipca"] as const).map((c) => porChave.get(c) ?? { chave: c, ...PADRAO[c], atualizada_em: null });
  return { premissas, premissas_padrao: premissas.some((p) => p.atualizada_em === null) };
}

export function salvarPremissa(db: Db, usuarioId: string, p: { chave: string; retorno_nominal_aa: number; ir_modo?: string; ir_aliquota?: number | null }): void {
  if (!["conservador", "moderado", "arrojado", "ipca"].includes(p.chave)) throw new Error("chave de premissa invalida");
  if (!Number.isFinite(p.retorno_nominal_aa) || p.retorno_nominal_aa < 0 || p.retorno_nominal_aa > 1) throw new Error("retorno anual deve estar entre 0 e 1 (ex.: 0,10 para 10%)");
  const modo = p.ir_modo ?? (p.chave === "ipca" ? "isento" : "regressivo");
  if (!["regressivo", "fixa", "isento"].includes(modo)) throw new Error("ir_modo invalido");
  if (modo === "fixa" && !(typeof p.ir_aliquota === "number" && p.ir_aliquota >= 0 && p.ir_aliquota <= 0.5)) throw new Error("ir_aliquota deve estar entre 0 e 0,5");
  db.prepare(
    `INSERT INTO premissa (usuario_id, chave, retorno_nominal_aa, ir_modo, ir_aliquota, atualizada_em) VALUES (?,?,?,?,?,?)
     ON CONFLICT (usuario_id, chave) DO UPDATE SET retorno_nominal_aa = excluded.retorno_nominal_aa, ir_modo = excluded.ir_modo, ir_aliquota = excluded.ir_aliquota, atualizada_em = excluded.atualizada_em`,
  ).run(usuarioId, p.chave, p.retorno_nominal_aa, modo, modo === "fixa" ? p.ir_aliquota : null, new Date().toISOString());
}

const modoIR = (p: Premissa): ModoIR => (p.ir_modo === "fixa" ? { tipo: "fixa", aliquota: p.ir_aliquota ?? 0 } : p.ir_modo === "isento" ? { tipo: "isento" } : { tipo: "regressivo" });

export interface Meta {
  id: number;
  nome: string;
  tipo: string;
  valor_alvo_centavos: number;
  aporte_inicial_centavos: number;
  prazo_meses: number;
  /** Perfil de risco escolhido pelo usuario para esta meta; define qual cenario e destacado. */
  perfil: Cenario;
}

function validarMeta(m: Omit<Meta, "id">): void {
  if (!m.nome.trim()) throw new Error("nome obrigatorio");
  if (!Number.isInteger(m.valor_alvo_centavos) || m.valor_alvo_centavos <= 0) throw new Error("valor alvo invalido");
  if (!Number.isInteger(m.aporte_inicial_centavos) || m.aporte_inicial_centavos < 0) throw new Error("aporte inicial invalido");
  if (!Number.isInteger(m.prazo_meses) || m.prazo_meses < 1 || m.prazo_meses > 1200) throw new Error("prazo deve estar entre 1 e 1200 meses");
  if (!["reserva_emergencia", "curto_prazo", "medio_prazo", "longo_prazo"].includes(m.tipo)) throw new Error("tipo de meta invalido");
  if (!(CENARIOS as readonly string[]).includes(m.perfil)) throw new Error("perfil deve ser conservador, moderado ou arrojado");
}

export function criarMeta(db: Db, usuarioId: string, m: Omit<Meta, "id">): number {
  validarMeta(m);
  const r = db
    .prepare("INSERT INTO meta (usuario_id, nome, tipo, valor_alvo_centavos, aporte_inicial_centavos, prazo_meses, perfil, criada_em) VALUES (?,?,?,?,?,?,?,?)")
    .run(usuarioId, m.nome.trim(), m.tipo, m.valor_alvo_centavos, m.aporte_inicial_centavos, m.prazo_meses, m.perfil, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

/** Atualização parcial: só os campos enviados mudam; o resultado final é revalidado por inteiro. */
export function atualizarMeta(db: Db, usuarioId: string, id: number, parcial: Partial<Omit<Meta, "id">>): Meta {
  const atual = listarMetas(db, usuarioId).find((x) => x.id === id);
  if (!atual) throw new Error("meta nao encontrada");
  const novo = { ...atual, ...Object.fromEntries(Object.entries(parcial).filter(([, v]) => v !== undefined)) } as Meta;
  validarMeta(novo);
  db.prepare("UPDATE meta SET nome = ?, tipo = ?, valor_alvo_centavos = ?, aporte_inicial_centavos = ?, prazo_meses = ?, perfil = ? WHERE id = ? AND usuario_id = ?")
    .run(novo.nome.trim(), novo.tipo, novo.valor_alvo_centavos, novo.aporte_inicial_centavos, novo.prazo_meses, novo.perfil, id, usuarioId);
  return { ...novo, nome: novo.nome.trim() };
}

export function listarMetas(db: Db, usuarioId: string): Meta[] {
  return db.prepare("SELECT id, nome, tipo, valor_alvo_centavos, aporte_inicial_centavos, prazo_meses, perfil FROM meta WHERE usuario_id = ? AND ativa = 1 ORDER BY id").all(usuarioId) as Meta[];
}

export function removerMeta(db: Db, usuarioId: string, id: number): boolean {
  return db.prepare("UPDATE meta SET ativa = 0 WHERE id = ? AND usuario_id = ? AND ativa = 1").run(id, usuarioId).changes > 0;
}

const c = (reais: number) => Math.round(reais * 100);

export interface CenarioMeta {
  cenario: Cenario;
  retorno_nominal_aa: number;
  taxa_real_aa: number;
  aporte_mensal_necessario_centavos: number;
  total_aportado_centavos: number;
  ir_estimado_centavos: number;
  valor_alvo_nominal_centavos: number;
  atingida_sem_aportes: boolean;
  /** Este e o cenario do perfil de risco escolhido para a meta. */
  perfil_da_meta: boolean;
  /** Se informado aporte mensal: prazo (meses) para atingir a meta com ele, nesse cenário; null = nunca em 100 anos. */
  prazo_com_aporte_meses?: number | null;
}

export function cenariosDaMeta(db: Db, usuarioId: string, meta: Meta, aporteMensalCentavos?: number) {
  const { premissas, premissas_padrao } = lerPremissas(db, usuarioId);
  const ipca = premissas.find((p) => p.chave === "ipca")!.retorno_nominal_aa;
  const cenarios: CenarioMeta[] = CENARIOS.map((nome) => {
    const p = premissas.find((x) => x.chave === nome)!;
    const base = { valorAlvoHoje: meta.valor_alvo_centavos / 100, aporteInicial: meta.aporte_inicial_centavos / 100, retornoNominalAnual: p.retorno_nominal_aa, ipcaAnual: ipca, ir: modoIR(p) };
    const r = aporteNecessario({ ...base, meses: meta.prazo_meses });
    const out: CenarioMeta = {
      cenario: nome,
      retorno_nominal_aa: p.retorno_nominal_aa,
      taxa_real_aa: r.taxa_real_anual,
      aporte_mensal_necessario_centavos: Math.ceil(r.aporte_mensal_necessario * 100 - 1e-6),
      total_aportado_centavos: c(r.total_aportado),
      ir_estimado_centavos: c(r.ir_estimado),
      valor_alvo_nominal_centavos: c(r.valor_alvo_nominal),
      atingida_sem_aportes: r.atingida_sem_aportes,
      perfil_da_meta: nome === meta.perfil,
    };
    if (aporteMensalCentavos !== undefined) out.prazo_com_aporte_meses = prazoParaAtingir({ ...base, aporteMensal: aporteMensalCentavos / 100 });
    return out;
  });
  return {
    meta,
    ipca_aa: ipca,
    cenarios,
    premissas_padrao,
    aviso: "Simulacao educacional baseada em premissas editaveis; nao e recomendacao de investimento nem promessa de rentabilidade. Rentabilidade passada ou assumida nao garante resultado futuro. Imposto simplificado (ver documentacao).",
  };
}

/** Últimos N meses fechados (exclui o mês corrente, ainda incompleto). */
function mesesFechados(referencia: Date, n: number): string[] {
  const out: string[] = [];
  for (let k = n; k >= 1; k--) {
    const d = new Date(referencia.getFullYear(), referencia.getMonth() - k, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Naturezas tratadas como despesa essencial (compromissos que continuam em perda de renda). */
export const NATUREZAS_ESSENCIAIS = ["fixo", "recorrente_variavel", "parcelado", "divida_juros_tarifas"] as const;

export function despesaEssencialMedia(db: Db, usuarioId: string, referencia = new Date(), nMeses = 3) {
  const meses = mesesFechados(referencia, nMeses);
  const marcas = NATUREZAS_ESSENCIAIS.map(() => "?").join(",");
  const por_mes = meses.map((mes) => {
    const r = db
      .prepare(`SELECT COALESCE(SUM(valor_centavos),0) t FROM lancamento WHERE usuario_id = ? AND tipo = 'despesa' AND status = 'confirmado' AND substr(data_local,1,7) = ? AND natureza IN (${marcas})`)
      .get(usuarioId, mes, ...NATUREZAS_ESSENCIAIS) as { t: number };
    return { mes, essencial_centavos: r.t };
  });
  const media = Math.round(por_mes.reduce((a, x) => a + x.essencial_centavos, 0) / nMeses);
  return { meses, por_mes, media_mensal_centavos: media, meses_sem_dados: por_mes.filter((x) => x.essencial_centavos === 0).map((x) => x.mes) };
}

export function reservaDeEmergencia(db: Db, usuarioId: string, mesesCobertura: number, referencia = new Date()) {
  if (!Number.isInteger(mesesCobertura) || mesesCobertura < 1 || mesesCobertura > 24) throw new Error("meses de cobertura deve estar entre 1 e 24");
  const d = despesaEssencialMedia(db, usuarioId, referencia);
  return { ...d, meses_cobertura: mesesCobertura, valor_alvo_centavos: Math.round(reservaEmergencia(d.media_mensal_centavos, mesesCobertura)), observacao: "Considera apenas lancamentos CONFIRMADOS de natureza fixa, recorrente variavel, parcelada e custos financeiros, nos ultimos 3 meses fechados. Confirme os pendentes para uma estimativa melhor." };
}

export function capacidadePoupanca(db: Db, usuarioId: string, referencia = new Date(), nMeses = 3) {
  const meses = mesesFechados(referencia, nMeses);
  const por_mes = meses.map((mes) => {
    const q = (tipo: string) => (db.prepare("SELECT COALESCE(SUM(valor_centavos),0) t FROM lancamento WHERE usuario_id = ? AND tipo = ? AND status = 'confirmado' AND substr(data_local,1,7) = ?").get(usuarioId, tipo, mes) as { t: number }).t;
    const receitas = q("receita");
    const despesas = q("despesa");
    return { mes, receitas_centavos: receitas, despesas_centavos: despesas, sobra_centavos: receitas - despesas };
  });
  return { por_mes, sobra_media_mensal_centavos: Math.round(por_mes.reduce((a, x) => a + x.sobra_centavos, 0) / nMeses), observacao: "Sobra = receitas - despesas confirmadas; investimentos e transferencias nao entram como despesa." };
}

export { projetar };
