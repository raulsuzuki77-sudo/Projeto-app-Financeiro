import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { abrirBancoTeste } from "./helpers";
import {
  adicionarPosicaoManual, aportesLancamentos, definirCambio, detectarExtrato, evolucaoPatrimonio, extratoJaImportado, lancarManual, lerExtratoInvestimento, listarExtratos,
  movimentosDoMes, patrimonio, removerExtrato, removerPosicao, salvarExtrato, variacaoDoMes,
  type ExtratoLido, type LinhaTexto, type MovimentoLido, type PosicaoLida,
} from "../src/index";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ler = (nome: string) => readFileSync(join(AQUI, "fixtures-investimentos", nome), "utf8").split("\n");
const comoLinhas = (ls: string[]): LinhaTexto[] => ls.filter((l) => l.trim() !== "").map((texto) => ({ texto }));

/** Mesmas linhas, nos tres jeitos em que o texto de um PDF costuma chegar. */
function variantes(nome: string): Record<string, LinhaTexto[]> {
  const bruto = ler(nome);
  return {
    pdftotext: comoLinhas(bruto),
    pdfjs: comoLinhas(bruto.map((l) => l.replace(/\s+/g, " ").trim())),
    celulas_em_linhas: comoLinhas(bruto.flatMap((l) => l.trim().split(/\s{3,}/))),
  };
}

function lerOk(linhas: LinhaTexto[]): ExtratoLido {
  const r = lerExtratoInvestimento(linhas);
  assert.ok(r.ok, r.ok ? "" : r.erro);
  return r.extrato;
}

// ---------------------------------------------------------------------------------------------
// Leitor BTG Brasil
// ---------------------------------------------------------------------------------------------

for (const [nome, linhas] of Object.entries(variantes("btg-brasil-sintetico.txt"))) {
  test(`BTG Brasil (${nome}): detecta, le secoes e confere o total`, () => {
    assert.equal(detectarExtrato(linhas), "btg_brasil");
    const e = lerOk(linhas);
    assert.equal(e.instituicao, "BTG Pactual");
    assert.equal(e.conta, "3456");
    assert.equal(e.moeda, "BRL");
    assert.equal(e.periodo_inicio, "2026-09-01");
    assert.equal(e.periodo_fim, "2026-09-30");

    const porClasse = (c: string) => e.posicoes.filter((p) => p.classe_ativo === c);
    assert.equal(e.posicoes.length, 8);
    assert.deepEqual(porClasse("previdencia").map((p) => [p.ativo, p.valor_centavos, p.quantidade]), [["FUNDO EXEMPLO PREV FI RF", 250000, 1000]]);
    assert.deepEqual(porClasse("renda_variavel").map((p) => [p.codigo, p.ativo, p.quantidade, p.valor_centavos]), [
      ["ABCD3", "EMPRESA ALFA ON NM (Ação)", 10, 20000],
      ["EFGH4", "EMPRESA BETA PN (Ação)", 5, 15050],
      ["IJKL11", "ETF EXEMPLO CI (ETF)", 2, 20000],
      ["MNOP11", "FII EXEMPLO CI (FII)", 4, 20100],
    ]);
    assert.deepEqual(porClasse("caixa").map((p) => p.valor_centavos), [100150]);
    assert.deepEqual(porClasse("transito").map((p) => [p.ativo, p.valor_centavos]), [["Valores em trânsito (renda variável)", -39680], ["Valores em trânsito (previdência)", 48000]]);

    assert.equal(e.total_declarado_centavos, 433620);
    assert.equal(e.conferencia.soma_posicoes_centavos, 433620);
    assert.equal(e.conferencia.diferenca_centavos, 0);
    assert.equal(e.conferencia.confere, true);
    assert.ok(e.conferencia.parciais.length >= 8 && e.conferencia.parciais.every((p) => p.confere));
  });

  test(`BTG Brasil (${nome}): movimentos normalizados, sem duplicar rendimento nem guardar contraparte`, () => {
    const e = lerOk(linhas);
    const m = (tipo: string, transito = false) => e.movimentos.filter((x) => x.tipo === tipo && x.em_transito === transito);
    assert.deepEqual(m("aporte").map((x) => [x.data_local, x.valor_centavos]), [["2026-09-10", 48000], ["2026-09-15", 100000]]);
    assert.deepEqual(m("aporte", true).map((x) => [x.data_local, x.valor_centavos]), [["2026-09-30", 48000]]);
    assert.deepEqual(m("custodia").map((x) => [x.codigo, x.valor_centavos]), [["ABCD3", 19500]]);
    assert.deepEqual(m("compra", true).map((x) => [x.codigo, x.data_local, x.valor_centavos]), [["IJKL11", "2026-10-01", 40000]]);
    // dividendo "N/D" assume o fim do periodo; o rendimento da conta corrente repete o da renda variavel e conta uma vez
    assert.deepEqual(m("provento", true).map((x) => [x.data_local, x.valor_centavos]), [["2026-09-30", 320]]);
    assert.equal(m("provento").length, 1);
    assert.ok(e.avisos.some((a) => a.includes("contados uma só vez")));
    assert.ok(e.movimentos.every((x) => !/FULANO/.test(x.descricao)));
    assert.ok(!JSON.stringify(e).includes("000123456"));
  });
}

