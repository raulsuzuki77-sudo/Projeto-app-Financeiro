import { test } from "node:test";
import assert from "node:assert/strict";
import { intensidade, mesAtual, mudarMes, reaisParaCentavos, ultimoDia, urlServidorValida } from "./format.ts";

test("mes: navegacao e ultimo dia", () => {
  assert.equal(mudarMes("2026-01", -1), "2025-12");
  assert.equal(mudarMes("2026-12", 1), "2027-01");
  assert.equal(ultimoDia("2026-02"), "2026-02-28");
  assert.equal(mesAtual(new Date(2026, 9, 13)), "2026-10");
});

test("intensidade", () => {
  assert.equal(intensidade(50, 100), 0.5);
  assert.equal(intensidade(5, 0), 0);
});

test("url do servidor: https sempre; http so em rede local", () => {
  assert.equal(urlServidorValida("https://api.exemplo.com/").ok, true);
  assert.equal(urlServidorValida("http://192.168.0.10:3000").ok, true);
  assert.equal(urlServidorValida("http://meuservidor.local:3000").ok, true);
  assert.equal(urlServidorValida("http://exemplo.com").ok, false);
  assert.equal(urlServidorValida("ftp://x").ok, false);
  assert.equal(urlServidorValida("lixo").ok, false);
});

test("reais para centavos", () => {
  assert.equal(reaisParaCentavos("1.234,56"), 123456);
  assert.equal(reaisParaCentavos("R$ 20000"), 2000000);
  assert.equal(reaisParaCentavos("10,5"), 1050);
  assert.equal(reaisParaCentavos("abc"), null);
  assert.equal(reaisParaCentavos("1,234.56"), null);
});
