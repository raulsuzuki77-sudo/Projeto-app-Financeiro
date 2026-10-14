import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBancoTeste } from "./helpers";
import {
  agruparOrigensLegadas, apagarDados, arquivoDaPastaResolvido, listarArquivosDaPasta, nomeDoBackupMensal, registrarArquivoDaPasta, reiniciarRegistroDaPasta, concluirDocumento, criarCartao, descartarDocumento, documentoPorHash, excluirDocumento, excluirMes, importarTexto, lancarManual, listarDocumentos, moverDocumento, moverMes,
  previaDoMes, registrarDocumento, resumoDeManuaisDoMes, versaoAnterior, exportarDados, restaurarDados, resumoMensal, listarLancamentos,
} from "../src/index";
import type { Db } from "../src/db/tipos";

const U = "u";
const CARTAO = `date,title,amount
2026-08-25,Loja Exemplo Alfa,"52,69"
2026-08-26,Mercadinho Central,"90,00"
2026-08-27,Padaria Bom Dia,"18,50"
2026-08-28,Posto Estrela,"200,00"
`;
const CARTAO_V2 = CARTAO + `2026-08-29,Farmacia Saude,"33,90"\n`;
const CONTA = `Data,Valor,Identificador,Descrição
03/08/2026,-692.38,id-0001,Pagamento de boleto efetuado - CONDOMINIO DO RESIDENCIAL ACACIAS
06/08/2026,-55.00,id-0003,Transferência enviada pelo Pix - FULANO DE TAL SILVA - •••.123.456-•• - BCO DO BRASIL S.A. (0001) Agência: 1 Conta: 2-3
`;

/** O que a camada do aplicativo faz: registra o documento, importa ligando as origens a ele e conclui com o relatorio. */
function importarComoDocumento(db: Db, nome: string, hash: string, csv: string, cartaoId: number | null) {
  const doc = registrarDocumento(db, { usuario_id: U, tipo: cartaoId ? "fatura_cartao" : "extrato_conta", formato: "csv", nome, hash_arquivo: hash, cartao_id: cartaoId });
  const r = importarTexto(db, "csv", csv, { usuario_id: U, cartao_id: cartaoId, documento_id: doc });
  assert.ok(r.ok);
  concluirDocumento(db, doc, r.relatorio);
  return { doc, relatorio: r.relatorio };
}
const n = (db: Db, sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { c: number }).c;

test("mesmo arquivo: o hash do conteudo e reconhecido e o documento aponta seus lancamentos", () => {
  const db = abrirBancoTeste();
  const cartao = criarCartao(db, U, { apelido: "nubank" });
  const { doc, relatorio } = importarComoDocumento(db, "Nubank_2026-08-02.csv", "h1", CARTAO, cartao);
  assert.equal(relatorio.criados, 4);
  const achado = documentoPorHash(db, U, "h1");
  assert.equal(achado?.fonte, "documento");
  assert.equal(achado?.id, doc);
  assert.equal(documentoPorHash(db, U, "outro"), undefined);
  const lista = listarDocumentos(db, U, { mes: "2026-08" });
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.lancamentos, 4);
  assert.equal(lista[0]!.lancamentos_no_mes, 4);
  assert.equal(lista[0]!.saidas_centavos, 5269 + 9000 + 1850 + 20000);
  assert.equal(lista[0]!.cartao, "nubank");
  assert.equal(lista[0]!.mes_referencia, "2026-08");
  assert.deepEqual(listarDocumentos(db, U, { mes: "2026-07" }), []);
});

test("nova versao do mesmo documento: itens repetidos nao sao contados de novo e a versao e reconhecida", () => {
  const db = abrirBancoTeste();
  const cartao = criarCartao(db, U, { apelido: "nubank" });
  const v1 = importarComoDocumento(db, "fatura-ago.csv", "h1", CARTAO, cartao);
  const v2 = importarComoDocumento(db, "fatura-ago-reexportada.csv", "h2", CARTAO_V2, cartao);
  assert.equal(v2.relatorio.criados, 1, "so o item novo entra");
  assert.equal(v2.relatorio.mesclados + v2.relatorio.ja_processados, 4);
  assert.equal(n(db, "SELECT COUNT(*) c FROM lancamento WHERE tipo = 'despesa'"), 5, "nenhum item em dobro");
  const v = versaoAnterior(db, v2.doc);
  assert.equal(v?.documento_id, v1.doc);
  assert.equal(v?.compartilhados, 4);
  assert.equal((db.prepare("SELECT versao_de FROM documento WHERE id = ?").get(v2.doc) as { versao_de: number }).versao_de, v1.doc);
  // excluir a versao antiga mantem o que a nova tambem trouxe
  const ex = excluirDocumento(db, U, { fonte: "documento", id: v1.doc });
  assert.equal(ex.lancamentos_removidos, 0);
  assert.equal(ex.lancamentos_mantidos, 4);
  assert.equal(n(db, "SELECT COUNT(*) c FROM lancamento WHERE tipo = 'despesa'"), 5);
  // um documento sem relacao nao e versao de ninguem
  const outro = importarComoDocumento(db, "extrato.csv", "h3", CONTA, null);
  assert.equal(versaoAnterior(db, outro.doc), null);
});

