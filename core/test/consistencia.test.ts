import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBancoTeste } from "./helpers";
import { alterarLancamento, classificar, importarTexto, listarLancamentos, obterLancamento, prepararBanco, registrarLancamento, resumoMensal, visoesDeDespesa, calendarioMensal } from "../src/index";
import type { Db } from "../src/db/tipos";

const U = "u";
let seq = 0;
function lanca(db: Db, data: string, valor: number, desc: string, o: { categoria?: string; tipo?: "despesa" | "receita" | "investimento"; natureza?: never; estorno?: boolean } = {}) {
  return registrarLancamento(db, { usuario_id: U, tipo: o.tipo ?? "despesa", valor_centavos: valor, descricao: desc, categoria: o.categoria, estorno: o.estorno, data_local: data, hora_local: null, precisao_horario: "desconhecido", origem: "manual", referencia: `c${++seq}` });
}

test("categoria, grupo, classe, natureza e despesas do mes somam o mesmo total", () => {
  const db = abrirBancoTeste();
  lanca(db, "2026-09-02", 50000, "Aluguel", { categoria: "moradia" });
  lanca(db, "2026-09-03", 30000, "Mercado", { categoria: "alimentacao_supermercado" });
  lanca(db, "2026-09-04", 12000, "Jantar", { categoria: "alimentacao_restaurante" });
  lanca(db, "2026-09-05", 7000, "Coisa sem categoria desconhecida zzz");
  lanca(db, "2026-09-06", 9000, "Loja X", { categoria: "compras_diversas" });
  lanca(db, "2026-09-07", 4000, "Devolucao Loja X", { categoria: "compras_diversas", tipo: "receita", estorno: true });
  lanca(db, "2026-09-08", 100000, "Aporte", { categoria: "investimento", tipo: "investimento" });
  const r = resumoMensal(db, U, "2026-09");
  const soma = (xs: { total_centavos: number }[]) => xs.reduce((s, x) => s + x.total_centavos, 0);
  const v = visoesDeDespesa(db, U, "2026-09");
  assert.equal(r.despesas_centavos, 50000 + 30000 + 12000 + 7000 + 9000 - 4000);
  assert.equal(soma(r.por_categoria), r.despesas_centavos);
  assert.equal(soma(r.por_natureza.map((n) => ({ total_centavos: n.total_centavos }))), r.despesas_centavos, "natureza bate com categoria (o estorno abate)");
  assert.equal(v.total_centavos, r.despesas_centavos);
  for (const visao of [v.categoria, v.grupo, v.classe]) assert.equal(soma(visao), v.total_centavos);
  assert.ok(v.grupo.some((g) => g.id === "sem_categoria"), "sem categoria aparece em todas as visoes");
  assert.ok(v.classe.some((g) => g.id === "sem_classe"));
  const cal = calendarioMensal(db, U, "2026-09");
  assert.equal(soma(cal), r.despesas_centavos, "o calendario tambem abate o estorno");
});

test("regra aprendida ao receber nao contamina o Pix enviado", () => {
  const db = abrirBancoTeste();
  const r = importarTexto(db, "csv", "Data,Valor,Identificador,Descrição\n05/09/2026,500.00,a1,Transferência recebida pelo Pix - FULANO DE TAL SILVA - •••.111.222-•• - BANCO X Agência: 1 Conta: 1\n", { usuario_id: U });
  assert.ok(r.ok);
  const id = (db.prepare("SELECT id FROM lancamento").get() as { id: number }).id;
  alterarLancamento(db, id, U, { categoria: "receita_trabalho" });
  const env = classificar(db, U, "Pix enviado: FULANO DE TAL SILVA", "despesa");
  assert.ok(!env.categoria.startsWith("receita"), `saida nao pode virar ${env.categoria}`);
  // mesmo uma regra antiga, sem direcao, e ignorada para saidas
  db.prepare("INSERT INTO regra_classificacao (usuario_id, padrao_norm, categoria, natureza) VALUES (?,?,?,?)").run(U, "beltrano", "receita_trabalho", "eventual");
  assert.ok(!classificar(db, U, "Pix enviado: BELTRANO", "despesa").categoria.startsWith("receita"));
});

