import type { Db } from "../db/tipos";

export interface ResumoMensal {
  mes: string;
  receitas_centavos: number;
  despesas_centavos: number;
  investimentos_centavos: number;
  saldo_centavos: number;
  taxa_poupanca: number | null;
  pendentes: number;
  por_categoria: { categoria: string; total_centavos: number }[];
  por_natureza: { natureza: string; total_centavos: number }[];
}

// Transferencias (ex.: pagamento de fatura) nunca entram em despesa: evita contar a mesma compra duas vezes.
// Lancamentos pendentes entram nos totais, mas sao contados em "pendentes" para o usuario revisar.
export function resumoMensal(db: Db, usuarioId: string, mes: string): ResumoMensal {
  const base = "usuario_id = ? AND status != 'cancelado' AND substr(data_local,1,7) = ?";
  const soma = (tipo: string) =>
    (db.prepare(`SELECT COALESCE(SUM(valor_centavos),0) t FROM lancamento WHERE ${base} AND tipo = ?`).get(usuarioId, mes, tipo) as { t: number }).t;
  const receitas = soma("receita");
  const despesas = soma("despesa");
  const investimentos = soma("investimento");
  const pendentes = (db.prepare(`SELECT COUNT(*) c FROM lancamento WHERE ${base} AND status = 'pendente'`).get(usuarioId, mes) as { c: number }).c;
  const por_categoria = db
    .prepare(`SELECT categoria, SUM(valor_centavos) total_centavos FROM lancamento WHERE ${base} AND tipo = 'despesa' GROUP BY categoria ORDER BY total_centavos DESC`)
    .all(usuarioId, mes) as ResumoMensal["por_categoria"];
  const por_natureza = db
    .prepare(`SELECT natureza, SUM(valor_centavos) total_centavos FROM lancamento WHERE ${base} AND tipo = 'despesa' GROUP BY natureza ORDER BY total_centavos DESC`)
    .all(usuarioId, mes) as ResumoMensal["por_natureza"];
  return {
    mes,
    receitas_centavos: receitas,
    despesas_centavos: despesas,
    investimentos_centavos: investimentos,
    saldo_centavos: receitas - despesas - investimentos,
    taxa_poupanca: receitas > 0 ? (receitas - despesas) / receitas : null,
    pendentes,
    por_categoria,
    por_natureza,
  };
}

export interface CelulaMapaCalor {
  dia_semana: number; // 0 = domingo
  hora: number;
  total_centavos: number;
  quantidade: number;
}

/**
 * Mapa de calor dia da semana x hora. Exclui lancamentos de horario desconhecido
 * e os de horario "aproximado" so entram se incluirAproximados for verdadeiro.
 */
export function mapaCalor(db: Db, usuarioId: string, de: string, ate: string, incluirAproximados = true): { celulas: CelulaMapaCalor[]; excluidos_sem_horario: number } {
  const precisoes = incluirAproximados ? "('exato','aproximado')" : "('exato')";
  const celulas = db
    .prepare(
      `SELECT CAST(strftime('%w', data_local) AS INTEGER) dia_semana, hora_local hora,
              SUM(valor_centavos) total_centavos, COUNT(*) quantidade
       FROM lancamento
       WHERE usuario_id = ? AND tipo = 'despesa' AND status != 'cancelado'
         AND data_local BETWEEN ? AND ? AND precisao_horario IN ${precisoes} AND hora_local IS NOT NULL
       GROUP BY dia_semana, hora ORDER BY dia_semana, hora`,
    )
    .all(usuarioId, de, ate) as CelulaMapaCalor[];
  const excluidos = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM lancamento WHERE usuario_id = ? AND tipo = 'despesa' AND status != 'cancelado'
         AND data_local BETWEEN ? AND ? AND (hora_local IS NULL OR precisao_horario NOT IN ${precisoes})`,
      )
      .get(usuarioId, de, ate) as { c: number }
  ).c;
  return { celulas, excluidos_sem_horario: excluidos };
}

export function calendarioMensal(db: Db, usuarioId: string, mes: string): { data: string; total_centavos: number; quantidade: number }[] {
  return db
    .prepare(
      `SELECT data_local data, SUM(valor_centavos) total_centavos, COUNT(*) quantidade FROM lancamento
       WHERE usuario_id = ? AND tipo = 'despesa' AND status != 'cancelado' AND substr(data_local,1,7) = ?
       GROUP BY data_local ORDER BY data_local`,
    )
    .all(usuarioId, mes) as { data: string; total_centavos: number; quantidade: number }[];
}

export function listarLancamentos(db: Db, usuarioId: string, filtro: { mes?: string; status?: string }) {
  const cond = ["usuario_id = ?"];
  const args: (string | number)[] = [usuarioId];
  if (filtro.mes) { cond.push("substr(data_local,1,7) = ?"); args.push(filtro.mes); }
  if (filtro.status) { cond.push("status = ?"); args.push(filtro.status); }
  return db.prepare(`SELECT * FROM lancamento WHERE ${cond.join(" AND ")} ORDER BY data_local DESC, id DESC LIMIT 500`).all(...args);
}
