import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { adaptarExpoSqlite, prepararBanco, processarMensagem, criarCartao, registrarLancamento, resumoMensal, type ExpoSqliteLike, type ValorSql } from "../src/index";

/** Imita a API do expo-sqlite (sincrona) sobre better-sqlite3, incluindo as restricoes que importam:
 *  parametros so null/number/string; transacao aninhada e erro; withTransactionSync devolve void. */
function falsoExpo(): ExpoSqliteLike & { chamadas: string[] } {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  let emTransacao = false;
  const chamadas: string[] = [];
  const checar = (p: ValorSql[]) => {
    for (const v of p) if (!(v === null || typeof v === "number" || typeof v === "string")) throw new Error(`parametro nao aceito pelo expo-sqlite: ${typeof v}`);
  };
  return {
    chamadas,
    runSync(sql, p) { checar(p); const r = d.prepare(sql).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    getFirstSync<T>(sql: string, p: ValorSql[]) { checar(p); return (d.prepare(sql).get(...p) as T | undefined) ?? null; },
    getAllSync<T>(sql: string, p: ValorSql[]) { checar(p); return d.prepare(sql).all(...p) as T[]; },
    execSync(sql) { d.exec(sql); },
    withTransactionSync(task) {
      if (emTransacao) throw new Error("cannot start a transaction within a transaction");
      chamadas.push("tx");
      emTransacao = true;
      d.exec("BEGIN");
      try { task(); d.exec("COMMIT"); } catch (e) { d.exec("ROLLBACK"); throw e; } finally { emTransacao = false; }
    },
  };
}

test("nucleo completo sobre o adaptador expo-sqlite: mensagem, cartao, dedup, resumo", () => {
  const f = falsoExpo();
  const db = adaptarExpoSqlite(f);
  prepararBanco(db);
  criarCartao(db, "local", { apelido: "nomad" });
  const AGORA = new Date("2026-10-13T22:30:00Z");
  assert.match(processarMensagem(db, { id: "a", usuario_id: "local", texto: "assai 100,50 credito nomad", recebida_em: AGORA }), /Registrado/);
  assert.equal(processarMensagem(db, { id: "a", usuario_id: "local", texto: "assai 100,50 credito nomad", recebida_em: AGORA }), ""); // idempotente
  assert.equal(resumoMensal(db, "local", "2026-10").despesas_centavos, 10050);
  assert.ok(f.chamadas.length > 0);
});

test("transacao aninhada nao quebra (registrarLancamento dentro de outra transacao)", () => {
  const db = adaptarExpoSqlite(falsoExpo());
  prepararBanco(db);
  const externa = db.transaction(() => {
    registrarLancamento(db, { usuario_id: "local", tipo: "despesa", valor_centavos: 100, descricao: "padaria", data_local: "2026-10-01", precisao_horario: "desconhecido", origem: "csv", referencia: "1" });
    registrarLancamento(db, { usuario_id: "local", tipo: "despesa", valor_centavos: 200, descricao: "mercado", data_local: "2026-10-02", precisao_horario: "desconhecido", origem: "csv", referencia: "2" });
    return 2;
  });
  assert.equal(externa(), 2);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM lancamento").get() as { c: number }).c, 2);
});

test("erro dentro da transacao faz rollback e o adaptador volta ao estado inicial", () => {
  const db = adaptarExpoSqlite(falsoExpo());
  prepararBanco(db);
  const falha = db.transaction(() => {
    db.prepare("INSERT INTO conta (nome) VALUES (?)").run("A");
    throw new Error("boom");
  });
  assert.throws(falha, /boom/);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM conta").get() as { c: number }).c, 0);
  db.transaction(() => db.prepare("INSERT INTO conta (nome) VALUES (?)").run("B"))(); // nao ficou preso em 'aninhado'
  assert.equal((db.prepare("SELECT COUNT(*) c FROM conta").get() as { c: number }).c, 1);
});

test("parametros undefined e booleanos sao convertidos", () => {
  const db = adaptarExpoSqlite(falsoExpo());
  prepararBanco(db);
  db.prepare("INSERT INTO conta (nome, instituicao) VALUES (?, ?)").run("A", undefined);
  assert.equal((db.prepare("SELECT instituicao i FROM conta").get() as { i: unknown }).i, null);
});

test("tipo de parametro nao suportado e recusado com mensagem clara", () => {
  const db = adaptarExpoSqlite(falsoExpo());
  prepararBanco(db);
  assert.throws(() => db.prepare("INSERT INTO conta (nome) VALUES (?)").run({ x: 1 }), /nao suportado/);
});
