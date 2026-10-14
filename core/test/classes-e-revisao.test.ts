import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBancoTeste } from "./helpers";
import {
  alterarLancamento, classificar, definirLimiteClasse, editarLancamento, evolucaoDeClasses, importarTexto, listarParaRevisao, painelOrcamento, prepararBanco, registrarLancamento, resumoMensal, visoesDeDespesa,
} from "../src/index";
import type { Db } from "../src/db/tipos";

const U = "u";
let seq = 0;
function lanca(db: Db, data: string, valor: number, desc: string, extra: { categoria?: string; tipo?: "despesa" | "receita" | "investimento" } = {}) {
  return registrarLancamento(db, { usuario_id: U, tipo: extra.tipo ?? "despesa", valor_centavos: valor, descricao: desc, categoria: extra.categoria, data_local: data, hora_local: null, precisao_horario: "desconhecido", origem: "manual", referencia: `c${++seq}` });
}
const classe = (db: Db, mes: string, id: string) => painelOrcamento(db, U, mes).classes.find((c) => c.id === id)!;

test("aplicacao e resgate de RDB sao caixinhas da classe Meta, fora da Liberdade financeira", () => {
  const db = abrirBancoTeste();
  assert.equal(classificar(db, U, "Aplicação RDB", "despesa").categoria, "provisao_meta");
  assert.equal(classificar(db, U, "Resgate RDB", "receita").categoria, "resgate_provisao");
  const r = importarTexto(db, "csv", "Data,Valor,Identificador,Descrição\n05/09/2026,-1000.00,a1,Aplicação RDB\n06/09/2026,-500.00,a2,Aplicação RDB\n20/09/2026,300.00,a3,Resgate RDB\n", { usuario_id: U });
  assert.ok(r.ok);
  const meta = classe(db, "2026-09", "meta");
  const item = meta.itens.find((i) => i.categoria === "provisao_meta")!;
  assert.equal(item.realizado_centavos, 120000, "provisionado no mes = aplicado - resgatado");
  assert.equal(item.aplicado_centavos, 150000);
  assert.equal(item.resgatado_centavos, 30000);
  assert.equal(classe(db, "2026-09", "liberdade").realizado_centavos, 0, "caixinha nao conta como liberdade financeira");
  // o resgate nunca e renda nem despesa
  assert.equal(resumoMensal(db, U, "2026-09").receitas_centavos, 0);
  assert.equal(resumoMensal(db, U, "2026-09").despesas_centavos, 0);
});

test("resgate maior que a aplicacao nao deixa a Meta negativa; o uso da provisao fica informado", () => {
  const db = abrirBancoTeste();
  const r = importarTexto(db, "csv", "Data,Valor,Identificador,Descrição\n05/09/2026,-100.00,b1,Aplicação RDB\n08/09/2026,12550.00,b2,Resgate RDB\n", { usuario_id: U });
  assert.ok(r.ok);
  const item = classe(db, "2026-09", "meta").itens.find((i) => i.categoria === "provisao_meta")!;
  assert.equal(item.realizado_centavos, 0);
  assert.equal(item.resgatado_centavos, 1255000);
});

test("migracao: RDB que as versoes anteriores tinham como investimento passa a caixinha, com auditoria", () => {
  const db = abrirBancoTeste();
  lanca(db, "2026-08-11", 126000, "Aplicação RDB", { categoria: "investimento", tipo: "investimento" });
  lanca(db, "2026-08-22", 1132949, "Resgate RDB", { categoria: "resgate_investimento", tipo: "receita" });
  prepararBanco(db);
  const cats = (db.prepare("SELECT descricao, categoria, tipo FROM lancamento ORDER BY id").all() as { descricao: string; categoria: string; tipo: string }[]).map((x) => `${x.descricao}:${x.categoria}:${x.tipo}`);
  assert.deepEqual(cats, ["Aplicação RDB:provisao_meta:investimento", "Resgate RDB:resgate_provisao:transferencia"]);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM auditoria WHERE campo = 'categoria'").get() as { c: number }).c, 2);
  prepararBanco(db);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM auditoria WHERE campo = 'categoria'").get() as { c: number }).c, 2, "idempotente");
});

test("percentual da classe sobre a receita do mes (como na planilha) e limite de 30% do custo fixo", () => {
  const db = abrirBancoTeste();
  lanca(db, "2026-09-05", 1000000, "Salário", { categoria: "receita_trabalho", tipo: "receita" });
  lanca(db, "2026-09-06", 500000, "Custo de vida", { categoria: "receita_custo_vida", tipo: "receita" });
  lanca(db, "2026-09-10", 300000, "Aluguel", { categoria: "moradia" });
  lanca(db, "2026-09-12", 150000, "Previdência", { categoria: "investimento_previdencia", tipo: "investimento" });
  const p = painelOrcamento(db, U, "2026-09");
  assert.equal(p.base.centavos, 1000000, "o custo de vida vindo de outra conta nao entra na base");
  assert.equal(p.base.origem, "realizada");
  const fixo = classe(db, "2026-09", "custo_fixo");
  assert.equal(fixo.percentual_receita, 0.3);
  assert.equal(fixo.limite_percentual, 0.3);
  assert.equal(fixo.limite_origem, "padrao");
  assert.equal(fixo.acima_do_limite, false, "exatamente no limite nao estoura");
  assert.equal(classe(db, "2026-09", "liberdade").percentual_receita, 0.15);
  lanca(db, "2026-09-15", 10000, "Condomínio extra", { categoria: "moradia" });
  assert.equal(classe(db, "2026-09", "custo_fixo").acima_do_limite, true);
  definirLimiteClasse(db, U, "custo_fixo", 0.35);
  const depois = classe(db, "2026-09", "custo_fixo");
  assert.equal(depois.limite_percentual, 0.35);
  assert.equal(depois.limite_origem, "usuario");
  assert.equal(depois.acima_do_limite, false);
  assert.throws(() => definirLimiteClasse(db, U, "custo_fixo", 1.5));
  definirLimiteClasse(db, U, "custo_fixo", null);
  assert.equal(classe(db, "2026-09", "custo_fixo").limite_origem, "padrao");
  // os itens internos do orcamento (limites) nunca aparecem como categoria
  assert.ok(!painelOrcamento(db, U, "2026-09").classes.some((c) => c.itens.some((i) => i.categoria.startsWith("__"))));
});

