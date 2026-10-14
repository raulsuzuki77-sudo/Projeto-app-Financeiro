import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBancoTeste } from "./helpers";
import { criarCartao, definirTitular, importarTexto, interpretarCartao, interpretarConta, lancarManual, lerCsv, obterLancamento, reaplicarRegrasAosPendentes, resumoMensal, sugerirCategorias, alterarLancamento, detectarFormatoCsv, classificar } from "../src/index";
import type { Db } from "../src/db/tipos";

// Dados SINTETICOS no formato dos extratos do Nubank (nomes e valores inventados).
const CONTA = `Data,Valor,Identificador,Descrição
03/08/2026,-692.38,id-0001,Pagamento de boleto efetuado - CONDOMINIO DO RESIDENCIAL ACACIAS
05/08/2026,-175.00,id-0002,Pagamento de fatura
06/08/2026,-55.00,id-0003,Transferência enviada pelo Pix - FULANO DE TAL SILVA - •••.123.456-•• - BCO DO BRASIL S.A. (0001) Agência: 1 Conta: 2-3
07/08/2026,90.00,id-0004,Transferência recebida pelo Pix - EMPRESA ALFA TREINAMENTOS LTDA - 12.345.678/0001-90 - BCO C6 S.A. (0336) Agência: 1 Conta: 4-5
11/08/2026,-1260.00,id-0005,Aplicação RDB
22/08/2026,11329.49,id-0006,Resgate RDB
28/08/2026,-50.00,id-0007,Transferência enviada pelo Pix - BELTRANO DE SOUSA - •••.654.321-•• - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 9-9
28/08/2026,50.00,id-0007,Estorno - Transferência enviada pelo Pix - BELTRANO DE SOUSA - •••.654.321-•• - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 9-9
28/08/2026,-50.00,id-0008,Transferência enviada pelo Pix - BELTRANO DE SOUSA - •••.654.321-•• - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 9-9
31/08/2026,-142.22,id-0009,"Transferência enviada pelo Pix - SINDICATO X - 11.111.111/0001-11 - COOP PROF DA JUST, SERV PÚBL Agência: 3348 Conta: 4139-4"
`;

const CARTAO = `date,title,amount
2026-08-25,Loja Exemplo*Compras - Parcela 2/3,"52,64"
2026-08-25,Loja Exemplo*Compras - Parcela 1/3,"52,69"
2026-08-25,Desconto Antecipação Loja Exemplo*Compras,"- 6,52"
2026-08-05,Pagamento recebido,"- 175,00"
2026-08-17,"IOF de ""Servico Exterior X""","3,99"
2026-08-16,IOF de volta de Servico Exterior X,"- 3,99"
2026-08-09,Mercadinho Central,"90,00"
2026-08-09,Mercadinho Central,"90,00"
`;

function importar(db: Db, csv: string, cartao?: number) {
  const r = importarTexto(db, "csv", csv, { usuario_id: "u", cartao_id: cartao ?? null });
  assert.ok(r.ok, r.ok ? "" : r.erro);
  return r;
}

test("detecta os formatos do Nubank e recusa cabecalhos desconhecidos como genericos", () => {
  assert.equal(detectarFormatoCsv(["Data", "Valor", "Identificador", "Descrição"]), "nubank_conta");
  assert.equal(detectarFormatoCsv(["date", "title", "amount"]), "nubank_cartao");
  assert.equal(detectarFormatoCsv(["Data", "Historico", "Valor"]), "generico");
});

test("conta: Pix, boleto e estorno sao simplificados; o texto original fica guardado", () => {
  const { itens, rejeitadas, formato } = lerCsv(CONTA);
  assert.equal(formato, "nubank_conta");
  assert.equal(rejeitadas.length, 0);
  assert.equal(itens.length, 10);
  assert.equal(itens[0]!.descricao, "Boleto: CONDOMINIO DO RESIDENCIAL ACACIAS");
  assert.equal(itens[0]!.forma_pagamento, "boleto");
  assert.equal(itens[2]!.descricao, "Pix enviado: FULANO DE TAL SILVA");
  assert.equal(itens[2]!.valor_centavos, -5500);
  assert.match(itens[2]!.texto_bruto!, /Agência/);
  assert.equal(itens[3]!.descricao, "Pix recebido: EMPRESA ALFA TREINAMENTOS LTDA");
  assert.equal(itens[7]!.estorno, true);
  assert.equal(itens[7]!.descricao, "Pix enviado: BELTRANO DE SOUSA");
  assert.equal(itens[9]!.descricao, "Pix enviado: SINDICATO X", "virgula entre aspas nao parte a linha");
  // o estorno usa o mesmo identificador do envio: o sinal os distingue
  assert.notEqual(itens[6]!.referencia, itens[7]!.referencia);
});

