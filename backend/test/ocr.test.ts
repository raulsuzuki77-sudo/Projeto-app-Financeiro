import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abrirBanco } from "../src/db/db.js";
import { criarServidor } from "../src/server.js";
import { detectarTipo, linhasDeTsv, ocrArquivo, ocrDisponivel } from "../src/ocr/tesseract.js";
import { lerFaturaLinhas, lerFaturaOcr } from "../src/importers/fatura-texto.js";
import { cnpjValido, lerComprovante } from "../src/importers/comprovante.js";

const bin = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const TOKEN = "t".repeat(32);
const H = { authorization: `Bearer ${TOKEN}` };
const temOcr = await ocrDisponivel();

test("detecta tipo pelos bytes, nao pelo nome", () => {
  assert.equal(detectarTipo(Buffer.from("%PDF-1.4 ...")), "pdf");
  assert.equal(detectarTipo(bin("fatura-sintetica.png")), "png");
  assert.equal(detectarTipo(Buffer.from("MZ executavel")), null);
});

test("TSV agrupa palavras em linhas com confianca media", () => {
  const tsv = ["nivel\tp\tb\tpar\tl\tw\tx\ty\tw\th\tconf\ttext",
    "5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t90\tola", "5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t70\tmundo", "5\t1\t1\t1\t2\t1\t0\t0\t1\t1\t-1\t"].join("\n");
  const l = linhasDeTsv(tsv, 1);
  assert.equal(l.length, 1);
  assert.equal(l[0]!.texto, "ola mundo");
  assert.equal(l[0]!.confianca, 80);
});

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

test("OCR real de fatura sintetica (PNG) ate o lancamento", { skip: !temOcr && "tesseract/por indisponivel" }, async () => {
  const linhas = await ocrArquivo(bin("fatura-sintetica.png"), "png");
  const r = lerFaturaOcr(linhas);
  assert.equal(r.itens.length, 6);
  assert.equal(r.conciliacao?.fecha, true);
  assert.ok(r.itens.find((i) => i.descricao.startsWith("PADARIA"))?.alerta?.includes("fora da ordem"));
});

test("API: foto de comprovante vira lancamento pendente; arquivo invalido e recusado", { skip: !temOcr && "tesseract/por indisponivel" }, async () => {
  const db = abrirBanco();
  const app = criarServidor(db, { apiToken: TOKEN, usuarioId: "local" });
  const ruim = await app.inject({ method: "POST", url: "/api/importacoes-arquivo?tipo=comprovante", headers: { ...H, "content-type": "image/png" }, payload: Buffer.from("nao sou imagem") });
  assert.equal(ruim.statusCode, 415);
  const r = await app.inject({ method: "POST", url: "/api/importacoes-arquivo?tipo=comprovante", headers: { ...H, "content-type": "image/png" }, payload: bin("comprovante-sintetico.png") });
  assert.equal(r.statusCode, 200, r.body);
  const l = db.prepare("SELECT * FROM lancamento").get() as { valor_centavos: number; status: string; data_local: string; hora_local: number };
  assert.equal(l.valor_centavos, 3740);
  assert.equal(l.status, "pendente"); // foto sempre exige confirmacao
  const mot = db.prepare("SELECT motivo_revisao m FROM lancamento").get() as { m: string };
  assert.match(mot.m, /foto: confirme/);
  assert.equal(l.data_local, "2026-10-12");
  const again = await app.inject({ method: "POST", url: "/api/importacoes-arquivo?tipo=comprovante", headers: { ...H, "content-type": "image/png" }, payload: bin("comprovante-sintetico.png") });
  assert.equal(again.json().resultado, "ja_processado");
});