test("sem receita lancada a base e a receita planejada; sem nenhuma, os percentuais ficam em branco", () => {
  const db = abrirBancoTeste();
  lanca(db, "2026-09-10", 300000, "Aluguel", { categoria: "moradia" });
  assert.equal(painelOrcamento(db, U, "2026-09").base.origem, "nenhuma");
  assert.equal(classe(db, "2026-09", "custo_fixo").percentual_receita, null);
  const evo = evolucaoDeClasses(db, U, "2026-09", 3);
  assert.deepEqual(evo.meses, ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(evo.classes.find((c) => c.id === "custo_fixo")!.valores_centavos, [0, 0, 300000]);
});

test("Sem categoria nunca fica confirmado: edicao, confirmacao e restauracao mantem pendente", () => {
  const db = abrirBancoTeste();
  const l = lanca(db, "2026-09-10", 1100, "Loja Desconhecida XYZ");
  assert.ok(l.resultado === "criado");
  const id = l.lancamento.id;
  assert.equal(l.lancamento.categoria, "nao_classificado");
  assert.equal(l.lancamento.status, "pendente");
  // editar a descricao e salvar sem escolher categoria
  const e = editarLancamento(db, id, U, { descricao: "Loja Desconhecida XYZ Ltda" });
  assert.equal(e.status, "pendente");
  assert.equal(e.categoria, "nao_classificado");
  // pedir para confirmar sem categoria
  assert.equal(alterarLancamento(db, id, U, { status: "confirmado" }).status, "pendente");
  // com categoria, confirma
  assert.equal(editarLancamento(db, id, U, { categoria: "compras_diversas" }).status, "confirmado");
});

test("recorrencia sem categoria tambem entra pendente", () => {
  const db = abrirBancoTeste();
  const r = lanca(db, "2026-09-10", 1100, "Algo sem nome conhecido", { categoria: "nao_classificado" });
  assert.ok(r.resultado === "criado");
  assert.equal(r.lancamento.status, "pendente");
});

test("migracao: sem categoria que estava confirmado volta para a revisao, e o total sem categoria casa com a lista", () => {
  const db = abrirBancoTeste();
  const l = lanca(db, "2026-09-10", 1100, "Loja Desconhecida XYZ");
  assert.ok(l.resultado === "criado");
  db.prepare("UPDATE lancamento SET status = 'confirmado', confianca = 1, motivo_revisao = NULL WHERE id = ?").run(l.lancamento.id); // estado de versoes anteriores
  const antes = listarParaRevisao(db, U, { ate: "2026-09-30" }) as { id: number }[];
  assert.equal(antes.length, 1, "a revisao mostra o sem categoria mesmo confirmado");
  prepararBanco(db);
  const l2 = db.prepare("SELECT status, motivo_revisao FROM lancamento WHERE id = ?").get(l.lancamento.id) as { status: string; motivo_revisao: string };
  assert.equal(l2.status, "pendente");
  assert.match(l2.motivo_revisao, /sem categoria/);
  const semCat = visoesDeDespesa(db, U, "2026-09").categoria.find((c) => c.id === "nao_classificado")!;
  assert.equal(semCat.total_centavos, 1100);
});

test("revisao inclui pendentes ate hoje e qualquer sem categoria (mesmo futuro), e ordena", () => {
  const db = abrirBancoTeste();
  const a = lanca(db, "2026-09-10", 5000, "Loja Alfa Qualquer");
  const b = lanca(db, "2026-10-20", 900, "Loja Beta Qualquer"); // futuro, sem categoria
  const c = lanca(db, "2026-10-25", 700, "Mercado Central", { categoria: "alimentacao_supermercado" });
  assert.ok(a.resultado === "criado" && b.resultado === "criado" && c.resultado === "criado");
  db.prepare("UPDATE lancamento SET status = 'pendente' WHERE id = ?").run(c.lancamento.id); // futuro pendente com categoria
  const hoje = (db.prepare("SELECT id FROM lancamento WHERE descricao = ?").get("Loja Alfa Qualquer") as { id: number }).id;
  const lista = listarParaRevisao(db, U, { ate: "2026-09-30", ordem: "valor_asc" }) as { id: number; descricao: string }[];
  assert.deepEqual(lista.map((x) => x.descricao), ["Loja Beta Qualquer", "Loja Alfa Qualquer"], "o pendente futuro com categoria fica de fora; o futuro sem categoria entra");
  assert.ok(lista.some((x) => x.id === hoje));
});
