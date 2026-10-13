import type { Db } from "../db/tipos";
import type { Natureza, Tipo } from "../domain/types";
import { normalizar } from "../parsing/text";
import { REGRAS_BASE } from "./regras-base";

export interface Classificacao {
  categoria: string;
  natureza: Natureza;
  confianca: number;
  fonte: "usuario" | "base" | "nenhuma";
}

const CONF_USUARIO = 0.95;
const CONF_BASE = 0.8;

function contemTermo(descNorm: string, termo: string): boolean {
  return new RegExp(`(^|\\s)${termo.replace(/\s+/g, "\\s+")}(\\s|$)`).test(descNorm);
}

/**
 * Classificação em camadas: (1) regras aprendidas das correções do usuário,
 * (2) regras base, (3) sem correspondência -> confiança 0, vai para revisão.
 * A camada por modelo de linguagem entra na Fase 2 atrás desta mesma interface.
 */
export function classificar(db: Db, usuarioId: string, descricao: string, tipo: Tipo): Classificacao {
  const desc = normalizar(descricao);

  const regras = db
    .prepare("SELECT padrao_norm, categoria, natureza FROM regra_classificacao WHERE usuario_id = ? ORDER BY length(padrao_norm) DESC")
    .all(usuarioId) as { padrao_norm: string; categoria: string; natureza: Natureza }[];
  for (const r of regras) {
    if (contemTermo(desc, r.padrao_norm)) {
      return { categoria: r.categoria, natureza: r.natureza, confianca: CONF_USUARIO, fonte: "usuario" };
    }
  }

  for (const r of REGRAS_BASE) {
    if (r.termos.some((t) => contemTermo(desc, t))) {
      return { categoria: r.categoria, natureza: r.natureza, confianca: CONF_BASE, fonte: "base" };
    }
  }

  if (tipo === "receita") return { categoria: "receita_outras", natureza: "eventual", confianca: 0.6, fonte: "nenhuma" };
  if (tipo === "investimento") return { categoria: "investimento", natureza: "investimento", confianca: 0.85, fonte: "base" };
  if (tipo === "transferencia") return { categoria: "transferencia", natureza: "transferencia", confianca: 0.85, fonte: "base" };
  return { categoria: "nao_classificado", natureza: "eventual", confianca: 0, fonte: "nenhuma" };
}

/** Aprende a partir de uma correção: o estabelecimento normalizado passa a mapear para a categoria. */
export function aprenderRegra(db: Db, usuarioId: string, estabelecimentoNorm: string, categoria: string, natureza: Natureza): void {
  const padrao = estabelecimentoNorm.split(" ").slice(0, 2).join(" ").trim();
  if (padrao.length < 3) return;
  db.prepare(
    `INSERT INTO regra_classificacao (usuario_id, padrao_norm, categoria, natureza, fonte)
     VALUES (?, ?, ?, ?, 'usuario')
     ON CONFLICT (usuario_id, padrao_norm) DO UPDATE SET categoria = excluded.categoria, natureza = excluded.natureza`,
  ).run(usuarioId, padrao, categoria, natureza);
}
