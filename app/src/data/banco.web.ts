/**
 * Banco da PRÉVIA WEB (navegador): SQLite em memória via sql.js, com dados de demonstração.
 * Existe só para visualizar o aplicativo no navegador; nada aqui roda no iPhone.
 */
import initSqlJs, { type Database } from "sql.js";
import { adaptarExpoSqlite, configurarFuso, prepararBanco, type Db, type ExpoSqliteLike, type ValorSql } from "../../../core/src/index";
import { semearDemonstracao } from "./semente";

let db: Db | null = null;

function adaptarSqlJs(d: Database): ExpoSqliteLike {
  const ler = (sql: string, params: ValorSql[]) => {
    const st = d.prepare(sql);
    try {
      st.bind(params);
      const linhas: Record<string, unknown>[] = [];
      while (st.step()) linhas.push(st.getAsObject());
      return linhas;
    } finally {
      st.free();
    }
  };
  return {
    runSync(sql, params) {
      d.run(sql, params);
      const id = d.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0];
      return { lastInsertRowId: Number(id ?? 0), changes: d.getRowsModified() };
    },
    getFirstSync<T>(sql: string, params: ValorSql[]) {
      return (ler(sql, params)[0] as T | undefined) ?? null;
    },
    getAllSync<T>(sql: string, params: ValorSql[]) {
      return ler(sql, params) as T[];
    },
    execSync(sql) {
      d.exec(sql);
    },
    withTransactionSync(task) {
      d.run("BEGIN");
      try {
        task();
        d.run("COMMIT");
      } catch (e) {
        d.run("ROLLBACK");
        throw e;
      }
    },
  };
}

export async function iniciarBanco(): Promise<void> {
  if (db) return;
  const SQL = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
  const d = new SQL.Database();
  d.run("PRAGMA foreign_keys = ON");
  const novo = adaptarExpoSqlite(adaptarSqlJs(d));
  prepararBanco(novo);
  configurarFuso("dispositivo");
  semearDemonstracao(novo);
  db = novo;
}

export function obterBanco(): Db {
  if (!db) throw new Error("Banco da prévia web ainda não iniciado.");
  return db;
}
