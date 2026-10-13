import { test } from "node:test";
import assert from "node:assert/strict";
import { aliquotaRegressiva, aporteNecessario, prazoParaAtingir, projetar, taxaMensal, taxaReal } from "../src/metas/calculos.js";

const perto = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);
const ANUAL_1PCT_MES = Math.pow(1.01, 12) - 1; // 1% ao mes exato

test("valor futuro de anuidade: 1.000 por mes, 12 meses, 1% a.m. = 12.682,50 (valor de tabela)", () => {
  const p = projetar({ aporteInicial: 0, aporteMensal: 1000, meses: 12, retornoNominalAnual: ANUAL_1PCT_MES, ir: { tipo: "isento" } });
  perto(p.valor_bruto, 12682.5, 0.01);
  perto(p.total_aportado, 12000);
});

test("aporte inicial: 10.000 a 1% a.m. por 12 meses = 11.268,25", () => {
  perto(projetar({ aporteInicial: 10000, aporteMensal: 0, meses: 12, retornoNominalAnual: ANUAL_1PCT_MES, ir: { tipo: "isento" } }).valor_bruto, 11268.25, 0.01);
});

test("conversao de taxas", () => {
  perto(taxaMensal(Math.pow(1.01, 12) - 1), 0.01, 1e-12);
  perto(taxaReal(0.10, 0.05), 0.047619, 1e-6); // 1,10/1,05 - 1
});

test("aliquota regressiva por prazo", () => {
  assert.equal(aliquotaRegressiva(180), 0.225);
  assert.equal(aliquotaRegressiva(181), 0.2);
  assert.equal(aliquotaRegressiva(361), 0.175);
  assert.equal(aliquotaRegressiva(721), 0.15);
});

test("IR incide so sobre o ganho: aporte inicial 10.000, 12 meses, 15% fixo", () => {
  const p = projetar({ aporteInicial: 10000, aporteMensal: 0, meses: 12, retornoNominalAnual: ANUAL_1PCT_MES, ir: { tipo: "fixa", aliquota: 0.15 } });
  perto(p.ir, 0.15 * 1268.25, 0.01);
  perto(p.valor_liquido, 11268.25 - 190.24, 0.01);
});

test("aporte necessario sem IR e sem inflacao: meta 12.682,50 em 12 meses a 1% a.m. = 1.000", () => {
  const r = aporteNecessario({ valorAlvoHoje: 12682.5, aporteInicial: 0, meses: 12, retornoNominalAnual: ANUAL_1PCT_MES, ipcaAnual: 0, ir: { tipo: "isento" } });
  perto(r.aporte_mensal_necessario, 1000, 0.01);
});

test("consistencia: projetar com o aporte calculado reproduz a meta liquida (com IR e inflacao)", () => {
  const base = { valorAlvoHoje: 100000, aporteInicial: 5000, meses: 60, retornoNominalAnual: 0.1, ipcaAnual: 0.045, ir: { tipo: "regressivo" } as const };
  const r = aporteNecessario(base);
  const pr = projetar({ aporteInicial: 5000, aporteMensal: r.aporte_mensal_necessario, meses: 60, retornoNominalAnual: 0.1, ir: base.ir });
  perto(pr.valor_liquido, r.valor_alvo_nominal, 0.01);
  perto(r.valor_alvo_nominal, 100000 * Math.pow(1.045, 5), 0.01);
});

test("prazo e aporte sao inversos: aporte calculado para N meses leva a N meses", () => {
  const base = { valorAlvoHoje: 50000, aporteInicial: 0, retornoNominalAnual: 0.1, ipcaAnual: 0.04, ir: { tipo: "fixa", aliquota: 0.15 } as const };
  const r = aporteNecessario({ ...base, meses: 36 });
  assert.equal(prazoParaAtingir({ ...base, aporteMensal: r.aporte_mensal_necessario + 0.01 }), 36);
  assert.equal(prazoParaAtingir({ ...base, aporteMensal: r.aporte_mensal_necessario - 1 }), 37);
});

test("aporte inicial ja basta: aporte necessario zero", () => {
  const r = aporteNecessario({ valorAlvoHoje: 1000, aporteInicial: 50000, meses: 12, retornoNominalAnual: 0.1, ipcaAnual: 0.04, ir: { tipo: "isento" } });
  assert.equal(r.aporte_mensal_necessario, 0);
  assert.equal(r.atingida_sem_aportes, true);
});

test("prazo invalido e recusado; meta inalcancavel retorna null", () => {
  assert.throws(() => aporteNecessario({ valorAlvoHoje: 1, aporteInicial: 0, meses: 0, retornoNominalAnual: 0.1, ipcaAnual: 0, ir: { tipo: "isento" } }));
  assert.equal(prazoParaAtingir({ valorAlvoHoje: 1e9, aporteInicial: 0, aporteMensal: 1, retornoNominalAnual: 0.02, ipcaAnual: 0.05, ir: { tipo: "isento" } }), null);
});
