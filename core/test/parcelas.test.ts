import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBancoTeste } from "./helpers";
import { alterarLancamento, classificarEmLote, criarCartao, importarTexto, lancarManual, listarLancamentos, parcelasFuturas, processarMensagem, resumoMensal, somarMeses } from "../src/index";

const U = "u";
const mes = (db: ReturnType<typeof abrirBancoTeste>, m: string) => resumoMensal(db, U, m).despesas_centavos;

test("somarMeses ajusta o dia ao fim do mes", () => {
  assert.equal(somarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(somarMeses("2026-11-15", 3), "2027-02-15");
  assert.equal(somarMeses("2026-03-31", -1), "2026-02-28");
});

test("compra parcelada digitada: cada mes entra com a sua parcela, e a soma fecha com o total", () => {
  const db = abrirBancoTeste();
  lancarManual(db, U, { tipo: "despesa", valor_centavos: 100000, descricao: "Geladeira Loja Z", categoria: "compras_diversas", data_local: "2026-10-10", parcelas: 3 }, "m1");
  const l = listarLancamentos(db, U, { ordem: "data_asc" }) as { valor_centavos: number; data_local: string; parcela_atual: number; prevista: number }[];
  assert.deepEqual(l.map((x) => [x.data_local, x.valor_centavos, x.parcela_atual]), [["2026-10-10", 33334, 1], ["2026-11-10", 33333, 2], ["2026-12-10", 33333, 3]]);
  assert.equal(l.reduce((s, x) => s + x.valor_centavos, 0), 100000);
  assert.deepEqual(l.map((x) => Boolean(x.prevista)), [false, true, true]);
  assert.equal(mes(db, "2026-10"), 33334);
  assert.equal(mes(db, "2026-11"), 33333);
  // valor informado por parcela
  lancarManual(db, U, { tipo: "despesa", valor_centavos: 5000, descricao: "Fone", categoria: "compras_diversas", data_local: "2026-10-12", parcelas: 2, valor_informado: "parcela" }, "m2");
  assert.equal(mes(db, "2026-11"), 33333 + 5000);
  // idempotente: repetir o mesmo envio nao duplica nenhuma parcela
  lancarManual(db, U, { tipo: "despesa", valor_centavos: 100000, descricao: "Geladeira Loja Z", categoria: "compras_diversas", data_local: "2026-10-10", parcelas: 3 }, "m1");
  assert.equal((listarLancamentos(db, U, {}) as unknown[]).length, 5);
  assert.throws(() => lancarManual(db, U, { tipo: "receita", valor_centavos: 1000, descricao: "x", parcelas: 2 }, "m3"), /Só saídas/);
});

test("parcela de fatura projeta as seguintes e a fatura do mes seguinte substitui a projecao (contada uma vez)", () => {
  const db = abrirBancoTeste();
  const cid = criarCartao(db, U, { apelido: "nubank" });
  const csv1 = 'date,title,amount\n2026-09-20,Loja Exemplo*Compras - Parcela 1/3,"52,64"\n';
  const r1 = importarTexto(db, "csv", csv1, { usuario_id: U, cartao_id: cid });
  assert.ok(r1.ok);
  assert.equal(mes(db, "2026-09"), 5264);
  assert.equal(mes(db, "2026-10"), 5264, "parcela prevista");
  assert.equal(mes(db, "2026-11"), 5264, "parcela prevista");
  // a fatura de outubro chega com a parcela 2 (data diferente da projecao)
  const csv2 = 'date,title,amount\n2026-10-03,Loja Exemplo*Compras - Parcela 2/3,"52,64"\n';
  const r2 = importarTexto(db, "csv", csv2, { usuario_id: U, cartao_id: cid });
  assert.ok(r2.ok);
  const todos = listarLancamentos(db, U, { ordem: "data_asc" }) as { data_local: string; parcela_atual: number; prevista: number }[];
  assert.equal(todos.length, 3, "a parcela 2 nao duplicou");
  assert.deepEqual(todos.map((t) => [t.data_local, t.parcela_atual, Boolean(t.prevista)]), [["2026-09-20", 1, false], ["2026-10-03", 2, false], ["2026-11-20", 3, true]]);
  // reimportar a fatura e idempotente
  importarTexto(db, "csv", csv2, { usuario_id: U, cartao_id: cid });
  assert.equal((listarLancamentos(db, U, {}) as unknown[]).length, 3);
});

test("fatura com varias parcelas antecipadas no mesmo dia: cada parcela uma vez, sem projecoes sobrando", () => {
  const db = abrirBancoTeste();
  const cid = criarCartao(db, U, { apelido: "nubank" });
  const linhas = [6, 3, 2, 5, 4, 1].map((k) => `2026-08-25,Loja Exemplo*Compras - Parcela ${k}/6,"52,64"`).join("\n");
  const r = importarTexto(db, "csv", `date,title,amount\n${linhas}\n`, { usuario_id: U, cartao_id: cid });
  assert.ok(r.ok);
  const todos = listarLancamentos(db, U, {}) as { prevista: number }[];
  assert.equal(todos.length, 6);
  assert.equal(todos.filter((t) => t.prevista).length, 0);
  assert.equal(mes(db, "2026-08"), 6 * 5264);
});

test("classificar a primeira parcela classifica as projecoes; projecao pendente nao polui a revisao", () => {
  const db = abrirBancoTeste();
  const cid = criarCartao(db, U, { apelido: "nubank" });
  importarTexto(db, "csv", 'date,title,amount\n2026-09-20,Obscura Zzz Ltda - Parcela 1/3,"80,00"\n', { usuario_id: U, cartao_id: cid });
  const pend = (listarLancamentos(db, U, { status: "pendente", ate: "2026-09-30" }) as { id: number }[]);
  assert.equal(pend.length, 1, "so a parcela real entra na revisao");
  assert.equal((listarLancamentos(db, U, { status: "pendente" }) as unknown[]).length, 3);
  classificarEmLote(db, pend[0]!.id, U, "compras_diversas");
  const todos = listarLancamentos(db, U, {}) as { categoria: string; status: string }[];
  assert.ok(todos.every((t) => t.categoria === "compras_diversas" && t.status === "confirmado"));
  void alterarLancamento;
});

test("fluxo de caixa das parcelas futuras, mes a mes", () => {
  const db = abrirBancoTeste();
  lancarManual(db, U, { tipo: "despesa", valor_centavos: 60000, descricao: "Sofa", categoria: "compras_diversas", data_local: "2026-10-10", parcelas: 3 }, "s1");
  lancarManual(db, U, { tipo: "despesa", valor_centavos: 20000, descricao: "Fone", categoria: "compras_diversas", data_local: "2026-10-12", parcelas: 2 }, "s2");
  const f = parcelasFuturas(db, U, "2026-11");
  assert.deepEqual(f.map((m) => [m.mes, m.total_centavos, m.quantidade]), [["2026-11", 30000, 2], ["2026-12", 20000, 1]]);
});

test("mensagem de texto com parcelas (\"3000 em 10x\"): 10 meses, cada um com a sua parcela", () => {
  const db = abrirBancoTeste();
  criarCartao(db, U, { apelido: "nomad" });
  processarMensagem(db, { id: "t1", usuario_id: U, texto: "notebook 3000 em 10x nomad 10/10", recebida_em: new Date("2026-10-14T15:00:00Z") });
  const l = listarLancamentos(db, U, { ordem: "data_asc" }) as { valor_centavos: number; data_local: string }[];
  assert.equal(l.length, 10);
  assert.equal(l.reduce((s, x) => s + x.valor_centavos, 0), 300000);
  assert.equal(l[0]!.data_local, "2026-10-10");
  assert.equal(l[9]!.data_local, "2027-07-10");
  assert.equal(resumoMensal(db, U, "2026-10").despesas_centavos, 30000);
  assert.equal(resumoMensal(db, U, "2026-11").despesas_centavos, 30000);
});