test("BTG Brasil: divergencia entre soma e total declarado nunca e descartada", () => {
  const txt = ler("btg-brasil-sintetico.txt").join("\n").replace(/4\.336,20\s+4\.336,20/, "4.400,00 4.400,00");
  const e = lerOk(comoLinhas(txt.split("\n")));
  assert.equal(e.total_declarado_centavos, 440000);
  assert.equal(e.conferencia.confere, false);
  assert.equal(e.conferencia.diferenca_centavos, 433620 - 440000);
});

test("BTG Brasil: total de secao divergente aparece nas conferencias parciais", () => {
  const txt = ler("btg-brasil-sintetico.txt").join("\n").replace(/Total em Ações R\$\s+350,50/, "Total em Ações R$ 360,50");
  const e = lerOk(comoLinhas(txt.split("\n")));
  const p = e.conferencia.parciais.find((x) => x.rotulo.includes("Ação"));
  assert.ok(p && !p.confere && p.diferenca_centavos === -1000);
});

// ---------------------------------------------------------------------------------------------
// Leitor BTG US
// ---------------------------------------------------------------------------------------------

for (const [nome, linhas] of Object.entries(variantes("btg-us-sintetico.txt"))) {
  test(`BTG US (${nome}): posicoes em centavos de dolar, conferencia e atividade`, () => {
    assert.equal(detectarExtrato(linhas), "btg_us");
    const e = lerOk(linhas);
    assert.equal(e.moeda, "USD");
    assert.equal(e.conta, "9876");
    assert.equal(e.periodo_inicio, "2026-09-01");
    assert.equal(e.periodo_fim, "2026-09-30");
    assert.deepEqual(e.posicoes.map((p) => [p.classe_ativo, p.codigo, p.quantidade, p.valor_centavos]), [
      ["renda_fixa", "123456AB1", 1000, 98500],
      ["renda_fixa", "123456CD2", 1500, 151500],
      ["caixa", "DWBDS", 0.75, 75],
    ]);
    assert.ok(e.posicoes[1]!.ativo.endsWith("(Notes 05/30)"));
    assert.ok(e.posicoes[2]!.ativo.endsWith("BY SIPC)"));
    assert.equal(e.total_declarado_centavos, 250075);
    assert.equal(e.conferencia.soma_posicoes_centavos, 250075);
    assert.equal(e.conferencia.confere, true);
    assert.ok(e.conferencia.parciais.length === 4 && e.conferencia.parciais.every((p) => p.confere));
    assert.deepEqual(e.movimentos.map((x) => [x.data_local, x.tipo, x.valor_centavos]), [
      ["2026-09-02", "aporte", 300000],
      ["2026-09-24", "custodia", 0],
      ["2026-09-24", "custodia", 75],
    ]);
    assert.ok(e.avisos.some((a) => a.includes("ACATS")));
    assert.ok(!JSON.stringify(e).includes("ZZZZ009876"));
  });
}

// ---------------------------------------------------------------------------------------------
// Recusa
// ---------------------------------------------------------------------------------------------

