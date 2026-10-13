import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abrirBanco } from "../src/db/db.js";
import { processarMensagem } from "../src/ingest/conversa.js";
import { importarItens, hashLote } from "../src/importers/comum.js";
import { lerFaturaTexto } from "../src/importers/fatura-texto.js";
import { lerOfx } from "../src/importers/ofx.js";
import { lerCsv } from "../src/importers/csv.js";
import { calendarioMensal, mapaCalor, resumoMensal } from "../src/dashboard/consultas.js";

const U = "local";
const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const AGORA = new Date("2026-10-13T22:30:00Z"); // 19:30 em Sao Paulo

function bancoComCartao() {
  const db = abrirBanco();
  db.prepare("INSERT INTO cartao (usuario_id, apelido, apelido_norm, ultimos4, bandeira) VALUES ('local','Nomad','nomad','0000','VISA')").run();
  return db;
}

test("mensagem: registra, classifica e e idempotente", () => {
  const db = bancoComCartao();
  const m = { id: "wamid.1", usuario_id: U, texto: "assai 187,40 credito nomad", recebida_em: AGORA };
  const r1 = processarMensagem(db, m);
  assert.match(r1, /Registrado:/);
  assert.match(r1, /alimentacao_supermercado\/recorrente_variavel/);
  assert.equal(processarMensagem(db, m), ""); // reenvio do webhook
  assert.equal((db.prepare("SELECT COUNT(*) c FROM lancamento").get() as { c: number }).c, 1);
});

test("mensagem sem classificacao fica pendente; correcao confirma e aprende", () => {
  const db = bancoComCartao();
  assert.match(processarMensagem(db, { id: "a", usuario_id: U, texto: "trilhas da amazonia 16", recebida_em: AGORA }), /PENDENTE/);
  assert.match(processarMensagem(db, { id: "b", usuario_id: U, texto: "categoria lazer_passeios", recebida_em: AGORA }), /aprendida/);
  // proximo lancamento do mesmo estabelecimento ja sai classificado e confirmado
  const r = processarMensagem(db, { id: "c", usuario_id: U, texto: "trilhas da amazonia 20", recebida_em: AGORA });
  assert.match(r, /Registrado:.*lazer_passeios/);
  assert.doesNotMatch(r, /PENDENTE/);
  const log = db.prepare("SELECT campo FROM auditoria").all();
  assert.ok(log.length >= 1);
});

test("/desfazer cancela o ultimo e remove dos totais", () => {
  const db = bancoComCartao();
  processarMensagem(db, { id: "1", usuario_id: U, texto: "farmacia 50", recebida_em: AGORA });
  processarMensagem(db, { id: "2", usuario_id: U, texto: "/desfazer", recebida_em: AGORA });
  assert.equal(resumoMensal(db, U, "2026-10").despesas_centavos, 0);
});

test("fatura Nomad (trecho): le itens, parcela, pagamento como transferencia e e idempotente", () => {
  const db = bancoComCartao();
  const texto = fx("fatura-nomad-trecho.txt");
  const { itens, nao_lidas } = lerFaturaTexto(texto);
  assert.equal(nao_lidas.length, 0);
  assert.equal(itens.length, 15);
  assert.equal(itens[0]!.parcela_atual, 2);
  assert.equal(itens[0]!.parcela_total, 2);
  const ctx = { usuario_id: U, origem: "fatura_texto" as const, lote: hashLote(texto), cartao_id: 1, positivoEhDespesa: true };
  const rel = importarItens(db, itens, ctx);
  assert.equal(rel.criados, 15);
  // linhas identicas na mesma fatura (2 x ASSAI 264,39 / 50,05 sao distintas; teste de reimportacao)
  const rel2 = importarItens(db, itens, ctx);
  assert.equal(rel2.criados, 0);
  assert.equal(rel2.ja_processados, 15);
  const pg = db.prepare("SELECT tipo, categoria FROM lancamento WHERE descricao LIKE 'PAGAMENTO%'").get() as { tipo: string; categoria: string };
  assert.equal(pg.tipo, "transferencia");
  // pagamento de fatura nao entra em despesa
  const total = (db.prepare("SELECT SUM(valor_centavos) s FROM lancamento WHERE tipo='despesa'").get() as { s: number }).s;
  assert.equal(total, 43526 + 770 + 26439 + 5005 + 3390 + 1600 + 12000 + 3699 + 41659 + 5190 + 22468 + 2450 + 10000 + 16500);
  // itens sem regra ficam pendentes para revisao
  assert.ok(rel.pendentes >= 3);
});

test("OFX: salario, assinatura e pagamento de fatura; reimportar nao duplica", () => {
  const db = bancoComCartao();
  const itens = lerOfx(fx("extrato.ofx"));
  assert.equal(itens.length, 3);
  const ctx = { usuario_id: U, origem: "ofx" as const, lote: "x", conta_id: null };
  assert.equal(importarItens(db, itens, ctx).criados, 3);
  assert.equal(importarItens(db, itens, ctx).ja_processados, 3);
  const r = resumoMensal(db, U, "2026-10");
  assert.equal(r.receitas_centavos, 500000);
  assert.equal(r.despesas_centavos, 8990); // fatura paga = transferencia
});

test("CSV: linhas invalidas sao reportadas, nao descartadas em silencio", () => {
  const { itens, rejeitadas } = lerCsv(fx("extrato.csv"));
  assert.equal(itens.length, 2);
  assert.equal(itens[0]!.valor_centavos, -2350);
  assert.equal(rejeitadas.length, 2);
});

test("mesmo gasto por duas origens: mescla quando ha semelhanca; sinaliza quando nao ha", () => {
  const db = bancoComCartao();
  processarMensagem(db, { id: "m1", usuario_id: U, texto: "assai atacadista 416,59 credito nomad 05/09", recebida_em: AGORA });
  const { itens } = lerFaturaTexto("05/09/2026 ASSAI ATACADISTA LJ31 GOIANIA BR R$ 416,59\n06/09/2026 MERCADO XYZ R$ 416,59");
  const rel = importarItens(db, itens, { usuario_id: U, origem: "fatura_texto", lote: "f", cartao_id: 1, positivoEhDespesa: true });
  assert.equal(rel.mesclados, 1);
  assert.equal(rel.criados, 1);
  const dup = db.prepare("SELECT possivel_duplicado_de, status FROM lancamento WHERE descricao = 'MERCADO XYZ'").get() as { possivel_duplicado_de: number | null; status: string };
  assert.ok(dup.possivel_duplicado_de);
  assert.equal(dup.status, "pendente");
});

test("dashboard: mapa de calor exclui horario desconhecido e informa quantos", () => {
  const db = bancoComCartao();
  processarMensagem(db, { id: "h1", usuario_id: U, texto: "almoco 40 hoje 13:10", recebida_em: AGORA });
  processarMensagem(db, { id: "h2", usuario_id: U, texto: "farmacia 30 ontem", recebida_em: AGORA });
  const mc = mapaCalor(db, U, "2026-10-01", "2026-10-31");
  assert.equal(mc.celulas.length, 1);
  assert.equal(mc.celulas[0]!.hora, 13);
  assert.equal(mc.excluidos_sem_horario, 1);
  assert.equal(calendarioMensal(db, U, "2026-10").length, 2);
});