test("excluir o documento remove o que veio so dele, libera o hash e permite importar de novo", () => {
  const db = abrirBancoTeste();
  const cartao = criarCartao(db, U, { apelido: "nubank" });
  const a = importarComoDocumento(db, "fatura.csv", "h1", CARTAO, cartao);
  lancarManual(db, U, { tipo: "despesa", valor_centavos: 777, descricao: "Cafe digitado", categoria: "alimentacao_restaurante", data_local: "2026-08-10" }, "m1");
  const ex = excluirDocumento(db, U, { fonte: "documento", id: a.doc });
  assert.deepEqual(ex, { lancamentos_removidos: 4, lancamentos_mantidos: 0 });
  assert.equal(n(db, "SELECT COUNT(*) c FROM lancamento"), 1, "o lancamento digitado continua");
  assert.equal(n(db, "SELECT COUNT(*) c FROM lancamento_origem WHERE documento_id IS NOT NULL"), 0);
  assert.equal(documentoPorHash(db, U, "h1"), undefined);
  const b = importarComoDocumento(db, "fatura.csv", "h1", CARTAO, cartao);
  assert.equal(b.relatorio.criados, 4, "reimportar depois de excluir recria os itens");
  assert.throws(() => excluirDocumento(db, U, { fonte: "documento", id: 9999 }));
});

test("documento sem lancamento (leitura que falhou) pode ser descartado", () => {
  const db = abrirBancoTeste();
  const d = registrarDocumento(db, { usuario_id: U, tipo: "fatura_cartao", formato: "pdf", nome: "ruim.pdf", hash_arquivo: "hx" });
  descartarDocumento(db, d);
  assert.equal(documentoPorHash(db, U, "hx"), undefined);
});

test("mover o documento de mes desloca as datas, atualiza a chave de duplicidade e nao duplica ao reimportar", () => {
  const db = abrirBancoTeste();
  const cartao = criarCartao(db, U, { apelido: "nubank" });
  const a = importarComoDocumento(db, "fatura.csv", "h1", CARTAO, cartao);
  const r = moverDocumento(db, U, { fonte: "documento", id: a.doc }, 1);
  assert.deepEqual(r, { lancamentos_movidos: 4, lancamentos_mantidos: 0 });
  const datas = (db.prepare("SELECT data_local d FROM lancamento ORDER BY data_local").all() as { d: string }[]).map((x) => x.d);
  assert.deepEqual(datas, ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]);
  const d = listarDocumentos(db, U)[0]!;
  assert.equal(d.periodo_inicio, "2026-09-25");
  assert.equal(d.mes_referencia, "2026-09");
  assert.equal(resumoMensal(db, U, "2026-08").despesas_centavos, 0);
  assert.equal(resumoMensal(db, U, "2026-09").despesas_centavos, 5269 + 9000 + 1850 + 20000);
  // mes curto: 31/01 +1 = 28/02 (ultimo dia)
  const db2 = abrirBancoTeste();
  const ok = importarTexto(db2, "csv", "Data,Valor,Identificador,Descrição\n31/01/2026,-10.00,z1,Pagamento de boleto efetuado - LOJA ZETA\n", { usuario_id: U, documento_id: registrarDocumento(db2, { usuario_id: U, tipo: "extrato_conta", formato: "csv", nome: "x.csv", hash_arquivo: "hz" }) });
  assert.ok(ok.ok);
  moverDocumento(db2, U, { fonte: "documento", id: 1 }, 1);
  assert.equal((db2.prepare("SELECT data_local d FROM lancamento").get() as { d: string }).d, "2026-02-28");
  assert.throws(() => moverDocumento(db2, U, { fonte: "documento", id: 1 }, 1.5));
});