test("cartao: parcelas, desconto de antecipacao, IOF e pagamento", () => {
  assert.deepEqual(interpretarCartao("Loja Exemplo*Compras - Parcela 2/3", 5264), { descricao: "Loja Exemplo*Compras", forma_pagamento: "credito", estorno: false, parcela_atual: 2, parcela_total: 3 });
  assert.equal(interpretarCartao("Desconto Antecipação Loja Exemplo*Compras", -652).estorno, true);
  assert.equal(interpretarCartao("Pagamento recebido", -17500).descricao, "Pagamento de fatura");
  assert.equal(interpretarConta("Aplicação RDB").descricao, "Aplicação RDB");
  const { itens, rejeitadas, formato } = lerCsv(CARTAO);
  assert.equal(formato, "nubank_cartao");
  assert.equal(rejeitadas.length, 0);
  assert.equal(itens.find((i) => i.descricao.startsWith("IOF de \""))?.valor_centavos, 399);
});

test("importa conta e cartao: pagamento de fatura nao duplica, estorno abate, compras iguais no mesmo dia ficam separadas", () => {
  const db = abrirBancoTeste();
  const cid = criarCartao(db, "u", { apelido: "nubank" });
  const rc = importar(db, CARTAO, cid);
  assert.equal(rc.relatorio.lidos, 8);
  assert.equal(rc.relatorio.criados, 8);
  const rx = importar(db, CONTA);
  assert.equal(rx.relatorio.mesclados, 1, "o pagamento de fatura aparece na conta e no cartao: um so lancamento");
  const compras = db.prepare("SELECT COUNT(*) n FROM lancamento WHERE descricao = 'Mercadinho Central'").get() as { n: number };
  assert.equal(compras.n, 2, "duas compras identicas no mesmo arquivo continuam duas");
  const transf = db.prepare("SELECT COUNT(*) n FROM lancamento WHERE descricao = 'Pagamento de fatura'").get() as { n: number };
  assert.equal(transf.n, 1);
  // idempotente
  const de_novo = importar(db, CONTA);
  assert.equal(de_novo.relatorio.criados, 0);
  assert.equal(de_novo.relatorio.ja_processados, 10);
  assert.equal(importar(db, CARTAO, cid).relatorio.criados, 0);
});

test("aplicacao vira investimento, resgate e transferencia (nao e renda) e estorno abate a despesa", () => {
  const db = abrirBancoTeste();
  importar(db, CONTA);
  const r = resumoMensal(db, "u", "2026-08");
  assert.equal(r.investimentos_centavos, 126000, "somente a aplicacao conta como aporte");
  const resgate = db.prepare("SELECT tipo, categoria FROM lancamento WHERE descricao = 'Resgate RDB'").get() as { tipo: string; categoria: string };
  assert.deepEqual(resgate, { tipo: "transferencia", categoria: "resgate_investimento" });
  // Pix de 50 enviado, estornado e reenviado: a despesa liquida e 50, e o estorno nao e renda
  const pix = db.prepare("SELECT SUM(CASE WHEN tipo='despesa' THEN valor_centavos ELSE 0 END) d, SUM(CASE WHEN natureza='estorno' THEN valor_centavos ELSE 0 END) e FROM lancamento WHERE descricao = 'Pix enviado: BELTRANO DE SOUSA'").get() as { d: number; e: number };
  assert.deepEqual(pix, { d: 10000, e: 5000 });
  const sem_renda_falsa = db.prepare("SELECT COUNT(*) n FROM lancamento WHERE descricao = 'Pix enviado: BELTRANO DE SOUSA' AND tipo = 'receita' AND natureza = 'estorno'").get() as { n: number };
  assert.equal(sem_renda_falsa.n, 1);
  assert.equal(r.receitas_centavos, 9000, "so o Pix recebido e renda");
  const total_pix_liquido = r.por_categoria.reduce((s, c) => s + c.total_centavos, 0);
  assert.ok(total_pix_liquido <= r.despesas_centavos);
});

