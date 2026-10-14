import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBancoTeste } from "./helpers";
import {
  alterarLancamento, atualizarRecorrencia, chaveEstabelecimento, classificar, classificarEmLote, criarCartao, criarRecorrencia, editarLancamento,
  excluirLancamento, gerarRecorrencias, listarLancamentos, listarRecorrencias, obterLancamento, registrarLancamento, removerRecorrencia,
  restaurarLancamento, resumoMensal, rotuloCategoria, sugerirCategorias, ultimoDiaDoMes, type NovoLancamento,
} from "../src/index";

const U = "local";
let seq = 0;
function gasto(db: ReturnType<typeof abrirBancoTeste>, descricao: string, valor: number, data = "2026-10-05", extra: Partial<NovoLancamento> = {}) {
  const r = registrarLancamento(db, { usuario_id: U, tipo: "despesa", valor_centavos: valor, descricao, data_local: data, precisao_horario: "desconhecido", origem: "csv", referencia: `t${++seq}`, ...extra });
  assert.ok(r.resultado === "criado", r.resultado);
  return r.lancamento;
}

test("chave do estabelecimento ignora prefixo de intermediador, numeros de loja e UF", () => {
  assert.equal(chaveEstabelecimento("DROGASIL 1473 GOIANIA"), "drogasil goiania");
  assert.equal(chaveEstabelecimento("DROGASIL 2346 GOIANIA BR"), "drogasil goiania");
  assert.equal(chaveEstabelecimento("IFD*RESTAURANTE ESPACO GOIANIA"), "restaurante espaco");
  assert.equal(chaveEstabelecimento("ASSAI ATACADISTA LJ31 GOIANIA BR"), "assai atacadista");
});

test("regras base ampliadas reconhecem redes comuns sem revisao", () => {
  const db = abrirBancoTeste();
  const casos: [string, string][] = [
    ["UBER *TRIP", "transporte_aplicativo_pedagio"], ["SMARTFIT ACADEMIA", "saude_academia"], ["NETFLIX COM", "lazer_assinaturas"],
    ["CARREFOUR HIPER", "alimentacao_supermercado"], ["PETZ LOJA 12", "pets"], ["POSTO IPIRANGA", "transporte_combustivel"],
    ["MAGAZINE LUIZA", "compras_diversas"], ["LATAM AIR", "viagem"], ["MCDONALDS", "alimentacao_restaurante"],
  ];
  for (const [d, cat] of casos) assert.equal(classificar(db, U, d, "despesa").categoria, cat, d);
});

test("aprendizado automatico: confirmar um lancamento classifica os proximos do mesmo estabelecimento, sem corrigir nada", () => {
  const db = abrirBancoTeste();
  const a = gasto(db, "PADARIA SABOR DA VILA 12 GOIANIA", 1500); // 'padaria' -> restaurante (regra base), confirmado
  assert.equal(a.categoria, "alimentacao_restaurante");
  const b = gasto(db, "XYZZY CORP 55 GOIANIA", 3000);
  assert.equal(b.status, "pendente");
  alterarLancamento(db, b.id, U, { categoria: "compras_diversas", status: "confirmado" });
  // outro lancamento do mesmo estabelecimento, outro numero de loja: resolvido pelo aprendizado
  const c = gasto(db, "XYZZY CORP 77 GOIANIA", 4000, "2026-10-06");
  assert.equal(c.categoria, "compras_diversas");
  assert.equal(c.status, "confirmado");
});

test("estabelecimento parecido ja confirmado e reconhecido (palavras em comum)", () => {
  const db = abrirBancoTeste();
  const a = gasto(db, "ZZQ MATERIAIS GOIANIA", 100);
  alterarLancamento(db, a.id, U, { categoria: "moradia_manutencao", status: "confirmado" });
  const b = gasto(db, "ZZQ MATERIAIS ANAPOLIS", 200, "2026-10-07");
  assert.equal(b.categoria, "moradia_manutencao");
});

test("sugestoes: ate 3, sem repeticao, palpite primeiro, depois historico e mais usadas", () => {
  const db = abrirBancoTeste();
  for (const [d, cat] of [["FEIRA CENTRAL", "alimentacao_supermercado"], ["CLINICA BEM", "saude"], ["OFICINA ZE", "transporte_manutencao"]] as const) {
    const l = gasto(db, d, 1000);
    alterarLancamento(db, l.id, U, { categoria: cat, status: "confirmado" });
  }
  const s = sugerirCategorias(db, U, "FEIRA CENTRAL 2", "despesa");
  assert.equal(s[0]!.categoria, "alimentacao_supermercado");
  assert.ok(s.length >= 2 && s.length <= 3);
  assert.equal(new Set(s.map((x) => x.categoria)).size, s.length);
  assert.ok(!s.some((x) => x.categoria === "nao_classificado"));
});

