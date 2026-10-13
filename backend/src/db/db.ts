import Database from "better-sqlite3";
import { SCHEMA } from "./schema.js";

export type Db = Database.Database;

export function abrirBanco(caminho: string = ":memory:"): Db {
  const db = new Database(caminho);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