test("transacao igualmente repetida: validada pelo usuario em um mes e proposta no mes seguinte", () => {
  const db = abrirBancoTeste();
  // mes 1: o usuario lanca com categoria (confianca 1, sem criar regra)
  lancarManual(db, "u", { tipo: "despesa", valor_centavos: 15000, descricao: "Estudio Zeta", categoria: "lazer_passeios", data_local: "2026-07-10" }, "m1");
  const r = importarTexto(db, "csv", "Data,Descrição,Valor\n10/08/2026,Estudio Zeta,-150.00\n", { usuario_id: "u" });
  assert.ok(r.ok);
  const l = db.prepare("SELECT * FROM lancamento WHERE data_local = '2026-08-10'").get() as { categoria: string; status: string };
  assert.equal(l.categoria, "lazer_passeios");
  assert.equal(l.status, "confirmado");
  const c = classificar(db, "u", "Estudio Zeta", "despesa", { valor_centavos: 15000, data_local: "2026-09-10" });
  assert.equal(c.fonte, "repetida");
  assert.equal(sugerirCategorias(db, "u", "Estudio Zeta", "despesa", 3, { valor_centavos: 15000, data_local: "2026-09-10" })[0]!.motivo, "repetida");
  // no mesmo mes nao conta como "mes anterior"
  assert.notEqual(classificar(db, "u", "Estudio Zeta", "despesa", { valor_centavos: 15000, data_local: "2026-07-20" }).fonte, "repetida");
});

test("repeticao so vale com validacao do usuario e sem divergencia", () => {
  const db = abrirBancoTeste();
  // classificacao automatica por regra base nao serve de prova
  importarTexto(db, "csv", "Data,Descrição,Valor\n05/07/2026,Padaria Sol,-20.00\n", { usuario_id: "u" });
  assert.notEqual(classificar(db, "u", "Padaria Sol", "despesa", { valor_centavos: 2000, data_local: "2026-08-05" }).fonte, "repetida");
  // evidencias do usuario que divergem: nao propoe
  lancarManual(db, "u", { tipo: "despesa", valor_centavos: 9900, descricao: "Oficina Beta", categoria: "transporte_manutencao", data_local: "2026-06-01" }, "a");
  lancarManual(db, "u", { tipo: "despesa", valor_centavos: 9900, descricao: "Oficina Beta", categoria: "compras_diversas", data_local: "2026-07-01" }, "b");
  assert.notEqual(classificar(db, "u", "Oficina Beta", "despesa", { valor_centavos: 9900, data_local: "2026-09-01" }).fonte, "repetida");
  // valor diferente: nao e a mesma transacao
  lancarManual(db, "u", { tipo: "despesa", valor_centavos: 5000, descricao: "Estudio Gama", categoria: "lazer_passeios", data_local: "2026-06-01" }, "c");
  assert.notEqual(classificar(db, "u", "Estudio Gama", "despesa", { valor_centavos: 5100, data_local: "2026-07-01" }).fonte, "repetida");
});

test("titular: Pix entre as proprias contas vira transferencia, em qualquer direcao, e resolve pendentes", () => {
  const db = abrirBancoTeste();
  importar(db, `Data,Valor,Identificador,Descrição
01/08/2026,100.00,t1,Transferência recebida pelo Pix - MARIA CLARA DE SOUZA - •••.111.222-•• - BCO X Agência: 1 Conta: 1
02/08/2026,-80.00,t2,Transferência enviada pelo Pix - MARIA CLARA DE SOUZA - •••.111.222-•• - BCO X Agência: 1 Conta: 1
`);
  let r = resumoMensal(db, "u", "2026-08");
  assert.equal(r.pendentes, 2);
  assert.equal(r.receitas_centavos, 10000);
  assert.equal(definirTitular(db, "u", "Maria Clara de Souza"), 2);
  r = resumoMensal(db, "u", "2026-08");
  assert.equal(r.pendentes, 0);
  assert.equal(r.receitas_centavos, 0);
  assert.equal(r.despesas_centavos, 0);
  assert.throws(() => definirTitular(db, "u", "Ana"), /nome completo/);
  assert.equal(reaplicarRegrasAosPendentes(db, "u"), 0);
});

test("reclassificar para transferencia tira o gasto da despesa e voltar a categoria comum o devolve", () => {
  const db = abrirBancoTeste();
  importar(db, "Data,Descrição,Valor\n05/08/2026,Mercado do Zé,-30.00\n");
  const id = (db.prepare("SELECT id FROM lancamento").get() as { id: number }).id;
  assert.equal(resumoMensal(db, "u", "2026-08").despesas_centavos, 3000);
  alterarLancamento(db, id, "u", { categoria: "transferencia" });
  assert.equal(obterLancamento(db, id)!.tipo, "transferencia");
  assert.equal(resumoMensal(db, "u", "2026-08").despesas_centavos, 0);
  alterarLancamento(db, id, "u", { categoria: "alimentacao_supermercado" });
  assert.equal(obterLancamento(db, id)!.tipo, "despesa");
  assert.equal(resumoMensal(db, "u", "2026-08").despesas_centavos, 3000);
});
