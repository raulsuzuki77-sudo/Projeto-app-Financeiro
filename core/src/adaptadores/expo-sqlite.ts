import type { Comando, Db } from "../db/tipos";

export type ValorSql = string | number | null;

/** Subconjunto estrutural de expo-sqlite (SQLiteDatabase, API sincrona). Mantido aqui para testar sem React Native. */
export interface ExpoSqliteLike {
  runSync(source: string, params: ValorSql[]): { lastInsertRowId: number; changes: number };
  getFirstSync<T>(source: string, params: ValorSql[]): T | null;
  getAllSync<T>(source: string, params: ValorSql[]): T[];
  execSync(source: string): void;
  withTransactionSync(task: () => void): void;
}

/**
 * Adapta o expo-sqlite (iPhone) a interface Db do nucleo.
 * - Parametros `undefined` viram NULL (better-sqlite3 rejeita; expo-sqlite tambem nao os aceita);
 *   booleanos viram 0/1.
 * - Transacoes aninhadas executam direto dentro da transacao externa (o expo-sqlite nao permite aninhar).
 */
export function adaptarExpoSqlite(db: ExpoSqliteLike): Db {
  let profundidade = 0;
  const limpar = (p: unknown[]): ValorSql[] =>
    p.map((v) => {
      if (v === undefined || v === null) return null;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "bigint") return Number(v);
      if (typeof v === "string" || typeof v === "number") return v;
      throw new Error(`tipo de parametro SQL nao suportado: ${typeof v}`);
    });
  return {
    prepare(sql: string): Comando {
      return {
        run: (...p) => {
          const r = db.runSync(sql, limpar(p));
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowId };
        },
        get: (...p) => db.getFirstSync(sql, limpar(p)) ?? undefined,
        all: (...p) => db.getAllSync(sql, limpar(p)),
      };
    },
    exec: (sql) => db.execSync(sql),
    transaction<T>(fn: () => T): () => T {
      return () => {
        if (profundidade > 0) return fn();
        let resultado!: T;
        profundidade++;
        try {
          db.withTransactionSync(() => {
            resultado = fn();
          });
        } finally {
          profundidade--;
        }
        return resultado;
      };
    },
  };
}
