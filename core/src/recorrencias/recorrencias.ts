import type { Db } from "../db/tipos";
import { naturezaPadraoDaCategoria } from "../classification/categorias";
import { classificar } from "../classification/classificador";
import { FORMAS_PAGAMENTO, NATUREZAS, type FormaPagamento, type Natureza } from "../domain/types";
import { registrarLancamento } from "../ingest/lancamentos";
import { dataValida } from "../parsing/tempo";

export interface Recorrencia {
  id: number;
  descricao: string;
  tipo: "despesa" | "receita" | "investimento";
  valor_centavos: number;
  categoria: string;
  natureza: Natureza;
  dia_mes: number;
  forma_pagamento: FormaPagamento | null;
  cartao_id: number | null;
  inicio_mes: string;
  ativa: number;
}

export interface NovaRecorrencia {
  descricao: string;
  valor_centavos: number;
  dia_mes: number;
  tipo?: Recorrencia["tipo"];
  categoria?: string;
  natureza?: Natureza;
  forma_pagamento?: FormaPagamento | null;
  cartao_id?: number | null;
  /** Primeiro mês (AAAA-MM) em que a recorrência vale. Padrão: o mês de `hoje`. */
  inicio_mes?: string;
}

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export function ultimoDiaDoMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

function proximoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

function validar(r: Required<Pick<NovaRecorrencia, "descricao" | "valor_centavos" | "dia_mes">> & Partial<NovaRecorrencia>): void {
  if (!r.descricao.trim() || r.descricao.trim().length > 120) throw new Error("A descrição deve ter de 1 a 120 caracteres.");
  if (!Number.isInteger(r.valor_centavos) || r.valor_centavos <= 0) throw new Error("O valor deve ser maior que zero.");
  if (!Number.isInteger(r.dia_mes) || r.dia_mes < 1 || r.dia_mes > 31) throw new Error("O dia do mês deve estar entre 1 e 31.");
  if (r.tipo !== undefined && !["despesa", "receita", "investimento"].includes(r.tipo)) throw new Error("Tipo inválido.");
  if (r.natureza !== undefined && !(NATUREZAS as readonly string[]).includes(r.natureza)) throw new Error("Natureza inválida.");
  if (r.forma_pagamento != null && !(FORMAS_PAGAMENTO as readonly string[]).includes(r.forma_pagamento)) throw new Error("Forma de pagamento inválida.");
  if (r.inicio_mes !== undefined && !MES.test(r.inicio_mes)) throw new Error("Mês inicial inválido (use AAAA-MM).");
}

export function criarRecorrencia(db: Db, usuarioId: string, r: NovaRecorrencia, hojeLocal: string): number {
  validar(r);
  const tipo = r.tipo ?? "despesa";
  const palpite = r.categoria ? null : classificar(db, usuarioId, r.descricao, tipo);
  const categoria = r.categoria ?? (palpite && palpite.fonte !== "nenhuma" ? palpite.categoria : "nao_classificado");
  const natureza = r.natureza ?? naturezaPadraoDaCategoria(categoria) ?? "fixo";
  if (r.cartao_id != null && !db.prepare("SELECT 1 FROM cartao WHERE id = ? AND usuario_id = ?").get(r.cartao_id, usuarioId)) throw new Error("Cartão inexistente.");
  const info = db
    .prepare(
      `INSERT INTO recorrencia (usuario_id, descricao, tipo, valor_centavos, categoria, natureza, dia_mes, forma_pagamento, cartao_id, inicio_mes, ativa, criada_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
    )
    .run(usuarioId, r.descricao.trim(), tipo, r.valor_centavos, categoria, natureza, r.dia_mes, r.forma_pagamento ?? null, r.cartao_id ?? null, r.inicio_mes ?? hojeLocal.slice(0, 7), new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function listarRecorrencias(db: Db, usuarioId: string): Recorrencia[] {
  return db.prepare("SELECT id, descricao, tipo, valor_centavos, categoria, natureza, dia_mes, forma_pagamento, cartao_id, inicio_mes, ativa FROM recorrencia WHERE usuario_id = ? ORDER BY dia_mes, id").all(usuarioId) as Recorrencia[];
}

export function atualizarRecorrencia(db: Db, usuarioId: string, id: number, p: Partial<Pick<NovaRecorrencia, "descricao" | "valor_centavos" | "dia_mes" | "categoria" | "natureza">> & { ativa?: boolean }): void {
  const atual = listarRecorrencias(db, usuarioId).find((x) => x.id === id);
  if (!atual) throw new Error("Recorrência não encontrada.");
  const novo = { descricao: p.descricao ?? atual.descricao, valor_centavos: p.valor_centavos ?? atual.valor_centavos, dia_mes: p.dia_mes ?? atual.dia_mes, categoria: p.categoria ?? atual.categoria, natureza: p.natureza ?? atual.natureza };
  validar(novo);
  db.prepare("UPDATE recorrencia SET descricao = ?, valor_centavos = ?, dia_mes = ?, categoria = ?, natureza = ?, ativa = ? WHERE id = ? AND usuario_id = ?").run(
    novo.descricao.trim(), novo.valor_centavos, novo.dia_mes, novo.categoria, novo.natureza, p.ativa === undefined ? atual.ativa : p.ativa ? 1 : 0, id, usuarioId,
  );
}

/** Remove a regra. Os lançamentos já gerados permanecem (são histórico). */
export function removerRecorrencia(db: Db, usuarioId: string, id: number): boolean {
  return db.prepare("DELETE FROM recorrencia WHERE id = ? AND usuario_id = ?").run(id, usuarioId).changes > 0;
}

/**
 * Gera os lançamentos devidos das recorrências ativas, de `inicio_mes` até o mês de `hojeLocal` (no máximo 24 meses para trás).
 * Em meses curtos, o dia é ajustado ao último dia (dia 31 em fevereiro vira 28 ou 29). Só gera datas que já chegaram.
 * Idempotente: a referência `rec:<id>:<AAAA-MM>` impede duplicar, e um lançamento apagado pelo usuário não é recriado.
 */
export function gerarRecorrencias(db: Db, usuarioId: string, hojeLocal: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hojeLocal)) throw new Error("data de referência inválida");
  const mesHoje = hojeLocal.slice(0, 7);
  const [aH, mH] = mesHoje.split("-").map(Number) as [number, number];
  const limite = (() => { const t = aH * 12 + (mH - 1) - 24; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; })();
  let criados = 0;
  for (const r of listarRecorrencias(db, usuarioId).filter((x) => x.ativa === 1)) {
    for (let mes = r.inicio_mes < limite ? limite : r.inicio_mes; mes <= mesHoje; mes = proximoMes(mes)) {
      const dia = Math.min(r.dia_mes, ultimoDiaDoMes(mes));
      const data = `${mes}-${String(dia).padStart(2, "0")}`;
      if (data > hojeLocal) break;
      const [a, m, d] = data.split("-").map(Number) as [number, number, number];
      if (!dataValida(a, m, d)) continue;
      const res = registrarLancamento(db, {
        usuario_id: usuarioId,
        tipo: r.tipo,
        valor_centavos: r.valor_centavos,
        descricao: r.descricao,
        categoria: r.categoria,
        natureza: r.natureza,
        forma_pagamento: r.forma_pagamento,
        cartao_id: r.cartao_id,
        data_local: data,
        hora_local: null,
        precisao_horario: "desconhecido",
        origem: "recorrente",
        referencia: `rec:${r.id}:${mes}`,
      });
      if (res.resultado === "criado") criados++;
    }
  }
  return criados;
}
