import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/db";
import { criarServidor } from "../src/server";
import { registrarLancamento } from "../../core/src/index";

const TOKEN = "t".repeat(32);
const H = { authorization: `Bearer ${TOKEN}` };

function semear(db: ReturnType<typeof abrirBanco>, mes: string, itens: { desc: string; v: number; tipo?: "despesa" | "receita"; data?: string }[]) {
  for (const [i, it] of itens.entries()) {
    registrarLancamento(db, { usuario_id: "local", tipo: it.tipo ?? "despesa", valor_centavos: it.v, descricao: it.desc, data_local: `${mes}-${it.data ?? "10"}`, precisao_horario: "desconhecido", origem: "csv", referencia: `${mes}-${i}-${it.desc}` });
  }
}

test("premissas: padrao sinalizado, edicao validada", async () => {
  const a = criarServidor(abrirBanco(), { apiToken: TOKEN, usuarioId: "local" });
  const p0 = (await a.inject({ method: "GET", url: "/api/premissas", headers: H })).json();
  assert.equal(p0.premissas_padrao, true);
  assert.equal((await a.inject({ method: "PUT", url: "/api/premissas", headers: H, payload: { chave: "moderado", retorno_nominal_aa: 10 } })).statusCode, 400); // 10 = 1000%: provavel erro de unidade
  assert.equal((await a.inject({ method: "PUT", url: "/api/premissas", headers: H, payload: { chave: "ouro", retorno_nominal_aa: 0.1 } })).statusCode, 400);
  const ok = await a.inject({ method: "PUT", url: "/api/premissas", headers: H, payload: { chave: "moderado", retorno_nominal_aa: 0.11 } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().premissas.find((x: { chave: string }) => x.chave === "moderado").atualizada_em !== null, true);
});

test("meta: validacao, cenarios com aporte e prazo, e aviso de simulacao", async () => {
  const a = criarServidor(abrirBanco(), { apiToken: TOKEN, usuarioId: "local" });
  assert.equal((await a.inject({ method: "POST", url: "/api/metas", headers: H, payload: { nome: "x", tipo: "curto_prazo", valor_alvo_centavos: -5, prazo_meses: 12 } })).statusCode, 400);
  const c = await a.inject({ method: "POST", url: "/api/metas", headers: H, payload: { nome: "Viagem", tipo: "curto_prazo", valor_alvo_centavos: 2_000_000, prazo_meses: 24 } });
  assert.equal(c.statusCode, 201);
  const id = c.json().id;
  const r = (await a.inject({ method: "GET", url: `/api/metas/${id}/cenarios?aporte_mensal_centavos=50000`, headers: H })).json();
  assert.equal(r.cenarios.length, 3);
  assert.match(r.aviso, /nao e recomendacao de investimento/);
  assert.equal(r.premissas_padrao, true);
  const [cons, , arr] = r.cenarios;
  assert.ok(cons.aporte_mensal_necessario_centavos > arr.aporte_mensal_necessario_centavos); // maior retorno exige menor aporte
  assert.ok(cons.aporte_mensal_necessario_centavos * 24 < cons.valor_alvo_nominal_centavos); // juros ajudam
  assert.ok(typeof cons.prazo_com_aporte_meses === "number" && cons.prazo_com_aporte_meses > 24 === (cons.aporte_mensal_necessario_centavos > 50000));
  assert.equal((await a.inject({ method: "DELETE", url: `/api/metas/${id}`, headers: H })).statusCode, 200);
  assert.equal((await a.inject({ method: "GET", url: `/api/metas/${id}/cenarios`, headers: H })).statusCode, 404);
});

test("reserva de emergencia usa so confirmados essenciais dos ultimos 3 meses fechados; capacidade de poupanca", async () => {
  const db = abrirBanco();
  const ref = new Date();
  const m = (k: number) => { const d = new Date(ref.getFullYear(), ref.getMonth() - k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  for (const k of [1, 2, 3]) {
    semear(db, m(k), [
      { desc: "aluguel", v: 200000 },            // fixo (regra base) -> confirmado
      { desc: "supermercado", v: 100000 },       // recorrente variavel -> confirmado
      { desc: "bar do ze", v: 50000 },           // eventual: fora da reserva
      { desc: "salario", v: 600000, tipo: "receita" },
    ]);
  }
  semear(db, m(1), [{ desc: "loja sem regra", v: 999999 }]); // pendente: nao conta
  const a = criarServidor(db, { apiToken: TOKEN, usuarioId: "local" });
  const r = (await a.inject({ method: "GET", url: "/api/reserva-emergencia?meses=6", headers: H })).json();
  assert.equal(r.media_mensal_centavos, 300000);
  assert.equal(r.valor_alvo_centavos, 1_800_000);
  const cp = (await a.inject({ method: "GET", url: "/api/capacidade-poupanca", headers: H })).json();
  // sobra confirmada: 600000 - (200000+100000+50000) = 250000 por mes; o pendente nao entra
  assert.equal(cp.sobra_media_mensal_centavos, 250000);
  assert.equal((await a.inject({ method: "GET", url: "/api/reserva-emergencia?meses=99", headers: H })).statusCode, 400);
});

test("meta: perfil de risco e edicao parcial revalidada", async () => {
  const a = criarServidor(abrirBanco(), { apiToken: TOKEN, usuarioId: "local" });
  assert.equal((await a.inject({ method: "POST", url: "/api/metas", headers: H, payload: { nome: "x", tipo: "curto_prazo", valor_alvo_centavos: 100000, prazo_meses: 12, perfil: "ousado" } })).statusCode, 400);
  const id = (await a.inject({ method: "POST", url: "/api/metas", headers: H, payload: { nome: "Casa", tipo: "longo_prazo", valor_alvo_centavos: 30_000_000, prazo_meses: 120 } })).json().id;
  const padrao = (await a.inject({ method: "GET", url: `/api/metas/${id}/cenarios`, headers: H })).json();
  assert.equal(padrao.meta.perfil, "moderado");
  assert.deepEqual(padrao.cenarios.filter((c: { perfil_da_meta: boolean }) => c.perfil_da_meta).map((c: { cenario: string }) => c.cenario), ["moderado"]);
  const p = await a.inject({ method: "PATCH", url: `/api/metas/${id}`, headers: H, payload: { perfil: "conservador", prazo_meses: 180 } });
  assert.equal(p.statusCode, 200);
  assert.equal(p.json().prazo_meses, 180);
  assert.equal(p.json().valor_alvo_centavos, 30_000_000); // campos nao enviados permanecem
  const novo = (await a.inject({ method: "GET", url: `/api/metas/${id}/cenarios`, headers: H })).json();
  assert.deepEqual(novo.cenarios.filter((c: { perfil_da_meta: boolean }) => c.perfil_da_meta).map((c: { cenario: string }) => c.cenario), ["conservador"]);
  assert.equal((await a.inject({ method: "PATCH", url: `/api/metas/${id}`, headers: H, payload: { prazo_meses: 0 } })).statusCode, 400);
  assert.equal((await a.inject({ method: "PATCH", url: "/api/metas/9999", headers: H, payload: { nome: "z" } })).statusCode, 404);
});
