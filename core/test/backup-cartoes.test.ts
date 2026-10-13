import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { abrirBancoTeste } from "./helpers";
import { criarCartao, listarCartoes, removerCartao, processarMensagem, importarTexto, exportarDados, restaurarDados, cifrar, decifrar, deBase64, paraBase64, deUtf8, utf8, resumoMensal, criarMeta, salvarPremissa } from "../src/index";

const U = "local";
const AGORA = new Date("2026-10-13T22:30:00Z");
const alea = (n: number) => new Uint8Array(randomBytes(n));
const ITER = 100_000; // minimo aceito; testes rapidos

test("cartao: validacao, unicidade, uso em mensagem, remocao protegida", () => {
  const db = abrirBancoTeste();
  assert.throws(() => criarCartao(db, U, { apelido: "x" }), /2 a 30/);
  assert.throws(() => criarCartao(db, U, { apelido: "meu cartao" }), /uma palavra/);
  assert.throws(() => criarCartao(db, U, { apelido: "nomad", ultimos4: "12345" }), /4 ultimos/);
  const id = criarCartao(db, U, { apelido: "Nomad", ultimos4: "1234", bandeira: "VISA" });
  assert.throws(() => criarCartao(db, U, { apelido: "NOMAD" }), /ja existe/);
  assert.equal(listarCartoes(db, U)[0]!.apelido_norm, "nomad");
  assert.match(processarMensagem(db, { id: "m1", usuario_id: U, texto: "assai 100 nomad", recebida_em: AGORA }), /Registrado/);
  assert.equal((db.prepare("SELECT cartao_id c FROM lancamento").get() as { c: number }).c, id);
  assert.throws(() => removerCartao(db, U, id), /lancamentos/);
});

test("importarTexto: OFX, CSV e fatura; erros viram resultado, nao excecao", () => {
  const db = abrirBancoTeste();
  const ofx = "<OFX><STMTTRN><DTPOSTED>20261005<TRNAMT>-10.00<FITID>1<MEMO>PADARIA</STMTTRN></OFX>";
  const r = importarTexto(db, "ofx", ofx, { usuario_id: U });
  assert.ok(r.ok && r.relatorio.criados === 1);
  assert.deepEqual(importarTexto(db, "ofx", "lixo", { usuario_id: U }), { ok: false, erro: "nenhuma transacao encontrada no OFX" });
  const csv = importarTexto(db, "csv", "Data;Descricao;Valor\n05/10/2026;LOJA;-5,00\n32/13/2026;RUIM;-1,00", { usuario_id: U });
  assert.ok(csv.ok && csv.rejeitadas?.length === 1);
  const f = importarTexto(db, "fatura-texto", "Despesas e créditos do mês R$ 30,00\n03/09/2026 LOJA A R$ 30,00", { usuario_id: U });
  assert.ok(f.ok && f.conciliacao?.fecha === true);
});

test("base64 e utf8: ida e volta, incluindo tamanhos nao multiplos de 3 e acentos", () => {
  for (const n of [0, 1, 2, 3, 4, 5, 100]) { const b = alea(n); assert.deepEqual(deBase64(paraBase64(b)), new Uint8Array(b)); }
  assert.equal(paraBase64(utf8("Man")), Buffer.from("Man").toString("base64"));
  assert.equal(paraBase64(utf8("ação €")), Buffer.from("ação €").toString("base64"));
  assert.equal(deUtf8(utf8("ação € \u{1F600}")), "ação € \u{1F600}");
  assert.throws(() => deBase64("!!!"));
});

test("cifra: ida e volta; senha errada, adulteracao e parametros fora do aceitavel falham", async () => {
  const seg = await cifrar("conteudo secreto: R$ 1.234,56", "senha-bem-longa", alea, ITER);
  assert.equal(await decifrar(seg, "senha-bem-longa"), "conteudo secreto: R$ 1.234,56");
  await assert.rejects(decifrar(seg, "outra-senha-longa"), /senha incorreta ou arquivo corrompido/);
  const o = JSON.parse(seg);
  const dados = deBase64(o.dados); dados[0] = dados[0]! ^ 1;
  await assert.rejects(decifrar(JSON.stringify({ ...o, dados: paraBase64(dados) }), "senha-bem-longa"), /corrompido/);
  await assert.rejects(decifrar(JSON.stringify({ ...o, iteracoes: 100_001 }), "senha-bem-longa"), /corrompido/); // cabecalho autenticado
  await assert.rejects(decifrar(JSON.stringify({ ...o, iteracoes: 5 }), "senha-bem-longa"), /fora do aceitavel/);
  await assert.rejects(decifrar("nao e json", "x"), /invalido/);
  await assert.rejects(cifrar("x", "curta", alea, ITER), /ao menos/);
  assert.notEqual(await cifrar("igual", "senha-bem-longa", alea, ITER), await cifrar("igual", "senha-bem-longa", alea, ITER)); // sal e nonce novos
  assert.ok(!seg.includes("secreto")); // nada em claro
});

