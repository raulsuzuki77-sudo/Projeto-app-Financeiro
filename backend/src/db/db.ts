import Database from "better-sqlite3";
import { SCHEMA } from "./schema.js";

export type Db = Database.Database;

export function abrirBanco(caminho: string = ":memory:"): Db {
  const db = new Database(caminho);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  // Migração para bancos criados antes da coluna motivo_revisao.
  const colunas = db.prepare("PRAGMA table_info(lancamento)").all() as { name: string }[];
  if (!colunas.some((c) => c.name === "motivo_revisao")) db.exec("ALTER TABLE lancamento ADD COLUMN motivo_revisao TEXT");
  return db;
}