test("mes inteiro: previa, exclusao por escopo e mudanca de mes", () => {
  const db = abrirBancoTeste();
  const cartao = criarCartao(db, U, { apelido: "nubank" });
  importarComoDocumento(db, "fatura.csv", "h1", CARTAO, cartao);
  importarComoDocumento(db, "extrato.csv", "h2", CONTA, null);
  lancarManual(db, U, { tipo: "despesa", valor_centavos: 777, descricao: "Cafe digitado", categoria: "alimentacao_restaurante", data_local: "2026-08-10" }, "m1");
  assert.deepEqual(resumoDeManuaisDoMes(db, U, "2026-08"), { quantidade: 1, saidas_centavos: 777, entradas_centavos: 0 });
  assert.equal(previaDoMes(db, U, "2026-08", "tudo").lancamentos, 7);
  assert.equal(previaDoMes(db, U, "2026-08", "documentos").lancamentos, 6);
  assert.equal(previaDoMes(db, U, "2026-08", "manuais").lancamentos, 1);
  const m = moverMes(db, U, "2026-08", "2026-10", "documentos");
  assert.equal(m.lancamentos, 6);
  assert.equal(n(db, "SELECT COUNT(*) c FROM lancamento WHERE substr(data_local,1,7) = '2026-10'"), 6);
  assert.equal(n(db, "SELECT COUNT(*) c FROM lancamento WHERE substr(data_local,1,7) = '2026-08'"), 1, "o digitado ficou");
  assert.throws(() => moverMes(db, U, "2026-10", "2026-10", "tudo"));
  const e = excluirMes(db, U, "2026-10", "documentos");
  assert.equal(e.lancamentos, 6);
  assert.equal(listarDocumentos(db, U).length, 0, "documentos vazios saem do registro");
  assert.equal(excluirMes(db, U, "2026-08", "tudo").lancamentos, 1);
  assert.equal(n(db, "SELECT COUNT(*) c FROM lancamento"), 0);
});

test("extrato de investimento: listado, movido de mes e excluido com tudo o que depende dele", () => {
  const db = abrirBancoTeste();
  const e = db.prepare("INSERT INTO extrato_investimento (usuario_id, instituicao, conta, moeda, periodo_inicio, periodo_fim, hash_arquivo, importado_em) VALUES (?,?,?,?,?,?,?,?)").run(U, "BTG Pactual", "8004", "BRL", "2026-09-01", "2026-09-30", "hb", new Date().toISOString());
  const id = Number(e.lastInsertRowid);
  db.prepare("INSERT INTO posicao_investimento (usuario_id, extrato_id, mes, instituicao, conta, classe_ativo, ativo, valor_centavos, origem, criada_em) VALUES (?,?,?,?,?,?,?,?,?,?)").run(U, id, "2026-09", "BTG Pactual", "8004", "previdencia", "Fundo X", 100000, "extrato", "x");
  db.prepare("INSERT INTO movimento_investimento (usuario_id, extrato_id, data_local, instituicao, conta, tipo, descricao, valor_centavos) VALUES (?,?,?,?,?,?,?,?)").run(U, id, "2026-09-09", "BTG Pactual", "8004", "aporte", "Contribuição", 75000);
  assert.equal(documentoPorHash(db, U, "hb")?.fonte, "extrato_investimento");
  const lista = listarDocumentos(db, U, { mes: "2026-09" });
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.posicoes, 1);
  assert.match(lista[0]!.nome, /BTG Pactual/);
  moverDocumento(db, U, { fonte: "extrato_investimento", id }, -1);
  assert.equal((db.prepare("SELECT mes FROM posicao_investimento").get() as { mes: string }).mes, "2026-08");
  assert.equal((db.prepare("SELECT data_local d FROM movimento_investimento").get() as { d: string }).d, "2026-08-09");
  const ex = db.prepare("SELECT periodo_inicio i, periodo_fim f FROM extrato_investimento").get() as { i: string; f: string };
  assert.deepEqual(ex, { i: "2026-08-01", f: "2026-08-31" }, "fim de mes continua sendo fim de mes");
  excluirDocumento(db, U, { fonte: "extrato_investimento", id });
  assert.equal(n(db, "SELECT COUNT(*) c FROM posicao_investimento"), 0);
  assert.equal(n(db, "SELECT COUNT(*) c FROM movimento_investimento"), 0);
  assert.equal(n(db, "SELECT COUNT(*) c FROM extrato_investimento"), 0);
});

test("importacoes anteriores ao registro viram documentos 'anteriores' e podem ser ajustadas", () => {
  const db = abrirBancoTeste();
  const cartao = criarCartao(db, U, { apelido: "nubank" });
  // importa sem documento (como as versoes anteriores)
  const r = importarTexto(db, "csv", CARTAO, { usuario_id: U, cartao_id: cartao });
  assert.ok(r.ok);
  assert.equal(listarDocumentos(db, U).length, 0);
  assert.equal(agruparOrigensLegadas(db), 4);
  const lista = listarDocumentos(db, U, { mes: "2026-08" });
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.tipo, "legado");
  assert.match(lista[0]!.nome, /Importações anteriores/);
  assert.equal(lista[0]!.lancamentos, 4);
  assert.equal(agruparOrigensLegadas(db), 0, "idempotente");
  assert.equal(excluirDocumento(db, U, { fonte: "documento", id: lista[0]!.id }).lancamentos_removidos, 4);
});

