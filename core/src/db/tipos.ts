/**
 * Subconjunto minimo de uma API SQLite sincrona. Implementada por:
 *  - better-sqlite3 (servidor e testes em Node), diretamente;
 *  - expo-sqlite (iPhone), por um adaptador fino.
 * O nucleo nunca importa um driver concreto.
 */
export interface Resultado {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Comando {
  run(...params: unknown[]): Resultado;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface Db {
  prepare(sql: string): Comando;
  exec(sql: string): unknown;
  /** Devolve uma funcao que executa `fn` dentro de uma transacao (aninhamento tratado pelo driver/adaptador). */
  transaction<T>(fn: () => T): () => T;
}
