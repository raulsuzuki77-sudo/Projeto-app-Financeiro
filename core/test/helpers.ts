import Database from "better-sqlite3";
import { prepararBanco } from "../src/db/schema";
import type { Db } from "../src/db/tipos";

/** Banco SQLite em memoria (better-sqlite3) com o schema do nucleo. Usado so em testes. */
export function abrirBancoTeste(caminho = ":memory:"): Db & { close(): void } {
  const d = new Database(caminho);
  d.pragma("foreign_keys = ON");
  const db = d as unknown as Db & { close(): void };
  prepararBanco(db);
  return db;
}