test("zerar: so as movimentacoes (mantem cartoes e regras) ou tudo", () => {
  const db = abrirBancoTeste();
  const cartao = criarCartao(db, U, { apelido: "nubank" });
  importarComoDocumento(db, "fatura.csv", "h1", CARTAO, cartao);
  db.prepare("INSERT INTO regra_classificacao (usuario_id, padrao_norm, categoria, natureza) VALUES (?,?,?,?)").run(U, "loja exemplo", "compras_diversas", "eventual");
  db.prepare("INSERT INTO orcamento (usuario_id, mes, item, valor_centavos) VALUES (?,?,?,?)").run(U, "*", "moradia", 100000);
  apagarDados(db, "movimentacoes");
  assert.equal(n(db, "SELECT COUNT(*) c FROM lancamento"), 0);
  assert.equal(n(db, "SELECT COUNT(*) c FROM documento"), 0);
  assert.equal(n(db, "SELECT COUNT(*) c FROM lancamento_origem"), 0);
  assert.equal(n(db, "SELECT COUNT(*) c FROM cartao"), 1);
  assert.equal(n(db, "SELECT COUNT(*) c FROM regra_classificacao"), 1);
  assert.equal(n(db, "SELECT COUNT(*) c FROM orcamento"), 1);
  apagarDados(db, "tudo");
  assert.equal(n(db, "SELECT COUNT(*) c FROM cartao"), 0);
  assert.equal(n(db, "SELECT COUNT(*) c FROM regra_classificacao"), 0);
  assert.equal(n(db, "SELECT COUNT(*) c FROM orcamento"), 0);
  assert.deepEqual(listarLancamentos(db, U, {}), []);
});

test("backup: documentos fazem a ida e a volta, e backup antigo sem documentos agrupa as origens", () => {
  const db = abrirBancoTeste();
  const cartao = criarCartao(db, U, { apelido: "nubank" });
  importarComoDocumento(db, "fatura.csv", "h1", CARTAO, cartao);
  const dump = exportarDados(db);
  assert.equal(dump.tabelas.documento!.length, 1);
  const db2 = abrirBancoTeste();
  restaurarDados(db2, dump);
  assert.equal(documentoPorHash(db2, U, "h1")?.fonte, "documento");
  // backup de versao anterior: sem a tabela documento e sem a coluna documento_id nas origens
  const antigo = JSON.parse(JSON.stringify(dump)) as typeof dump;
  delete (antigo.tabelas as Record<string, unknown>).documento;
  for (const o of antigo.tabelas.lancamento_origem!) delete (o as Record<string, unknown>).documento_id;
  const db3 = abrirBancoTeste();
  restaurarDados(db3, antigo);
  assert.equal(listarDocumentos(db3, U)[0]?.tipo, "legado");
});

test("pasta de documentos: arquivo resolvido nao e lido de novo; erro e decisao pendente voltam a ser tentados; zerar limpa o registro", () => {
  const db = abrirBancoTeste();
  const a = { caminho: "fatura-ago.pdf", tamanho: 1000, modificado: 1760000000 };
  assert.equal(arquivoDaPastaResolvido(db, U, a.caminho, a.tamanho, a.modificado), false);
  registrarArquivoDaPasta(db, U, { ...a, status: "erro", mensagem: "falhou" });
  assert.equal(arquivoDaPastaResolvido(db, U, a.caminho, a.tamanho, a.modificado), false, "erro e tentado de novo");
  registrarArquivoDaPasta(db, U, { ...a, status: "precisa_decisao", mensagem: "PDF com senha" });
  assert.equal(arquivoDaPastaResolvido(db, U, a.caminho, a.tamanho, a.modificado), false);
  registrarArquivoDaPasta(db, U, { ...a, status: "importado", hash_arquivo: "h" });
  assert.equal(arquivoDaPastaResolvido(db, U, a.caminho, a.tamanho, a.modificado), true);
  assert.equal(arquivoDaPastaResolvido(db, U, a.caminho, 1001, a.modificado), false, "arquivo alterado e outra versao");
  assert.equal(listarArquivosDaPasta(db, U).length, 1);
  assert.equal(nomeDoBackupMensal("2026-10"), "controle-financeiro-2026-10.cfbackup");
  assert.throws(() => nomeDoBackupMensal("2026-13"));
  apagarDados(db, "movimentacoes");
  assert.equal(listarArquivosDaPasta(db, U).length, 0, "depois de zerar, a pasta volta a ser lida por inteiro");
  registrarArquivoDaPasta(db, U, { ...a, status: "importado" });
  assert.equal(reiniciarRegistroDaPasta(db, U), 1);
});
