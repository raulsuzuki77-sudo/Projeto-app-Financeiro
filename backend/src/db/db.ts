import Database from "better-sqlite3";
import { prepararBanco, type Db } from "../../../core/src/index";

export type { Db };

export function abrirBanco(caminho: string = ":memory:"): Db {
  const d = new Database(caminho);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  const db = d as unknown as Db;
  prepararBanco(db);
  return db;
}
