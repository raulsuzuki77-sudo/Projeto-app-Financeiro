/**
 * Cálculos de metas de investimento. Funções puras, sem I/O.
 *
 * Simplificações assumidas e informadas ao usuário:
 *  - aportes no fim de cada mês, retorno constante e conhecido (é premissa, não previsão);
 *  - o imposto de renda é calculado sobre o ganho no horizonte inteiro. Na renda fixa a alíquota
 *    regressiva depende do tempo de cada aporte; usar a alíquota do horizonte para todos os aportes
 *    superestima o imposto (resultado conservador). Come-cotas, IOF e isenções não são modelados;
 *  - metas são informadas em valores de hoje e corrigidas pelo IPCA informado.
 */

export type ModoIR = { tipo: "regressivo" } | { tipo: "fixa"; aliquota: number } | { tipo: "isento" };

/** Alíquota regressiva da renda fixa por prazo (Lei 11.033/2004): 22,5% até 180 dias, 20%, 17,5% e 15% acima de 720 dias. */
export function aliquotaRegressiva(dias: number): number {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.2;
  if (dias <= 720) return 0.175;
  return 0.15;
}

export function aliquotaIR(modo: ModoIR, meses: number): number {
  if (modo.tipo === "isento") return 0;
  if (modo.tipo === "fixa") return modo.aliquota;
  return aliquotaRegressiva(Math.round(meses * 30.4375));
}

export function taxaMensal(taxaAnual: number): number {
  return Math.pow(1 + taxaAnual, 1 / 12) - 1;
}

/** Taxa real a partir da nominal e da inflação (equação de Fisher). */
export function taxaReal(nominalAnual: number, ipcaAnual: number): number {
  return (1 + nominalAnual) / (1 + ipcaAnual) - 1;
}

export interface ParametrosProjecao {
  aporteInicial: number;
  aporteMensal: number;
  meses: number;
  retornoNominalAnual: number;
  ir: ModoIR;
}

export interface Projecao {
  total_aportado: number;
  valor_bruto: number;
  ir: number;
  valor_liquido: number;
}

export function projetar(p: ParametrosProjecao): Projecao {
  const i = taxaMensal(p.retornoNominalAnual);
  const f = Math.pow(1 + i, p.meses);
  const anuidade = i === 0 ? p.meses : (f - 1) / i;
  const bruto = p.aporteInicial * f + p.aporteMensal * anuidade;
  const aportado = p.aporteInicial + p.aporteMensal * p.meses;
  const ganho = Math.max(0, bruto - aportado);
  const ir = ganho * aliquotaIR(p.ir, p.meses);
  return { total_aportado: aportado, valor_bruto: bruto, ir, valor_liquido: bruto - ir };
}

export interface ParametrosMeta {
  /** Valor da meta em moeda de hoje. */
  valorAlvoHoje: number;
  aporteInicial: number;
  meses: number;
  retornoNominalAnual: number;
  ipcaAnual: number;
  ir: ModoIR;
}

export interface ResultadoMeta {
  valor_alvo_nominal: number;
  aporte_mensal_necessario: number;
  /** Aporte mensal necessário expresso em moeda de hoje, para comparar com a renda atual. */
  taxa_real_anual: number;
  total_aportado: number;
  ir_estimado: number;
  /** O aporte inicial sozinho já atinge a meta no prazo. */
  atingida_sem_aportes: boolean;
}

/** Aporte mensal constante necessário para atingir a meta líquida de IR no prazo (solução fechada). */
export function aporteNecessario(p: ParametrosMeta): ResultadoMeta {
  if (p.meses < 1) throw new Error("prazo deve ter ao menos 1 mes");
  const alvo = p.valorAlvoHoje * Math.pow(1 + p.ipcaAnual, p.meses / 12);
  const i = taxaMensal(p.retornoNominalAnual);
  const t = aliquotaIR(p.ir, p.meses);
  const f = Math.pow(1 + i, p.meses);
  const a = i === 0 ? p.meses : (f - 1) / i;
  // liquido = bruto*(1-t) + t*aportado  (quando ha ganho)
  const g = f * (1 - t) + t; // efeito liquido do aporte inicial
  const k = a * (1 - t) + t * p.meses; // efeito liquido de cada aporte mensal
  const faltante = alvo - p.aporteInicial * g;
  const pmt = Math.max(0, faltante / k);
  const proj = projetar({ aporteInicial: p.aporteInicial, aporteMensal: pmt, meses: p.meses, retornoNominalAnual: p.retornoNominalAnual, ir: p.ir });
  return {
    valor_alvo_nominal: alvo,
    aporte_mensal_necessario: pmt,
    taxa_real_anual: taxaReal(p.retornoNominalAnual, p.ipcaAnual),
    total_aportado: proj.total_aportado,
    ir_estimado: proj.ir,
    atingida_sem_aportes: faltante <= 0,
  };
}

/** Meses necessários para atingir a meta (em moeda de hoje) com um aporte mensal dado; null se passar de 100 anos. */
export function prazoParaAtingir(p: Omit<ParametrosMeta, "meses"> & { aporteMensal: number }): number | null {
  for (let m = 1; m <= 1200; m++) {
    const alvo = p.valorAlvoHoje * Math.pow(1 + p.ipcaAnual, m / 12);
    const pr = projetar({ aporteInicial: p.aporteInicial, aporteMensal: p.aporteMensal, meses: m, retornoNominalAnual: p.retornoNominalAnual, ir: p.ir });
    if (pr.valor_liquido >= alvo) return m;
  }
  return null;
}

/** Reserva de emergência: meses de cobertura x despesa essencial mensal média. */
export function reservaEmergencia(despesaEssencialMensal: number, mesesCobertura: number): number {
  return despesaEssencialMensal * mesesCobertura;
}