test("texto nao reconhecido: mensagem clara, sem excecao", () => {
  assert.equal(detectarExtrato(comoLinhas(["Fatura do cartao", "03/09/2026 LOJA X R$ 90,00"])), null);
  const r = lerExtratoInvestimento(comoLinhas(["Fatura do cartao", "03/09/2026 LOJA X R$ 90,00"]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /não reconhecido/);
  assert.equal(lerExtratoInvestimento([]).ok, false);
});

test("extrato reconhecido sem posicoes legiveis: recusa com motivo", () => {
  const so = ler("btg-us-sintetico.txt").join("\n").replace(/HOLDINGS[\s\S]*?ACTIVITY/, "ACTIVITY");
  const r = lerExtratoInvestimento(comoLinhas(so.split("\n")));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /nenhuma posição/);
});

// ---------------------------------------------------------------------------------------------
// Servico
// ---------------------------------------------------------------------------------------------

const U = "u";
const pos = (classe: PosicaoLida["classe_ativo"], ativo: string, valor: number): PosicaoLida => ({ classe_ativo: classe, ativo, codigo: null, quantidade: null, valor_centavos: valor });
const mov = (data: string, tipo: MovimentoLido["tipo"], valor: number, transito = false): MovimentoLido => ({ data_local: data, tipo, descricao: `${tipo} teste`, codigo: null, valor_centavos: valor, em_transito: transito });

function extrato(p: { mes: string; posicoes: PosicaoLida[]; movimentos?: MovimentoLido[]; conta?: string; moeda?: "BRL" | "USD"; instituicao?: string }): ExtratoLido {
  const soma = p.posicoes.reduce((a, x) => a + x.valor_centavos, 0);
  const [a, m] = p.mes.split("-").map(Number) as [number, number];
  const ult = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return {
    leitor: "btg_brasil", instituicao: p.instituicao ?? "Banco Teste", conta: p.conta ?? "1111", moeda: p.moeda ?? "BRL", periodo_inicio: `${p.mes}-01`, periodo_fim: `${p.mes}-${ult}`,
    posicoes: p.posicoes, movimentos: p.movimentos ?? [], total_declarado_centavos: soma, conferencia: { soma_posicoes_centavos: soma, total_declarado_centavos: soma, diferenca_centavos: 0, confere: true, parciais: [] }, avisos: [],
  };
}

const contar = (db: ReturnType<typeof abrirBancoTeste>, t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;

test("salvarExtrato e idempotente pelo hash e grava posicoes e movimentos", () => {
  const db = abrirBancoTeste();
  const e = lerOk(comoLinhas(ler("btg-brasil-sintetico.txt")));
  assert.equal(extratoJaImportado(db, U, "h1"), false);
  const r1 = salvarExtrato(db, U, e, "h1");
  assert.equal(r1.status, "salvo");
  assert.equal(extratoJaImportado(db, U, "h1"), true);
  const r2 = salvarExtrato(db, U, e, "h1");
  assert.equal(r2.status, "ja_importado");
  assert.equal(contar(db, "extrato_investimento"), 1);
  assert.equal(contar(db, "posicao_investimento"), 8);
  assert.equal(contar(db, "movimento_investimento"), e.movimentos.length);
  const lista = listarExtratos(db, U);
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.soma_posicoes_centavos, 433620);
  assert.equal(lista[0]!.total_declarado_centavos, 433620);
  assert.equal(patrimonio(db, U, "2026-09").total_centavos, 433620);
  assert.equal(removerExtrato(db, U, lista[0]!.id), true);
  assert.equal(contar(db, "posicao_investimento") + contar(db, "movimento_investimento") + contar(db, "extrato_investimento"), 0);
});

