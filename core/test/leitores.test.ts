import { test } from "node:test";
import assert from "node:assert/strict";
import { cnpjValido, lerComprovante } from "../src/importers/comprovante";
import { lerFaturaLinhas } from "../src/importers/fatura-texto";

test("fatura: aceita lixo antes da data, detecta data fora de ordem e confere o total", () => {
  const r = lerFaturaLinhas([
    { texto: "Despesas e créditos do mês R$ 340,00 Limite R$ 25.000,00" },
    { texto: "03/09/2026 MERCADO CENTRAL GOIANIA BR R$ 120,50", confianca: 95 },
    { texto: "(05/09/2026 AUTO POSTO ESTRELA GOIANIA BR R$150,00", confianca: 92 },
    { texto: "20/09/2026 PADARIA PAO QUENTE GOIANIA BR R$ 19,50", confianca: 90 },
    { texto: "07/09/2026 FARMACIA POPULAR GOIANIA BR R$ 40,00", confianca: 55 },
    { texto: "09/09/2026 LIVRARIA CULTURA GOIANIA BR R$ 10,00", confianca: 95 },
    { texto: "31/08/2026 PAGAMENTO DE FATURA - CNAB -R$ 100,00" },
  ]);
  assert.equal(r.itens.length, 6);
  assert.equal(r.conciliacao?.fecha, true);
  const alertas = r.itens.filter((i) => i.alerta).map((i) => i.descricao);
  assert.deepEqual(alertas, ["PADARIA PAO QUENTE GOIANIA BR", "FARMACIA POPULAR GOIANIA BR"]);
});

test("fatura: soma divergente e reportada", () => {
  const r = lerFaturaLinhas([{ texto: "Despesas e créditos do mês R$ 100,00" }, { texto: "03/09/2026 LOJA X R$ 90,00" }]);
  assert.equal(r.conciliacao?.fecha, false);
  assert.equal(r.conciliacao?.diferenca_centavos, -1000);
});

test("comprovante: cupom e PIX; recusa quando ambiguo", () => {
  const c = lerComprovante(["SUPERMERCADO BOA COMPRA LTDA", "CNPJ: 11.222.333/0001-81", "Data: 12/10/2026 18:42:10", "Subtotal R$ 37,40", "VALOR TOTAL R$ 37,40"]);
  assert.ok(c.ok);
  if (c.ok) {
    assert.equal(c.dados.valor_centavos, 3740);
    assert.equal(c.dados.estabelecimento, "SUPERMERCADO BOA COMPRA LTDA");
    assert.equal(c.dados.data_local, "2026-10-12");
    assert.equal(c.dados.hora_local, 18);
    assert.equal(c.dados.cnpj_valido, true);
  }
  const p = lerComprovante(["Comprovante de Pix", "Valor R$ 250,00", "Data 05/10/2026 09:15", "Para", "JOAO DA SILVA"]);
  assert.ok(p.ok && p.dados.estabelecimento === "JOAO DA SILVA" && p.dados.valor_centavos === 25000);
  assert.equal(lerComprovante(["Loja", "Total R$ 10,00", "Total R$ 20,00"]).ok, false);
  assert.equal(lerComprovante(["Loja sem valor"]).ok, false);
  assert.equal(cnpjValido("11.222.333/0001-82"), false);
});

// Linhas no formato de saida do OCR de um comprovante PIX de banco digital (dados ficticios).
// O ID embute a data/hora em UTC (2026-10-09 18:50 UTC = 15:50 em Brasilia).
const PIX = [
  "Comprovante de", "pagamento", "09 OUT 2026 - 15:50:42", "Valor R$ 700,00", "Tipo de transferência Pix",
  "ID da", "E123456782026100918500abcdefghij", "Destino", "Nome CLINICA EXEMPLO", "CNPJ 11222333000181",
  "Origem", "Nome Fulano de Tal", "CPF ***.123.456-**", "Banco Exemplo S.A. - Instituição de Pagamento", "CNPJ 18.236.120/0001-58",
  "ID da transação: E12345678202610", "091850Oabcdefghij",
];

test("comprovante PIX: destino (nao a origem nem o rodape), data por extenso, ID e forma de pagamento", () => {
  const c = lerComprovante(PIX);
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(c.dados.valor_centavos, 70000);
  assert.equal(c.dados.estabelecimento, "CLINICA EXEMPLO");
  assert.equal(c.dados.data_local, "2026-10-09");
  assert.equal(c.dados.hora_local, 15);
  assert.equal(c.dados.cnpj, "11.222.333/0001-81"); // CNPJ do destino, nao o do rodape
  assert.equal(c.dados.cnpj_valido, true);
  assert.equal(c.dados.forma_pagamento, "pix");
});

test("comprovante PIX: data exibida divergente do ID gera inconsistencia", () => {
  const c = lerComprovante(PIX.map((l) => l.replace("09 OUT 2026", "19 OUT 2026")));
  assert.ok(c.ok && c.dados.inconsistencias.some((i) => /difere da data embutida/.test(i)));
});

