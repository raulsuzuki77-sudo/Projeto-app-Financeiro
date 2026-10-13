import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { fazerBackup } from "../src/backup";
import { abrirBanco } from "../src/db/db";

test("backup consistente e retencao das copias mais antigas", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"));
  try {
    const origem = join(dir, "dados.db");
    const db = abrirBanco(origem) as unknown as { close(): void; prepare(s: string): { run(): unknown } };
    db.prepare("INSERT INTO conta (nome) VALUES ('Corrente')").run();
    db.close();
    for (let i = 0; i < 4; i++) await fazerBackup(origem, join(dir, "bk"), 2, new Date(Date.UTC(2026, 9, 10 + i)));
    const arquivos = readdirSync(join(dir, "bk")).sort();
    assert.equal(arquivos.length, 2);
    assert.match(arquivos[0]!, /2026-10-12/);
    const copia = new Database(join(dir, "bk", arquivos[1]!), { readonly: true });
    assert.equal((copia.prepare("SELECT COUNT(*) c FROM conta").get() as { c: number }).c, 1);
    copia.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
