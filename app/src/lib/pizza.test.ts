import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparFatias, caminhoAnel, geometriaPizza } from "./pizza.ts";

test("agrupa as menores em Outras, ordena por valor e descarta zeros", () => {
  const dados = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, rotulo: `C${i}`, valor: (i + 1) * 100 }));
  const g = agruparFatias([...dados, { id: "z", rotulo: "Z", valor: 0 }], 7);
  assert.equal(g.length, 8);
  assert.equal(g[0]!.id, "c9");
  assert.equal(g[7]!.id, "__outras");
  assert.equal(g[7]!.valor, 100 + 200 + 300);
  assert.equal(agruparFatias([{ id: "a", rotulo: "A", valor: 5 }], 7).length, 1);
});

test("fracoes somam 1 e cada fatia tem caminho proprio", () => {
  const g = geometriaPizza([{ id: "a", rotulo: "A", valor: 50 }, { id: "b", rotulo: "B", valor: 30 }, { id: "c", rotulo: "C", valor: 20 }], 200);
  assert.equal(g.length, 3);
  assert.ok(Math.abs(g.reduce((s, x) => s + x.fracao, 0) - 1) < 1e-12);
  assert.equal(new Set(g.map((x) => x.caminho)).size, 3);
  assert.ok(g.every((x) => x.caminho.startsWith("M ") && x.caminho.endsWith("Z")));
});

test("fatia unica de 100% vira anel completo (dois semicirculos por contorno)", () => {
  const g = geometriaPizza([{ id: "a", rotulo: "A", valor: 10 }], 100);
  assert.equal((g[0]!.caminho.match(/A /g) ?? []).length, 4);
});

test("arco maior que 180 graus usa o flag de arco grande", () => {
  assert.match(caminhoAnel(50, 50, 40, 20, 0, Math.PI * 1.5), /A 40 40 0 1 1/);
  assert.match(caminhoAnel(50, 50, 40, 20, 0, Math.PI * 0.5), /A 40 40 0 0 1/);
});

test("sem valores, sem geometria", () => {
  assert.deepEqual(geometriaPizza([], 100), []);
  assert.deepEqual(geometriaPizza([{ id: "a", rotulo: "A", valor: 0 }], 100), []);
});
