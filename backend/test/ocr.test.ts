import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abrirBanco } from "../src/db/db";
import { criarServidor } from "../src/server";
import { detectarTipo, linhasDeTsv, ocrArquivo, ocrDisponivel } from "../src/ocr/tesseract";
import { lerFaturaOcr } from "../../core/src/importers/fatura-texto";

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