test("novo extrato da mesma conta e mes substitui as posicoes anteriores", () => {
  const db = abrirBancoTeste();
  salvarExtrato(db, U, extrato({ mes: "2026-09", posicoes: [pos("caixa", "A", 1000), pos("renda_fixa", "B", 2000)], movimentos: [mov("2026-09-05", "aporte", 500)] }), "h1");
  // mesma conta e periodo, arquivo corrigido (outro hash)
  const r = salvarExtrato(db, U, extrato({ mes: "2026-09", posicoes: [pos("caixa", "A", 1500)], movimentos: [mov("2026-09-05", "aporte", 500)] }), "h2");
  assert.equal(r.status, "salvo");
  if (r.status === "salvo") assert.equal(r.substituidas, 2);
  assert.equal(contar(db, "posicao_investimento"), 1);
  assert.equal(contar(db, "extrato_investimento"), 1);
  assert.equal(contar(db, "movimento_investimento"), 1);
  assert.equal(patrimonio(db, U, "2026-09").total_centavos, 1500);
  // outra conta no mesmo mes nao e tocada
  salvarExtrato(db, U, extrato({ mes: "2026-09", conta: "2222", posicoes: [pos("caixa", "C", 700)] }), "h3");
  assert.equal(patrimonio(db, U, "2026-09").total_centavos, 2200);
  salvarExtrato(db, U, extrato({ mes: "2026-09", posicoes: [pos("caixa", "A", 1600)] }), "h4");
  assert.equal(patrimonio(db, U, "2026-09").total_centavos, 2300);
});

test("patrimonio: snapshot defasado e marcado e entra no total", () => {
  const db = abrirBancoTeste();
  salvarExtrato(db, U, extrato({ mes: "2026-08", conta: "1111", posicoes: [pos("caixa", "A", 1000)] }), "h1");
  salvarExtrato(db, U, extrato({ mes: "2026-09", conta: "2222", instituicao: "Outro Banco", posicoes: [pos("renda_fixa", "B", 4000)] }), "h2");
  const p = patrimonio(db, U, "2026-09");
  assert.equal(p.total_centavos, 5000);
  assert.deepEqual(p.defasadas.map((c) => [c.instituicao, c.mes_snapshot]), [["Banco Teste", "2026-08"]]);
  assert.equal(p.posicoes.find((x) => x.ativo === "A")!.defasado, true);
  assert.equal(p.posicoes.find((x) => x.ativo === "B")!.defasado, false);
  // totais iguais nas duas visoes
  assert.equal(p.por_classe.reduce((s, c) => s + c.total_centavos, 0), 5000);
  assert.equal(p.por_instituicao.reduce((s, c) => s + c.total_centavos, 0), 5000);
  assert.equal(patrimonio(db, U, "2026-07").sem_dados, true);
  assert.equal(patrimonio(db, U, "2026-08").total_centavos, 1000);
  assert.throws(() => patrimonio(db, U, "2026-13"));
});

test("cambio: converte USD pela taxa do mes, usa a ultima conhecida e deixa de fora quando nao ha taxa", () => {
  const db = abrirBancoTeste();
  salvarExtrato(db, U, extrato({ mes: "2026-09", conta: "9999", moeda: "USD", instituicao: "Corretora US", posicoes: [pos("renda_fixa", "T-Bill", 100000), pos("caixa", "Caixa", 33)] }), "h1");
  salvarExtrato(db, U, extrato({ mes: "2026-09", posicoes: [pos("caixa", "A", 50000)] }), "h2");

  let p = patrimonio(db, U, "2026-09");
  assert.equal(p.total_centavos, 50000);
  assert.deepEqual(p.cambio_ausente.map((c) => c.moeda), ["USD"]);
  assert.ok(p.posicoes.filter((x) => x.moeda === "USD").every((x) => x.valor_centavos === null));

  definirCambio(db, U, "2026-09", "USD", 5.4321);
  p = patrimonio(db, U, "2026-09");
  assert.equal(p.cambio_ausente.length, 0);
  assert.equal(p.posicoes.find((x) => x.ativo === "T-Bill")!.valor_centavos, 543210);
  assert.equal(p.posicoes.find((x) => x.ativo === "Caixa")!.valor_centavos, 179); // 33 x 5,4321 = 179,2593
  assert.equal(p.total_centavos, 50000 + 543210 + 179);
  assert.equal(p.por_classe.reduce((s, c) => s + c.total_centavos, 0), p.total_centavos);
  assert.equal(p.por_instituicao.reduce((s, c) => s + c.total_centavos, 0), p.total_centavos);

  // sem taxa do mes: usa a ultima conhecida e marca como defasada
  salvarExtrato(db, U, extrato({ mes: "2026-10", conta: "9999", moeda: "USD", instituicao: "Corretora US", posicoes: [pos("renda_fixa", "T-Bill", 200000)] }), "h3");
  p = patrimonio(db, U, "2026-10");
  const usd = p.contas.find((c) => c.moeda === "USD")!;
  assert.equal(usd.cambio_defasado, true);
  assert.equal(usd.mes_taxa, "2026-09");
  assert.equal(usd.total_centavos, 1086420);
  definirCambio(db, U, "2026-10", "USD", 6);
  assert.equal(patrimonio(db, U, "2026-10").contas.find((c) => c.moeda === "USD")!.total_centavos, 1200000);
  assert.throws(() => definirCambio(db, U, "2026-10", "USD", 0));
  assert.throws(() => definirCambio(db, U, "2026-10", "BRL", 1));
});

