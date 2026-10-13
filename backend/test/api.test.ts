import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { abrirBanco } from "../src/db/db.js";
import { criarServidor } from "../src/server.js";

const TOKEN = "t".repeat(32);
const SECRET = "segredo-app";
const H = { authorization: `Bearer ${TOKEN}` };

function app(extra = {}) {
  return criarServidor(abrirBanco(), { apiToken: TOKEN, usuarioId: "local", whatsappVerifyToken: "verif", whatsappAppSecret: SECRET, whatsappNumeroAutorizado: "5562900000000", ...extra });
}

test("API exige token", async () => {
  const a = app();
  assert.equal((await a.inject({ method: "GET", url: "/api/lancamentos" })).statusCode, 401);
  assert.equal((await a.inject({ method: "GET", url: "/api/lancamentos", headers: { authorization: "Bearer errado" } })).statusCode, 401);
});

test("mensagem -> lancamento -> resumo", async () => {
  const a = app();
  const r = await a.inject({ method: "POST", url: "/api/mensagens", headers: H, payload: { texto: "assai 100 debito" } });
  assert.match(r.json().resposta, /Registrado/);
  const mes = new Date().toISOString().slice(0, 7);
  const s = await a.inject({ method: "GET", url: `/api/dashboard/resumo?mes=${mes}`, headers: H });
  assert.equal(s.json().despesas_centavos, 10000);
  assert.equal((await a.inject({ method: "GET", url: "/api/dashboard/resumo?mes=2026-13", headers: H })).statusCode, 400);
});

test("importacao via API e reimportacao idempotente", async () => {
  const a = app();
  const ofx = "<OFX><STMTTRN><DTPOSTED>20261005<TRNAMT>-10.00<FITID>9<MEMO>PADARIA</STMTTRN></OFX>";
  const req = () => a.inject({ method: "POST", url: "/api/importacoes/ofx", headers: { ...H, "content-type": "text/plain" }, payload: ofx });
  assert.equal((await req()).json().criados, 1);
  assert.equal((await req()).json().ja_processados, 1);
});

function corpoWhats(id: string, de: string, texto: string) {
  return JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from: de, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: texto } }] } }] }] });
}
const assinar = (c: string) => `sha256=${createHmac("sha256", SECRET).update(c).digest("hex")}`;

test("webhook: verificacao, assinatura, numero autorizado e idempotencia", async () => {
  const respostas: string[] = [];
  const a = app({ responder: async (_p: string, t: string) => { respostas.push(t); } });
  assert.equal((await a.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=123" })).body, "123");
  assert.equal((await a.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123" })).statusCode, 403);

  const c = corpoWhats("wamid.A", "5562900000000", "farmacia 30 pix");
  const hdr = { "content-type": "application/json" };
  assert.equal((await a.inject({ method: "POST", url: "/webhooks/whatsapp", headers: { ...hdr, "x-hub-signature-256": "sha256=00" }, payload: c })).statusCode, 401);
  assert.equal((await a.inject({ method: "POST", url: "/webhooks/whatsapp", headers: { ...hdr, "x-hub-signature-256": assinar(c) }, payload: c })).statusCode, 200);
  assert.equal(respostas.length, 1);
  await a.inject({ method: "POST", url: "/webhooks/whatsapp", headers: { ...hdr, "x-hub-signature-256": assinar(c) }, payload: c }); // reenvio da Meta
  assert.equal(respostas.length, 1);

  const estranho = corpoWhats("wamid.B", "5511999999999", "farmacia 99 pix");
  await a.inject({ method: "POST", url: "/webhooks/whatsapp", headers: { ...hdr, "x-hub-signature-256": assinar(estranho) }, payload: estranho });
  assert.equal(respostas.length, 1); // numero nao autorizado descartado
});