test("classificar em lote: um toque resolve todos os pendentes do mesmo estabelecimento (e so eles)", () => {
  const db = abrirBancoTeste();
  const a = gasto(db, "QWERTY LTDA 1 GOIANIA", 100, "2026-10-01");
  const b = gasto(db, "QWERTY LTDA 2 GOIANIA", 200, "2026-10-02");
  const c = gasto(db, "OUTRA COISA SA", 300, "2026-10-03");
  const alterados = classificarEmLote(db, a.id, U, "pets");
  assert.deepEqual(alterados.sort(), [a.id, b.id].sort());
  assert.equal(obterLancamento(db, b.id)!.categoria, "pets");
  assert.equal(obterLancamento(db, b.id)!.status, "confirmado");
  assert.equal(obterLancamento(db, c.id)!.status, "pendente");
  assert.deepEqual(classificarEmLote(db, c.id, U, "viagem", false), [c.id]);
});

test("trocar so a categoria ajusta a natureza (assinatura) e mantem parcelado", () => {
  const db = abrirBancoTeste();
  const a = gasto(db, "QWERTY LTDA", 100);
  const r = alterarLancamento(db, a.id, U, { categoria: "lazer_assinaturas" });
  assert.equal(r.natureza, "assinatura");
  const p = gasto(db, "NOTEBOOK LOJA", 100000, "2026-10-08", { parcela_total: 3 });
  assert.equal(p.natureza, "parcelado");
  assert.equal(alterarLancamento(db, p.id, U, { categoria: "compras_diversas" }).natureza, "parcelado");
});

test("editar lancamento: valida, audita, recalcula chave e hora; excluir e restaurar", () => {
  const db = abrirBancoTeste();
  criarCartao(db, U, { apelido: "nomad" });
  const a = gasto(db, "LOJA ABC", 5000, "2026-10-05");
  const e = editarLancamento(db, a.id, U, { descricao: "Loja ABC Centro", valor_centavos: 5500, data_local: "2026-10-06", hora_local: 14, categoria: "vestuario", cartao_id: 1, forma_pagamento: "credito" });
  assert.equal(e.valor_centavos, 5500);
  assert.equal(e.data_local, "2026-10-06");
  assert.equal(e.hora_local, 14);
  assert.equal(e.precisao_horario, "exato");
  assert.equal(e.categoria, "vestuario");
  assert.equal(e.status, "confirmado");
  assert.equal(e.estabelecimento_norm, "loja abc centro");
  assert.notEqual(e.hash_dedup, a.hash_dedup);
  assert.ok((db.prepare("SELECT COUNT(*) c FROM auditoria WHERE lancamento_id = ?").get(a.id) as { c: number }).c >= 5);
  assert.equal(editarLancamento(db, a.id, U, { hora_local: null }).precisao_horario, "desconhecido");
  for (const ruim of [{ valor_centavos: 0 }, { data_local: "2026-02-31" }, { hora_local: 25 }, { descricao: "  " }, { cartao_id: 999 }, { tipo: "xx" as never }]) {
    assert.throws(() => editarLancamento(db, a.id, U, ruim), Error);
  }
  assert.equal(resumoMensal(db, U, "2026-10").despesas_centavos, 5500);
  excluirLancamento(db, a.id, U);
  assert.equal(resumoMensal(db, U, "2026-10").despesas_centavos, 0);
  assert.equal(listarLancamentos(db, U, { mes: "2026-10" }).length, 0); // excluido nao aparece
  restaurarLancamento(db, a.id, U);
  assert.equal(listarLancamentos(db, U, { mes: "2026-10", busca: "ABC centro" }).length, 1);
  assert.equal(listarLancamentos(db, U, { mes: "2026-10", busca: "nada" }).length, 0);
});

