/**
 * Banco da VERSÃO WEB (navegador do computador): SQLite via sql.js, gravado no IndexedDB deste navegador, neste endereço.
 * Serve para testar o aplicativo (importar extratos, treinar a classificação) antes de instalar no iPhone; nada aqui roda no iPhone.
 * Com EXPO_PUBLIC_DEMO=1 (capturas de tela), o banco é só em memória e vem com dados fictícios de demonstração.
 */
import initSqlJs, { type Database } from "sql.js";
import { adaptarExpoSqlite, configurarFuso, prepararBanco, type Db, type ExpoSqliteLike, type ValorSql } from "../../../core/src/index";
import { semearDemonstracao } from "./semente";

let db: Db | null = null;
let bruto: Database | null = null;
const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
const IDB_NOME = "controle-financeiro";
const IDB_LOJA = "sqlite";

function abrirIdb(): Promise<IDBDatabase> {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(IDB_NOME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_LOJA);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}

async function lerIdb(): Promise<Uint8Array | null> {
  try {
    const i = await abrirIdb();
    return await new Promise((ok, erro) => {
      const q = i.transaction(IDB_LOJA).objectStore(IDB_LOJA).get("banco");
      q.onsuccess = () => ok((q.result as Uint8Array | undefined) ?? null);
      q.onerror = () => erro(q.error);
    });
  } catch {
    return null; // navegador sem IndexedDB (janela anonima, por exemplo): segue so em memoria
  }
}

async function gravarIdb(bytes: Uint8Array | null): Promise<void> {
  const i = await abrirIdb();
  await new Promise<void>((ok, erro) => {
    const t = i.transaction(IDB_LOJA, "readwrite");
    if (bytes) t.objectStore(IDB_LOJA).put(bytes, "banco");
    else t.objectStore(IDB_LOJA).delete("banco");
    t.oncomplete = () => ok();
    t.onerror = () => erro(t.error);
  });
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Grava o banco no navegador pouco depois da ultima alteracao (varias alteracoes seguidas viram uma gravacao). */
function agendarGravacao() {
  if (DEMO) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (!bruto) return;
    const bytes = bruto.export(); // export() reinicia o banco: reaplica a regra de chaves estrangeiras
    bruto.run("PRAGMA foreign_keys = ON");
    gravarIdb(bytes).catch(() => undefined);
  }, 400);
}

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
      agendarGravacao();
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
      agendarGravacao();
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
  const salvo = DEMO ? null : await lerIdb();
  const d = salvo ? new SQL.Database(salvo) : new SQL.Database();
  d.run("PRAGMA foreign_keys = ON");
  bruto = d;
  const novo = adaptarExpoSqlite(adaptarSqlJs(d));
  prepararBanco(novo);
  configurarFuso("dispositivo");
  if (DEMO) semearDemonstracao(novo);
  db = novo;
}

/** Verdadeiro quando os dados ficam gravados neste navegador (versão para computador); falso na demonstração. */
export function dadosNoNavegador(): boolean {
  return !DEMO;
}

/** Apaga TODOS os dados guardados neste navegador e recarrega a pagina. */
export async function apagarDadosDoNavegador(): Promise<void> {
  if (timer) clearTimeout(timer);
  await gravarIdb(null);
  location.reload();
}

export function obterBanco(): Db {
  if (!db) throw new Error("Banco da prévia web ainda não iniciado.");
  return db;
}