test("cura de dados antigos: saida com categoria de receita volta a pendente e fica na auditoria", () => {
  const db = abrirBancoTeste();
  lanca(db, "2026-09-02", 867755, "Pix enviado: ALGUEM", { categoria: "receita_trabalho" });
  lanca(db, "2026-09-02", 1000, "Pix recebido: OUTRO", { categoria: "supermercado_inexistente", tipo: "receita" });
  assert.equal(resumoMensal(db, U, "2026-09").por_categoria.some((c) => c.categoria === "receita_trabalho"), true, "antes da cura o erro aparece");
  prepararBanco(db);
  const r = resumoMensal(db, U, "2026-09");
  assert.equal(r.por_categoria.some((c) => c.categoria === "receita_trabalho"), false);
  const l = listarLancamentos(db, U, { status: "pendente" }) as { categoria: string; motivo_revisao: string }[];
  assert.equal(l.length, 2);
  assert.ok(l.every((x) => /reclassifique/.test(x.motivo_revisao)));
  const aud = (db.prepare("SELECT COUNT(*) c FROM auditoria WHERE campo = 'categoria'").get() as { c: number }).c;
  assert.equal(aud, 2);
  prepararBanco(db); // idempotente
  assert.equal((db.prepare("SELECT COUNT(*) c FROM auditoria WHERE campo = 'categoria'").get() as { c: number }).c, 2);
});

test("entrada classificada como gasto vira estorno e abate o gasto; saida classificada como receita vira entrada", () => {
  const db = abrirBancoTeste();
  lanca(db, "2026-09-02", 10000, "Compra", { categoria: "compras_diversas" });
  const dev = lanca(db, "2026-09-03", 3000, "Pix recebido: LOJA", { tipo: "receita" });
  const id = (dev as { lancamento: { id: number } }).lancamento.id;
  alterarLancamento(db, id, U, { categoria: "compras_diversas" });
  const l = obterLancamento(db, id)!;
  assert.equal(l.natureza, "estorno");
  assert.equal(resumoMensal(db, U, "2026-09").despesas_centavos, 7000);
  assert.equal(resumoMensal(db, U, "2026-09").receitas_centavos, 0, "devolucao nao e renda");
  const s = lanca(db, "2026-09-04", 5000, "Pix enviado: X");
  const sid = (s as { lancamento: { id: number } }).lancamento.id;
  alterarLancamento(db, sid, U, { categoria: "receita_outras" });
  assert.equal(obterLancamento(db, sid)!.tipo, "receita");
});

test("listarLancamentos: ordenacao por valor e data, filtro por evento", () => {
  const db = abrirBancoTeste();
  lanca(db, "2026-09-02", 500, "A", { categoria: "compras_diversas" });
  lanca(db, "2026-09-03", 900, "B", { categoria: "compras_diversas" });
  lanca(db, "2026-09-01", 700, "C", { categoria: "compras_diversas" });
  const nomes = (ordem: "data_desc" | "data_asc" | "valor_desc" | "valor_asc") => (listarLancamentos(db, U, { ordem }) as { descricao: string }[]).map((x) => x.descricao).join("");
  assert.equal(nomes("data_desc"), "BAC");
  assert.equal(nomes("data_asc"), "CAB");
  assert.equal(nomes("valor_desc"), "BCA");
  assert.equal(nomes("valor_asc"), "ACB");
  assert.equal((listarLancamentos(db, U, { evento: "nenhum" }) as unknown[]).length, 3);
  assert.equal((listarLancamentos(db, U, { ate: "2026-09-02" }) as unknown[]).length, 2);
});