test("posicao manual: valida, entra no patrimonio e so ela pode ser removida", () => {
  const db = abrirBancoTeste();
  const id = adicionarPosicaoManual(db, U, { mes: "2026-09", instituicao: "Banco Manual", classe_ativo: "renda_fixa", ativo: "CDB exemplo", valor_centavos: 123456 });
  assert.equal(patrimonio(db, U, "2026-09").total_centavos, 123456);
  assert.equal(patrimonio(db, U, "2026-09").posicoes[0]!.origem, "manual");
  assert.throws(() => adicionarPosicaoManual(db, U, { mes: "2026-9", instituicao: "X", classe_ativo: "caixa", ativo: "Y", valor_centavos: 1 }));
  assert.throws(() => adicionarPosicaoManual(db, U, { mes: "2026-09", instituicao: "X", classe_ativo: "caixa", ativo: "Y", valor_centavos: 0 }));
  assert.throws(() => adicionarPosicaoManual(db, U, { mes: "2026-09", instituicao: " ", classe_ativo: "caixa", ativo: "Y", valor_centavos: 1 }));
  salvarExtrato(db, U, extrato({ mes: "2026-09", posicoes: [pos("caixa", "A", 1000)] }), "h1");
  const idExtrato = (db.prepare("SELECT id FROM posicao_investimento WHERE origem = 'extrato'").get() as { id: number }).id;
  assert.throws(() => removerPosicao(db, U, idExtrato), /extrato/);
  assert.equal(removerPosicao(db, U, id), true);
  assert.equal(removerPosicao(db, U, id), false);
  assert.equal(patrimonio(db, U, "2026-09").total_centavos, 1000);
});

test("variacao e rentabilidade estimada: variacao menos aportes, com a nota de estimativa", () => {
  const db = abrirBancoTeste();
  salvarExtrato(db, U, extrato({ mes: "2026-08", posicoes: [pos("renda_fixa", "A", 100000)] }), "h1");
  salvarExtrato(db, U, extrato({ mes: "2026-09", posicoes: [pos("renda_fixa", "A", 160000)], movimentos: [mov("2026-09-05", "aporte", 30000), mov("2026-09-10", "custodia", 10000), mov("2026-09-12", "resgate", 5000), mov("2026-09-13", "compra", 99999), mov("2026-09-14", "provento", 777)] }), "h2");
  const v = variacaoDoMes(db, U, "2026-09");
  assert.equal(v.patrimonio_centavos, 160000);
  assert.equal(v.patrimonio_anterior_centavos, 100000);
  assert.equal(v.variacao_centavos, 60000);
  assert.equal(v.aportes_centavos, 30000);
  assert.equal(v.custodia_centavos, 10000);
  assert.equal(v.resgates_centavos, 5000);
  assert.equal(v.aportes_liquidos_centavos, 35000);
  assert.equal(v.rentabilidade_estimada_centavos, 25000);
  assert.equal(v.rentabilidade_estimada_pct, 0.25);
  assert.equal(v.estimativa, true);
  assert.match(v.nota, /^estimativa: variação menos aportes registrados nos extratos$/);
  assert.equal(v.motivo_indisponivel, null);
});

