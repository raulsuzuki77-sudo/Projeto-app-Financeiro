import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBancoTeste } from "./helpers";
import { candidatosParaEvento, classificarVarios, confirmarVarios, criarCartao, criarEvento, definirEventoVarios, excluirVarios, importarTexto, obterLancamento, restaurarVarios, listarLancamentos } from "../src/index";

const U = "u";
const CARTAO = `date,title,amount
2026-08-25,Loja Exemplo Alfa,"52,69"
2026-08-26,Mercadinho Central,"90,00"
2026-08-27,Hotel Mar Azul Reservas,"400,00"
`;
function preparar() {
  const db = abrirBancoTeste();
  const cartao = criarCartao(db, U, { apelido: "nubank" });
  const r = importarTexto(db, "csv", CARTAO, { usuario_id: U, cartao_id: cartao });
  assert.ok(r.ok);
  const ids = (db.prepare("SELECT id FROM lancamento ORDER BY id").all() as { id: number }[]).map((x) => x.id);
  return { db, ids };
}

test("lote: classificar varios de uma vez confirma, ajusta natureza e aprende a regra de cada estabelecimento", () => {
  const { db, ids } = preparar();
  assert.equal(classificarVarios(db, U, ids.slice(0, 2), "compras_diversas"), 2);
  for (const id of ids.slice(0, 2)) {
    const l = obterLancamento(db, id)!;
    assert.equal(l.categoria, "compras_diversas");
    assert.equal(l.status, "confirmado");
  }
  assert.throws(() => classificarVarios(db, U, ids, "nao_classificado"));
  assert.throws(() => classificarVarios(db, U, [], "compras_diversas"));
  assert.throws(() => classificarVarios(db, U, [999999], "compras_diversas"));
});

test("lote: excluir varios e desfazer; excluir de novo nao repete", () => {
  const { db, ids } = preparar();
  const alterados = excluirVarios(db, U, ids);
  assert.equal(alterados.length, 3);
  assert.equal((listarLancamentos(db, U, {}) as unknown[]).length, 0);
  assert.deepEqual(excluirVarios(db, U, ids), [], "ja excluidos nao entram");
  assert.equal(restaurarVarios(db, U, alterados), 3);
  assert.equal((listarLancamentos(db, U, {}) as unknown[]).length, 3);
});

test("lote: confirmar so os que tem categoria; evento em lote so para despesas", () => {
  const { db, ids } = preparar();
  assert.equal(obterLancamento(db, ids[0]!)!.categoria, "nao_classificado");
  db.prepare("UPDATE lancamento SET status = 'pendente' WHERE id = ?").run(ids[1]); // tem categoria (supermercado), mas esta pendente
  assert.equal(confirmarVarios(db, U, ids), 1, "os sem categoria ficam de fora");
  assert.equal(obterLancamento(db, ids[1]!)!.status, "confirmado");
  assert.equal(obterLancamento(db, ids[0]!)!.status, "pendente");
  const ev = criarEvento(db, U, { nome: "Viagem teste", tipo: "ferias", data_inicio: "2026-08-20", data_fim: "2026-08-30" });
  const evId = typeof ev === "number" ? ev : (ev as { id: number }).id;
  assert.equal(definirEventoVarios(db, U, ids, evId), 2, "o hotel ja entrou sozinho pelo periodo");
  assert.equal(obterLancamento(db, ids[2]!)!.evento_id, evId);
  assert.equal(definirEventoVarios(db, U, ids, evId), 0, "sem mudanca");
  assert.equal(definirEventoVarios(db, U, ids, null), 3);
  assert.equal(obterLancamento(db, ids[2]!)!.evento_id, null);
});

test("candidatos para evento trazem os detalhes que identificam o gasto", () => {
  const { db } = preparar();
  const ev = criarEvento(db, U, { nome: "Viagem teste", tipo: "ferias", data_inicio: "2026-09-10", data_fim: "2026-09-20" });
  const evId = typeof ev === "number" ? ev : (ev as { id: number }).id;
  const lista = candidatosParaEvento(db, U, evId, { busca: "hotel" });
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.cartao, "nubank");
  assert.equal(lista[0]!.forma_pagamento, "credito");
  assert.match(lista[0]!.texto_bruto ?? "", /Hotel Mar Azul/);
  assert.ok(lista[0]!.distancia_dias > 0);
});
