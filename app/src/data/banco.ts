import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import { adaptarExpoSqlite, configurarFuso, prepararBanco, type Db } from "../../../core/src/index";

let bruto: SQLiteDatabase | null = null;
let db: Db | null = null;

/** Abre (uma única vez) o banco local do aparelho. Os dados nunca saem do iPhone, salvo no backup que o usuário exportar. */
export function obterBanco(): Db {
  if (db) return db;
  bruto = openDatabaseSync("financeiro.db");
  bruto.execSync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const novo = adaptarExpoSqlite(bruto);
  prepararBanco(novo);
  configurarFuso("dispositivo"); // data e hora dos gastos seguem o fuso do aparelho
  db = novo;
  return novo;
}

/** No iPhone o banco abre de forma síncrona; a função existe para a prévia web, que precisa de preparo assíncrono. */
export async function iniciarBanco(): Promise<void> {
  obterBanco();
}
