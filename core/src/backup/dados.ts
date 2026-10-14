import type { Db } from "../db/tipos";
import { VERSAO_SCHEMA } from "../db/schema";

/** Tabelas na ordem segura para inserir (pais antes de filhos). Restaurar apaga na ordem inversa. */
export const TABELAS = ["conta", "cartao", "recorrencia", "lancamento", "lancamento_origem", "regra_classificacao", "mensagem_processada", "auditoria", "meta", "premissa"] as const;

export interface DumpDados {
  versao_schema: number;
  exportado_em: string;
  tabelas: Record<string, Record<string, string | number | null>[]>;
}

export function exportarDados(db: Db, agora = new Date()): DumpDados {
  const tabelas: DumpDados["tabelas"] = {};
  for (const t of TABELAS) tabelas[t] = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, string | number | null>[];
  return { versao_schema: VERSAO_SCHEMA, exportado_em: agora.toISOString(), tabelas };
}

const NOME_OK = /^[a-z_][a-z0-9_]*$/;

/**
 * Substitui TODOS os dados pelos do dump, em uma transacao (tudo ou nada).
 * O arquivo vem de fora: tabelas e colunas sao validadas contra o schema real, e valores so podem ser texto, numero ou nulo.
 */
export function restaurarDados(db: Db, dump: DumpDados): { linhas: number } {
  if (!dump || typeof dump !== "object" || typeof dump.versao_schema !== "number" || typeof dump.tabelas !== "object" || dump.tabelas === null) throw new Error("arquivo de backup invalido");
  if (dump.versao_schema > VERSAO_SCHEMA) throw new Error("backup criado por versao mais nova do aplicativo");
  const colunasPorTabela = new Map<string, Set<string>>();
  for (const t of TABELAS) colunasPorTabela.set(t, new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)));
  for (const nome of Object.keys(dump.tabelas)) if (!colunasPorTabela.has(nome)) throw new Error(`tabela desconhecida no backup: ${nome}`);
  for (const t of TABELAS) {
    for (const linha of dump.tabelas[t] ?? []) {
      for (const [col, v] of Object.entries(linha)) {
        if (!NOME_OK.test(col) || !colunasPorTabela.get(t)!.has(col)) throw new Error(`coluna desconhecida em ${t}: ${col}`);
        if (v !== null && typeof v !== "string" && typeof v !== "number") throw new Error(`valor invalido em ${t}.${col}`);
      }
    }
  }
  let total = 0;
  const executar = db.transaction(() => {
    for (const t of [...TABELAS].reverse()) db.prepare(`DELETE FROM ${t}`).run();
    for (const t of TABELAS) {
      for (const linha of dump.tabelas[t] ?? []) {
        const cols = Object.keys(linha);
        if (cols.length === 0) continue;
        db.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => linha[c]));
        total++;
      }
    }
  });
  executar();
  return { linhas: total };
}
