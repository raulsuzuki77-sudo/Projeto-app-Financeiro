import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

/**
 * Copia consistente do banco (API de backup do SQLite, segura com o servidor em uso)
 * e remoção das cópias mais antigas. Uso: tsx src/backup.ts <banco> <pasta-destino> [manter=14]
 */
export async function fazerBackup(origem: string, pasta: string, manter = 14, agora = new Date()): Promise<string> {
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const carimbo = agora.toISOString().replace(/[:.]/g, "-");
  const destino = join(pasta, `dados-${carimbo}.db`);
  const db = new Database(origem, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destino);
  } finally {
    db.close();
  }
  const antigos = readdirSync(pasta).filter((f) => /^dados-.*\.db(\.enc)?$/.test(f)).sort();
  for (const f of antigos.slice(0, Math.max(0, antigos.length - manter))) rmSync(join(pasta, f));
  return destino;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [origem, pasta, manter] = process.argv.slice(2);
  if (!origem || !pasta) {
    console.error("Uso: tsx src/backup.ts <banco> <pasta-destino> [manter]");
    process.exit(1);
  }
  fazerBackup(origem, pasta, manter ? Number(manter) : 14).then((d) => console.log(d));
}
