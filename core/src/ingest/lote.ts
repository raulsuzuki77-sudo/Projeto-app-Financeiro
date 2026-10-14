import type { Db } from "../db/tipos";
import { alterarLancamento, excluirLancamento, obterLancamento, restaurarLancamento } from "./lancamentos";
import { definirEventoDoLancamento } from "../eventos/eventos";

/** Limite de lançamentos por ação em lote: evita uma seleção descuidada de alterar o banco inteiro de uma vez. */
export const MAXIMO_EM_LOTE = 1000;

function validar(db: Db, usuarioId: string, ids: number[]): number[] {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) throw new Error("Nenhum lançamento selecionado.");
  if (unicos.length > MAXIMO_EM_LOTE) throw new Error(`Selecione no máximo ${MAXIMO_EM_LOTE} lançamentos por vez.`);
  for (const id of unicos) {
    const l = obterLancamento(db, id);
    if (!l || l.usuario_id !== usuarioId) throw new Error("Há lançamento selecionado que não existe mais.");
  }
  return unicos;
}

/** Exclui (cancela) vários lançamentos de uma vez, em uma transação. Devolve os identificadores alterados, para desfazer. */
export function excluirVarios(db: Db, usuarioId: string, ids: number[]): number[] {
  const lista = validar(db, usuarioId, ids).filter((id) => obterLancamento(db, id)!.status !== "cancelado");
  db.transaction(() => {
    for (const id of lista) excluirLancamento(db, id, usuarioId);
  })();
  return lista;
}

/** Desfaz `excluirVarios`: os lançamentos voltam (os que estavam sem categoria voltam pendentes). */
export function restaurarVarios(db: Db, usuarioId: string, ids: number[]): number {
  const lista = validar(db, usuarioId, ids);
  db.transaction(() => {
    for (const id of lista) restaurarLancamento(db, id, usuarioId);
  })();
  return lista.length;
}

/**
 * Define a categoria de vários lançamentos de uma vez (cada um fica confirmado; a regra de cada estabelecimento é aprendida).
 * A natureza e o tipo acompanham a categoria, como ao classificar um a um.
 */
export function classificarVarios(db: Db, usuarioId: string, ids: number[], categoria: string): number {
  if (!categoria.trim() || categoria === "nao_classificado") throw new Error("Escolha uma categoria.");
  const lista = validar(db, usuarioId, ids).filter((id) => obterLancamento(db, id)!.status !== "cancelado");
  db.transaction(() => {
    for (const id of lista) alterarLancamento(db, id, usuarioId, { categoria, status: "confirmado" });
  })();
  return lista.length;
}

/** Confirma vários lançamentos pendentes que já têm categoria. Os sem categoria são ignorados. Devolve quantos foram confirmados. */
export function confirmarVarios(db: Db, usuarioId: string, ids: number[]): number {
  const lista = validar(db, usuarioId, ids);
  let n = 0;
  db.transaction(() => {
    for (const id of lista) {
      const l = obterLancamento(db, id)!;
      if (l.status !== "pendente" || l.categoria === "nao_classificado") continue;
      alterarLancamento(db, id, usuarioId, { status: "confirmado" });
      n++;
    }
  })();
  return n;
}

/** Vincula vários lançamentos (só despesas) a um evento, ou, com `null`, tira todos de seus eventos. Devolve quantos mudaram. */
export function definirEventoVarios(db: Db, usuarioId: string, ids: number[], eventoId: number | null): number {
  const lista = validar(db, usuarioId, ids);
  let n = 0;
  db.transaction(() => {
    for (const id of lista) {
      const l = obterLancamento(db, id)!;
      if (l.status === "cancelado") continue;
      if (eventoId !== null && l.tipo !== "despesa") continue;
      if ((l.evento_id ?? null) === eventoId) continue;
      definirEventoDoLancamento(db, usuarioId, id, eventoId);
      n++;
    }
  })();
  return n;
}