test("backup: exporta, cifra, restaura em banco novo e os totais conferem; restauracao e tudo-ou-nada", async () => {
  const a = abrirBancoTeste();
  criarCartao(a, U, { apelido: "nomad" });
  processarMensagem(a, { id: "1", usuario_id: U, texto: "assai 100,50 nomad", recebida_em: AGORA });
  processarMensagem(a, { id: "2", usuario_id: U, texto: "trilhas 20", recebida_em: AGORA });
  processarMensagem(a, { id: "3", usuario_id: U, texto: "categoria lazer_passeios", recebida_em: AGORA }); // regra + auditoria
  criarMeta(a, U, { nome: "Viagem", tipo: "curto_prazo", valor_alvo_centavos: 100000, aporte_inicial_centavos: 0, prazo_meses: 12, perfil: "arrojado" });
  salvarPremissa(a, U, { chave: "moderado", retorno_nominal_aa: 0.11 });
  const arquivo = await cifrar(JSON.stringify(exportarDados(a, AGORA)), "senha-bem-longa", alea, ITER);

  const b = abrirBancoTeste();
  criarCartao(b, U, { apelido: "lixo" }); // sera substituido
  const r = restaurarDados(b, JSON.parse(await decifrar(arquivo, "senha-bem-longa")));
  assert.ok(r.linhas > 8);
  assert.deepEqual(listarCartoes(b, U).map((c) => c.apelido), ["nomad"]);
  assert.deepEqual(resumoMensal(b, U, "2026-10"), resumoMensal(a, U, "2026-10"));
  assert.equal((b.prepare("SELECT perfil p FROM meta").get() as { p: string }).p, "arrojado");
  // regra aprendida sobrevive: proximo gasto no mesmo estabelecimento sai classificado
  assert.match(processarMensagem(b, { id: "9", usuario_id: U, texto: "trilhas 25", recebida_em: AGORA }), /lazer_passeios/);

  // dump malicioso/invalido: nada e alterado
  const antes = JSON.stringify(exportarDados(b, AGORA));
  assert.throws(() => restaurarDados(b, { versao_schema: 1, exportado_em: "", tabelas: { sqlite_master: [] } }), /tabela desconhecida/);
  assert.throws(() => restaurarDados(b, { versao_schema: 1, exportado_em: "", tabelas: { cartao: [{ "apelido) VALUES (1); DROP TABLE lancamento; --": "x" }] } }), /coluna desconhecida/);
  assert.throws(() => restaurarDados(b, { versao_schema: 99, exportado_em: "", tabelas: {} }), /mais nova/);
  assert.throws(() => restaurarDados(b, { versao_schema: 1, exportado_em: "", tabelas: { cartao: [{ id: 1, usuario_id: "x", apelido: "a", apelido_norm: "a", ultimos4: { x: 1 } as never }] } }), /valor invalido/);
  assert.equal(JSON.stringify(exportarDados(b, AGORA)), antes);
});

test("restauracao falha no meio => rollback (nenhum dado perdido)", () => {
  const b = abrirBancoTeste();
  criarCartao(b, U, { apelido: "nomad" });
  const dump = exportarDados(b, AGORA);
  // lancamento sem cartao existente no dump viola FK -> excecao dentro da transacao
  dump.tabelas.lancamento = [{ id: 1, usuario_id: U, tipo: "despesa", valor_centavos: 1, descricao: "x", estabelecimento_norm: "x", categoria: "c", natureza: "eventual", cartao_id: 999, ocorrido_em: "2026-01-01T00:00:00Z", data_local: "2026-01-01", precisao_horario: "desconhecido", status: "confirmado", confianca: 1, hash_dedup: "h", criado_em: "t", atualizado_em: "t" }];
  assert.throws(() => restaurarDados(b, dump));
  assert.equal(listarCartoes(b, U).length, 1); // cartao original preservado
});