test("rentabilidade estimada so existe com snapshot do mes anterior para as mesmas contas", () => {
  const db = abrirBancoTeste();
  salvarExtrato(db, U, extrato({ mes: "2026-08", conta: "1111", posicoes: [pos("caixa", "A", 100000)] }), "h1");
  // sem posicao do mes anterior
  let v = variacaoDoMes(db, U, "2026-08");
  assert.equal(v.rentabilidade_estimada_centavos, null);
  assert.equal(v.variacao_centavos, null);
  assert.match(v.motivo_indisponivel!, /julho de 2026/);
  // conta nova em setembro: nao ha base comparavel para ela
  salvarExtrato(db, U, extrato({ mes: "2026-09", conta: "1111", posicoes: [pos("caixa", "A", 110000)] }), "h2");
  salvarExtrato(db, U, extrato({ mes: "2026-09", conta: "2222", instituicao: "Outro", posicoes: [pos("caixa", "B", 50000)] }), "h3");
  v = variacaoDoMes(db, U, "2026-09");
  assert.equal(v.variacao_centavos, 60000);
  assert.equal(v.rentabilidade_estimada_centavos, null);
  assert.match(v.motivo_indisponivel!, /Outro/);
  // mes so com dados defasados
  v = variacaoDoMes(db, U, "2026-10");
  assert.equal(v.rentabilidade_estimada_centavos, null);
  assert.match(v.motivo_indisponivel!, /anteriores/);
  // pulou um mes (julho -> setembro): nao ha snapshot de agosto
  const db2 = abrirBancoTeste();
  salvarExtrato(db2, U, extrato({ mes: "2026-07", posicoes: [pos("caixa", "A", 100000)] }), "h1");
  salvarExtrato(db2, U, extrato({ mes: "2026-09", posicoes: [pos("caixa", "A", 120000)] }), "h2");
  assert.equal(variacaoDoMes(db2, U, "2026-09").rentabilidade_estimada_centavos, null);
});

test("contribuicao em transito entra no mes do extrato e nao e contada de novo no mes seguinte", () => {
  const db = abrirBancoTeste();
  // agosto: sem nada em transito
  salvarExtrato(db, U, extrato({ mes: "2026-08", posicoes: [pos("previdencia", "Fundo", 100000)] }), "h1");
  // setembro: contribuicao de 500,00 ainda em transito (valor ja no patrimonio como "transito"), mais rendimento de 20,00
  salvarExtrato(db, U, extrato({ mes: "2026-09", posicoes: [pos("previdencia", "Fundo", 102000), pos("transito", "Valores em trânsito (previdência)", 50000)], movimentos: [mov("2026-09-30", "aporte", 50000, true)] }), "h2");
  let v = variacaoDoMes(db, U, "2026-09");
  assert.equal(v.variacao_centavos, 52000);
  assert.equal(v.aportes_centavos, 50000);
  assert.equal(v.rentabilidade_estimada_centavos, 2000);
  // outubro: a contribuicao liquida e aparece como movimento comum (500,00) + rendimento de 30,00; em transito: nada
  salvarExtrato(db, U, extrato({ mes: "2026-10", posicoes: [pos("previdencia", "Fundo", 155000)], movimentos: [mov("2026-09-30", "aporte", 50000)] }), "h3");
  const movs = movimentosDoMes(db, U, "2026-10");
  assert.equal(movs.length, 1);
  assert.equal(movs[0]!.ja_contado, true);
  v = variacaoDoMes(db, U, "2026-10");
  assert.equal(v.patrimonio_anterior_centavos, 152000);
  assert.equal(v.variacao_centavos, 3000);
  assert.equal(v.aportes_centavos, 0);
  assert.equal(v.ja_contados, 1);
  assert.equal(v.rentabilidade_estimada_centavos, 3000);
  // se o mesmo valor aparecer duas vezes no mes (uma e a liquidacao da anterior), so a primeira e descontada
  const db2 = abrirBancoTeste();
  salvarExtrato(db2, U, extrato({ mes: "2026-09", posicoes: [pos("previdencia", "Fundo", 100000)], movimentos: [mov("2026-09-30", "aporte", 50000, true)] }), "a");
  salvarExtrato(db2, U, extrato({ mes: "2026-10", posicoes: [pos("previdencia", "Fundo", 200000)], movimentos: [mov("2026-10-01", "aporte", 50000), mov("2026-10-15", "aporte", 50000)] }), "b");
  assert.deepEqual(movimentosDoMes(db2, U, "2026-10").map((m) => m.ja_contado), [true, false]);
  assert.equal(variacaoDoMes(db2, U, "2026-10").aportes_centavos, 50000);
});

