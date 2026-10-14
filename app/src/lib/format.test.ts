import { test } from "node:test";
import assert from "node:assert/strict";
import { formatarBRL, nomeMes, dataBR, dataParaISO, percentualParaFracao, intensidade, mesAtual, mudarMes, reaisParaCentavos, ultimoDia, urlServidorValida } from "./format.ts";

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

test("percentual para fracao", () => {
  assert.equal(percentualParaFracao("10"), 0.1);
  assert.equal(percentualParaFracao("10,5%"), 0.105);
  assert.equal(percentualParaFracao("150"), null);
  assert.equal(percentualParaFracao("x"), null);
});

test("datas brasileiras", () => {
  assert.equal(dataBR("2026-10-05"), "05/10/2026");
  assert.equal(dataParaISO("5/10/2026", 2026), "2026-10-05");
  assert.equal(dataParaISO("05/10", 2026), "2026-10-05");
  assert.equal(dataParaISO("31/02/2026", 2026), null);
  assert.equal(dataParaISO("abc", 2026), null);
});

test("moeda e nome do mes sem Intl", () => {
  assert.equal(formatarBRL(123456), "R$ 1.234,56");
  assert.equal(formatarBRL(5), "R$ 0,05");
  assert.equal(formatarBRL(-100000), "-R$ 1.000,00");
  assert.equal(nomeMes("2026-03"), "março de 2026");
});