test("recorrencias: gera ate hoje, e idempotente, respeita mes curto, nao recria excluido, pausa e remocao", () => {
  const db = abrirBancoTeste();
  const id = criarRecorrencia(db, U, { descricao: "Aluguel", valor_centavos: 200000, dia_mes: 31, categoria: "moradia", inicio_mes: "2026-01" }, "2026-10-13");
  const id2 = criarRecorrencia(db, U, { descricao: "Netflix", valor_centavos: 5590, dia_mes: 20, inicio_mes: "2026-10" }, "2026-10-13");
  assert.equal(listarRecorrencias(db, U).find((r) => r.id === id2)!.categoria, "lazer_assinaturas"); // classificada automaticamente
  assert.equal(ultimoDiaDoMes("2026-02"), 28);
  // hoje = 13/10: aluguel de jan a set (9 meses); outubro (dia 31) ainda nao chegou; netflix dia 20 ainda nao chegou
  assert.equal(gerarRecorrencias(db, U, "2026-10-13"), 9);
  assert.equal(gerarRecorrencias(db, U, "2026-10-13"), 0); // idempotente
  const fev = db.prepare("SELECT data_local d FROM lancamento WHERE data_local LIKE '2026-02-%'").get() as { d: string };
  assert.equal(fev.d, "2026-02-28");
  const jan = db.prepare("SELECT * FROM lancamento WHERE data_local = '2026-01-31'").get() as { status: string; categoria: string; valor_centavos: number };
  assert.deepEqual([jan.status, jan.categoria, jan.valor_centavos], ["confirmado", "moradia", 200000]);
  // passa o dia 20 de outubro: netflix gerada; passa o dia 31: aluguel de outubro
  assert.equal(gerarRecorrencias(db, U, "2026-10-21"), 1);
  assert.equal(gerarRecorrencias(db, U, "2026-10-31"), 1);
  // excluir um gerado nao o recria
  const set = db.prepare("SELECT id FROM lancamento WHERE data_local = '2026-09-30'").get() as { id: number };
  excluirLancamento(db, set.id, U);
  assert.equal(gerarRecorrencias(db, U, "2026-11-01"), 0);
  // pausar: nao gera novembro
  atualizarRecorrencia(db, U, id, { ativa: false });
  assert.equal(gerarRecorrencias(db, U, "2026-11-30"), 1); // so a netflix (dia 20)
  assert.ok(removerRecorrencia(db, U, id2));
  assert.equal(gerarRecorrencias(db, U, "2026-12-31"), 0);
  assert.throws(() => criarRecorrencia(db, U, { descricao: "x", valor_centavos: 0, dia_mes: 5 }, "2026-10-13"));
  assert.throws(() => criarRecorrencia(db, U, { descricao: "x", valor_centavos: 100, dia_mes: 32 }, "2026-10-13"));
});

test("rotulos de categoria em portugues e categoria personalizada", () => {
  assert.equal(rotuloCategoria("transporte_combustivel"), "Combustível");
  assert.equal(rotuloCategoria("minha_categoria"), "Minha categoria");
});

test("lancamento manual: validacao, categoria definida confirma, duplo toque nao duplica, futuro recusado", async () => {
  const { lancarManual } = await import("../src/index");
  const db = abrirBancoTeste();
  const AGORA = new Date("2026-10-13T22:30:00Z"); // 19:30 em Sao Paulo
  const r = lancarManual(db, U, { tipo: "despesa", valor_centavos: 4290, descricao: "Almoço equipe", forma_pagamento: "pix", categoria: "alimentacao_restaurante" }, "f1", AGORA);
  assert.ok(r.resultado === "criado");
  assert.equal(r.lancamento.status, "confirmado");
  assert.equal(r.lancamento.data_local, "2026-10-13");
  assert.equal(r.lancamento.precisao_horario, "aproximado");
  assert.equal(lancarManual(db, U, { tipo: "despesa", valor_centavos: 4290, descricao: "Almoço equipe" }, "f1", AGORA).resultado, "ja_processado");
  const s = lancarManual(db, U, { tipo: "despesa", valor_centavos: 500, descricao: "Xyzzy desconhecido" }, "f2", AGORA);
  assert.ok(s.resultado === "criado" && s.lancamento.status === "pendente");
  const ont = lancarManual(db, U, { tipo: "receita", valor_centavos: 100000, descricao: "Salário", data_local: "2026-10-12" }, "f3", AGORA);
  assert.ok(ont.resultado === "criado" && ont.lancamento.hora_local === null && ont.lancamento.precisao_horario === "desconhecido" && ont.lancamento.categoria === "receita_trabalho");
  assert.throws(() => lancarManual(db, U, { tipo: "despesa", valor_centavos: 0, descricao: "x" }, "f4", AGORA), /valor/);
  assert.throws(() => lancarManual(db, U, { tipo: "despesa", valor_centavos: 1, descricao: " " }, "f5", AGORA), /detalhamento/);
  assert.throws(() => lancarManual(db, U, { tipo: "despesa", valor_centavos: 1, descricao: "x", data_local: "2026-10-14" }, "f6", AGORA), /futuro/);
  assert.throws(() => lancarManual(db, U, { tipo: "despesa", valor_centavos: 1, descricao: "x", data_local: "2026-02-30" }, "f7", AGORA), /Data inválida/);
});