test("aportes em dolar entram pela taxa do mes; sem taxa ficam de fora e impedem a estimativa", () => {
  const db = abrirBancoTeste();
  const base = { conta: "9999", moeda: "USD" as const, instituicao: "Corretora US" };
  salvarExtrato(db, U, extrato({ ...base, mes: "2026-08", posicoes: [pos("renda_fixa", "T", 100000)] }), "h1");
  salvarExtrato(db, U, extrato({ ...base, mes: "2026-09", posicoes: [pos("renda_fixa", "T", 160000)], movimentos: [mov("2026-09-05", "aporte", 50000)] }), "h2");
  let v = variacaoDoMes(db, U, "2026-09");
  assert.equal(v.rentabilidade_estimada_centavos, null);
  assert.equal(v.variacao_centavos, null);
  definirCambio(db, U, "2026-08", "USD", 5);
  definirCambio(db, U, "2026-09", "USD", 5);
  v = variacaoDoMes(db, U, "2026-09");
  assert.equal(v.patrimonio_anterior_centavos, 500000);
  assert.equal(v.patrimonio_centavos, 800000);
  assert.equal(v.aportes_centavos, 250000);
  assert.equal(v.rentabilidade_estimada_centavos, 50000);
  assert.equal(v.inclui_cambio, true);
});

test("evolucaoPatrimonio: doze meses em ordem, com defasagem e meses sem dados", () => {
  const db = abrirBancoTeste();
  salvarExtrato(db, U, extrato({ mes: "2026-07", posicoes: [pos("caixa", "A", 1000)] }), "h1");
  salvarExtrato(db, U, extrato({ mes: "2026-09", posicoes: [pos("caixa", "A", 3000)] }), "h2");
  const ev = evolucaoPatrimonio(db, U, "2026-10");
  assert.equal(ev.length, 12);
  assert.equal(ev[0]!.mes, "2025-11");
  assert.equal(ev[11]!.mes, "2026-10");
  assert.deepEqual(ev.slice(7).map((p) => [p.mes, p.total_centavos, p.sem_dados, p.defasadas]), [
    ["2026-06", 0, true, 0],
    ["2026-07", 1000, false, 0],
    ["2026-08", 1000, false, 1],
    ["2026-09", 3000, false, 0],
    ["2026-10", 3000, false, 1],
  ].slice(0, 5));
});

test("aportesLancamentos: lancamentos do tipo investimento do mes, sem cancelados", () => {
  const db = abrirBancoTeste();
  const agora = new Date("2026-10-14T15:00:00Z");
  lancarManual(db, U, { tipo: "investimento", valor_centavos: 50000, descricao: "Aporte mensal", categoria: "liberdade_financeira", data_local: "2026-09-05" }, "a", agora);
  lancarManual(db, U, { tipo: "investimento", valor_centavos: 20000, descricao: "Aporte extra", categoria: "liberdade_financeira", data_local: "2026-09-20" }, "b", agora);
  lancarManual(db, U, { tipo: "investimento", valor_centavos: 99900, descricao: "Outro mes", categoria: "liberdade_financeira", data_local: "2026-08-20" }, "c", agora);
  lancarManual(db, U, { tipo: "despesa", valor_centavos: 1000, descricao: "Cafe", categoria: "alimentacao_fora", data_local: "2026-09-06" }, "d", agora);
  const r = aportesLancamentos(db, U, "2026-09");
  assert.equal(r.itens.length, 2);
  assert.equal(r.total_centavos, 70000);
  assert.deepEqual(r.itens.map((i) => i.descricao), ["Aporte mensal", "Aporte extra"]);
});
