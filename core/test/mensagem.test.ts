import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretarMensagem } from "../src/parsing/mensagem";

// 2026-10-13 22:30 em Sao Paulo (UTC-3)
const AGORA = new Date("2026-10-14T01:30:00Z");

function ok(texto: string, cartoes: string[] = ["nubank", "nomad"]) {
  const r = interpretarMensagem(texto, AGORA, cartoes);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as Extract<typeof r, { ok: true }>).lancamento;
}

test("mensagem simples com cartao", () => {
  const l = ok("mercado 187,40 credito nubank");
  assert.equal(l.valor_centavos, 18740);
  assert.equal(l.descricao, "mercado");
  assert.equal(l.forma_pagamento, "credito");
  assert.equal(l.cartao_apelido_norm, "nubank");
  assert.equal(l.data_local, "2026-10-13");
  assert.equal(l.hora_local, 22);
  assert.equal(l.precisao_horario, "aproximado");
});

test("valor com milhar e R$", () => {
  assert.equal(ok("notebook R$ 1.234,56 em 3x nomad").valor_centavos, 123456);
  assert.equal(ok("notebook R$ 1.234,56 em 3x nomad").parcela_total, 3);
});

test("ontem com hora informada", () => {
  const l = ok("almoco 42,90 debito ontem 13:15");
  assert.equal(l.data_local, "2026-10-12");
  assert.equal(l.hora_local, 13);
  assert.equal(l.precisao_horario, "exato");
});

test("ontem sem hora: horario desconhecido", () => {
  const l = ok("farmacia 35,00 pix ontem");
  assert.equal(l.hora_local, null);
  assert.equal(l.precisao_horario, "desconhecido");
});

test("data dd/mm sem ano nao fica no futuro", () => {
  assert.equal(ok("posto 120 12/10").data_local, "2026-10-12");
  assert.equal(ok("posto 120 20/12").data_local, "2025-12-20");
});

test("hora '14h30' e valor inteiro", () => {
  const l = ok("cafe 12 as 14h30");
  assert.equal(l.valor_centavos, 1200);
  assert.equal(l.hora_local, 14);
});

test("recusa sem valor, valor ambiguo e data invalida", () => {
  assert.equal(interpretarMensagem("mercado credito", AGORA).ok, false);
  assert.equal(interpretarMensagem("mercado 10 e 20", AGORA).ok, false);
  assert.equal(interpretarMensagem("mercado 10 31/02", AGORA).ok, false);
});

test("tipos: receita, investimento", () => {
  assert.equal(ok("recebi 3000 salario").tipo, "receita");
  assert.equal(ok("aporte 500 tesouro").tipo, "investimento");
});
