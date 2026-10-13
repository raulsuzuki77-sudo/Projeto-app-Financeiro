import type { Db } from "../db/tipos";
import { normalizar } from "../parsing/text";

export interface Cartao {
  id: number;
  apelido: string;
  apelido_norm: string;
  ultimos4: string | null;
  bandeira: string | null;
  dia_vencimento: number | null;
}

/**
 * Cadastra um cartao. Nunca armazena numero completo, validade ou CVV: somente apelido e os ultimos 4 digitos.
 * O apelido normalizado e o que as mensagens usam ("mercado 50 credito nomad").
 */
export function criarCartao(db: Db, usuarioId: string, c: { apelido: string; ultimos4?: string | null; bandeira?: string | null; dia_vencimento?: number | null }): number {
  const apelido = c.apelido.trim();
  const norm = normalizar(apelido);
  if (norm.length < 2 || norm.length > 30) throw new Error("apelido deve ter de 2 a 30 caracteres");
  if (/\s/.test(norm)) throw new Error("use um apelido de uma palavra (ex.: nomad, nubank)");
  if (c.ultimos4 && !/^\d{4}$/.test(c.ultimos4)) throw new Error("informe apenas os 4 ultimos digitos");
  if (c.dia_vencimento != null && (!Number.isInteger(c.dia_vencimento) || c.dia_vencimento < 1 || c.dia_vencimento > 31)) throw new Error("dia de vencimento invalido");
  const igual = db.prepare("SELECT 1 FROM cartao WHERE usuario_id = ? AND apelido_norm = ?").get(usuarioId, norm);
  if (igual) throw new Error("ja existe um cartao com esse apelido");
  const r = db
    .prepare("INSERT INTO cartao (usuario_id, apelido, apelido_norm, ultimos4, bandeira, dia_vencimento) VALUES (?,?,?,?,?,?)")
    .run(usuarioId, apelido, norm, c.ultimos4 ?? null, c.bandeira ?? null, c.dia_vencimento ?? null);
  return Number(r.lastInsertRowid);
}

export function listarCartoes(db: Db, usuarioId: string): Cartao[] {
  return db.prepare("SELECT id, apelido, apelido_norm, ultimos4, bandeira, dia_vencimento FROM cartao WHERE usuario_id = ? ORDER BY id").all(usuarioId) as Cartao[];
}

/** Remove o cartao somente se nao houver lancamentos vinculados (preserva a rastreabilidade). */
export function removerCartao(db: Db, usuarioId: string, id: number): boolean {
  const em_uso = db.prepare("SELECT 1 FROM lancamento WHERE usuario_id = ? AND cartao_id = ? LIMIT 1").get(usuarioId, id);
  if (em_uso) throw new Error("ha lancamentos neste cartao; nao e possivel remover");
  return db.prepare("DELETE FROM cartao WHERE id = ? AND usuario_id = ?").run(id, usuarioId).changes > 0;
}
