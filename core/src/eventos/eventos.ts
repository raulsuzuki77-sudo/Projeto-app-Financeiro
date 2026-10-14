import { chaveEstabelecimento } from "../classification/classificador";
import type { Db } from "../db/tipos";
import { detectarRecorrentes } from "../recorrencias/recorrencias";
import { dataValida } from "../parsing/tempo";

export const TIPOS_EVENTO = ["ferias", "viagem_servico", "outro"] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export const ROTULO_TIPO_EVENTO: Record<TipoEvento, string> = { ferias: "Férias", viagem_servico: "Viagem a serviço", outro: "Outro evento" };

export interface Evento {
  id: number;
  nome: string;
  tipo: TipoEvento;
  data_inicio: string;
  data_fim: string;
}

export interface NovoEvento {
  nome: string;
  tipo: TipoEvento;
  data_inicio: string;
  data_fim: string;
  /** Vincula ao evento os gastos já existentes no período (padrão). Os gastos importados depois também são vinculados. */
  vincular?: boolean;
}

/**
 * Categorias de gasto que, dentro do período, são presumidas do evento (alta probabilidade): hospedagem e passagens, comer e beber
 * fora, passeios e deslocamentos. Mercado, compras, saúde e o que não está nesta lista NÃO entram sozinhos: aparecem numa lista para
 * o usuário conferir. Contas da casa, receitas, assinaturas, parcelas, aportes e transferências nunca são sugeridos.
 */
export const CATEGORIAS_DE_VIAGEM = ["viagem", "alimentacao_restaurante", "alimentacao_delivery", "lazer_bar", "bebidas", "lazer_passeios", "lazer_jogos", "transporte_aplicativo_pedagio"] as const;

/** Gastos da rotina da casa e compromissos que se repetem: nunca sugeridos para um evento (salario e receitas nem entram: so despesas). */
const CATEGORIAS_DA_CASA = ["moradia", "moradia_contas", "moradia_manutencao", "saude_plano", "seguros", "contribuicoes", "impostos_taxas", "financeiro_custos", "clube_pontos", "conhecimento_ia", "educacao", "servicos_domesticos", "saude_academia"];

const MARCAS_VIAGEM = CATEGORIAS_DE_VIAGEM.map(() => "?").join(",");
const MARCAS_CASA = CATEGORIAS_DA_CASA.map(() => "?").join(",");

/**
 * Naturezas que NÃO são presumidas do evento: contas que se repetem todo mês (aluguel, assinaturas), parcelas de compras antigas,
 * aportes, transferências e estornos. Os demais gastos do período têm alta probabilidade de pertencer ao evento; o usuário ajusta caso a caso.
 */
const NATUREZAS_FORA = ["fixo", "assinatura", "parcelado", "investimento", "transferencia", "divida_juros_tarifas", "estorno"];

const MARCAS = NATUREZAS_FORA.map(() => "?").join(",");

function validarData(d: string, campo: string): void {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !dataValida(+m[1]!, +m[2]!, +m[3]!)) throw new Error(`${campo} inválida.`);
}

function validar(e: Pick<NovoEvento, "nome" | "tipo" | "data_inicio" | "data_fim">): void {
  if (!e.nome.trim() || e.nome.trim().length > 80) throw new Error("O nome do evento deve ter de 1 a 80 caracteres.");
  if (!(TIPOS_EVENTO as readonly string[]).includes(e.tipo)) throw new Error("Tipo de evento inválido.");
  validarData(e.data_inicio, "Data de início");
  validarData(e.data_fim, "Data de término");
  if (e.data_fim < e.data_inicio) throw new Error("A data de término não pode ser anterior à de início.");
  const dias = (Date.parse(e.data_fim) - Date.parse(e.data_inicio)) / 86_400_000;
  if (dias > 120) throw new Error("O período do evento não pode passar de 120 dias.");
}

/** Evento que cobre a data (o de início mais recente, se houver sobreposição). Usado ao registrar lançamentos. */
export function eventoDaData(db: Db, usuarioId: string, dataLocal: string): number | null {
  const r = db.prepare("SELECT id FROM evento WHERE usuario_id = ? AND ? BETWEEN data_inicio AND data_fim ORDER BY data_inicio DESC, id DESC LIMIT 1").get(usuarioId, dataLocal) as { id: number } | undefined;
  return r?.id ?? null;
}

/** O lançamento (tipo, natureza e categoria finais) pode ser presumido de um evento pelo período? */
export function elegivelParaEvento(tipo: string, natureza: string, categoria: string): boolean {
  return tipo === "despesa" && !NATUREZAS_FORA.includes(natureza) && (CATEGORIAS_DE_VIAGEM as readonly string[]).includes(categoria);
}

/** Vincula ao evento os gastos de alta probabilidade do período que ainda não têm evento. Devolve quantos foram vinculados. */
export function vincularPeriodo(db: Db, usuarioId: string, eventoId: number): number {
  const e = db.prepare("SELECT data_inicio, data_fim FROM evento WHERE id = ? AND usuario_id = ?").get(eventoId, usuarioId) as { data_inicio: string; data_fim: string } | undefined;
  if (!e) throw new Error("Evento não encontrado.");
  return db
    .prepare(`UPDATE lancamento SET evento_id = ? WHERE usuario_id = ? AND evento_id IS NULL AND tipo = 'despesa' AND status != 'cancelado' AND data_local BETWEEN ? AND ? AND natureza NOT IN (${MARCAS}) AND categoria IN (${MARCAS_VIAGEM})`)
    .run(eventoId, usuarioId, e.data_inicio, e.data_fim, ...NATUREZAS_FORA, ...CATEGORIAS_DE_VIAGEM).changes;
}

export function criarEvento(db: Db, usuarioId: string, e: NovoEvento): { id: number; vinculados: number } {
  validar(e);
  const id = Number(
    db.prepare("INSERT INTO evento (usuario_id, nome, tipo, data_inicio, data_fim, criado_em) VALUES (?,?,?,?,?,?)").run(usuarioId, e.nome.trim(), e.tipo, e.data_inicio, e.data_fim, new Date().toISOString()).lastInsertRowid,
  );
  return { id, vinculados: e.vincular === false ? 0 : vincularPeriodo(db, usuarioId, id) };
}

export function atualizarEvento(db: Db, usuarioId: string, id: number, p: Partial<Omit<NovoEvento, "vincular">>): { vinculados: number } {
  const atual = db.prepare("SELECT id, nome, tipo, data_inicio, data_fim FROM evento WHERE id = ? AND usuario_id = ?").get(id, usuarioId) as Evento | undefined;
  if (!atual) throw new Error("Evento não encontrado.");
  const novo = { nome: p.nome ?? atual.nome, tipo: p.tipo ?? atual.tipo, data_inicio: p.data_inicio ?? atual.data_inicio, data_fim: p.data_fim ?? atual.data_fim };
  validar(novo);
  db.prepare("UPDATE evento SET nome = ?, tipo = ?, data_inicio = ?, data_fim = ? WHERE id = ? AND usuario_id = ?").run(novo.nome.trim(), novo.tipo, novo.data_inicio, novo.data_fim, id, usuarioId);
  // Só reavalia o vínculo quando o período muda: renomear não deve religar gastos que o usuário tirou do evento.
  const periodoMudou = novo.data_inicio !== atual.data_inicio || novo.data_fim !== atual.data_fim;
  return { vinculados: periodoMudou ? vincularPeriodo(db, usuarioId, id) : 0 };
}

/** Remove o evento; os lançamentos permanecem, apenas sem o vínculo. */
export function removerEvento(db: Db, usuarioId: string, id: number): boolean {
  db.prepare("UPDATE lancamento SET evento_id = NULL WHERE usuario_id = ? AND evento_id = ?").run(usuarioId, id);
  return db.prepare("DELETE FROM evento WHERE id = ? AND usuario_id = ?").run(id, usuarioId).changes > 0;
}

/** Vincula (ou, com null, desvincula) um lançamento a um evento, à mão. */
export function definirEventoDoLancamento(db: Db, usuarioId: string, lancamentoId: number, eventoId: number | null): void {
  if (eventoId !== null && !db.prepare("SELECT 1 FROM evento WHERE id = ? AND usuario_id = ?").get(eventoId, usuarioId)) throw new Error("Evento não encontrado.");
  const r = db.prepare("UPDATE lancamento SET evento_id = ?, atualizado_em = ? WHERE id = ? AND usuario_id = ?").run(eventoId, new Date().toISOString(), lancamentoId, usuarioId);
  if (r.changes === 0) throw new Error("Lançamento não encontrado.");
}

export interface ResumoEvento extends Evento {
  total_centavos: number;
  quantidade: number;
  /** Quanto do total ainda está pendente de revisão (valores podem mudar de categoria). */
  pendentes: number;
}

export function listarEventos(db: Db, usuarioId: string): ResumoEvento[] {
  return db
    .prepare(
      `SELECT e.id, e.nome, e.tipo, e.data_inicio, e.data_fim,
              COALESCE(SUM(l.valor_centavos), 0) total_centavos, COUNT(l.id) quantidade,
              COALESCE(SUM(CASE WHEN l.status = 'pendente' THEN 1 ELSE 0 END), 0) pendentes
       FROM evento e LEFT JOIN lancamento l ON l.evento_id = e.id AND l.status != 'cancelado' AND l.tipo = 'despesa'
       WHERE e.usuario_id = ? GROUP BY e.id ORDER BY e.data_inicio DESC, e.id DESC`,
    )
    .all(usuarioId) as ResumoEvento[];
}

/** Gastos do evento vistos pelo gênero (categoria): a mesma despesa conta no evento e na categoria, sem duplicar totais de cada visão. */
export function detalheEvento(db: Db, usuarioId: string, id: number) {
  const evento = db.prepare("SELECT id, nome, tipo, data_inicio, data_fim FROM evento WHERE id = ? AND usuario_id = ?").get(id, usuarioId) as Evento | undefined;
  if (!evento) throw new Error("Evento não encontrado.");
  const por_categoria = db
    .prepare("SELECT categoria, SUM(valor_centavos) total_centavos, COUNT(*) quantidade FROM lancamento WHERE usuario_id = ? AND evento_id = ? AND status != 'cancelado' AND tipo = 'despesa' GROUP BY categoria ORDER BY total_centavos DESC")
    .all(usuarioId, id) as { categoria: string; total_centavos: number; quantidade: number }[];
  const lancamentos = db.prepare("SELECT * FROM lancamento WHERE usuario_id = ? AND evento_id = ? AND status != 'cancelado' ORDER BY data_local, id").all(usuarioId, id);
  const total_centavos = por_categoria.reduce((s, c) => s + c.total_centavos, 0);
  return { evento, total_centavos, por_categoria, lancamentos };
}

/**
 * Gastos que provavelmente são de uma viagem mas ainda não têm evento: categoria de viagem e hospedagem sem vínculo.
 * A interface usa isto para perguntar "qual foi o período da viagem?".
 */
export function viagensSemEvento(db: Db, usuarioId: string): { id: number; descricao: string; data_local: string; valor_centavos: number }[] {
  return db
    .prepare("SELECT id, descricao, data_local, valor_centavos FROM lancamento WHERE usuario_id = ? AND categoria = 'viagem' AND evento_id IS NULL AND status != 'cancelado' AND tipo = 'despesa' ORDER BY data_local DESC LIMIT 50")
    .all(usuarioId) as { id: number; descricao: string; data_local: string; valor_centavos: number }[];
}

export function nomeSugeridoDoEvento(tipo: TipoEvento, inicio: string): string {
  const mes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][Number(inicio.slice(5, 7)) - 1] ?? "";
  return `${ROTULO_TIPO_EVENTO[tipo]} de ${mes} de ${inicio.slice(0, 4)}`;
}



export interface GastoCandidato {
  id: number;
  descricao: string;
  data_local: string;
  categoria: string;
  valor_centavos: number;
  /** Dias de distância até o período do evento (0 = dentro do período). */
  distancia_dias: number;
  /** Já pertence a outro evento. */
  evento_id: number | null;
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

/**
 * Gastos do período que NÃO foram vinculados sozinhos (categorias de mercado, compras, saúde etc.) e não são da rotina da casa
 * nem de séries recorrentes: o usuário confere e inclui os que forem do evento. Entradas, contas da casa, assinaturas e parcelas não aparecem.
 */
export function sugestoesDoPeriodo(db: Db, usuarioId: string, eventoId: number): GastoCandidato[] {
  const e = db.prepare("SELECT data_inicio, data_fim FROM evento WHERE id = ? AND usuario_id = ?").get(eventoId, usuarioId) as { data_inicio: string; data_fim: string } | undefined;
  if (!e) throw new Error("Evento não encontrado.");
  const recorrentes = new Set(detectarRecorrentes(db, usuarioId, e.data_fim).map((r) => `${r.tipo}|${r.chave}`));
  const rows = db
    .prepare(
      `SELECT id, descricao, estabelecimento_norm, data_local, categoria, valor_centavos, evento_id FROM lancamento
       WHERE usuario_id = ? AND tipo = 'despesa' AND status != 'cancelado' AND evento_id IS NULL AND data_local BETWEEN ? AND ?
         AND natureza NOT IN (${MARCAS}) AND categoria NOT IN (${MARCAS_VIAGEM}) AND categoria NOT IN (${MARCAS_CASA}) AND forma_pagamento IS NOT 'boleto'
       ORDER BY valor_centavos DESC`,
    )
    .all(usuarioId, e.data_inicio, e.data_fim, ...NATUREZAS_FORA, ...CATEGORIAS_DE_VIAGEM, ...CATEGORIAS_DA_CASA) as (GastoCandidato & { estabelecimento_norm: string })[];
  return rows
    .filter((r) => !recorrentes.has(`despesa|${chaveEstabelecimento(r.estabelecimento_norm)}`))
    .map(({ estabelecimento_norm: _e, ...r }) => ({ ...r, distancia_dias: 0 }));
}

/**
 * Gastos que o usuário pode vincular a mão ao evento, em QUALQUER data (reserva de hotel feita meses antes, passagem comprada
 * com antecedência). Primeiro os de viagem ainda sem evento, depois os mais próximos do período; aceita busca por descrição.
 */
export function candidatosParaEvento(db: Db, usuarioId: string, eventoId: number, opcoes: { busca?: string; limite?: number } = {}): GastoCandidato[] {
  const e = db.prepare("SELECT data_inicio, data_fim FROM evento WHERE id = ? AND usuario_id = ?").get(eventoId, usuarioId) as { data_inicio: string; data_fim: string } | undefined;
  if (!e) throw new Error("Evento não encontrado.");
  const busca = opcoes.busca?.trim() ? `%${opcoes.busca.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()}%` : null;
  const rows = db
    .prepare(
      `SELECT id, descricao, data_local, categoria, valor_centavos, evento_id FROM lancamento
       WHERE usuario_id = ? AND tipo = 'despesa' AND status != 'cancelado' AND (evento_id IS NULL OR evento_id != ?)
         AND natureza NOT IN ('investimento','transferencia','estorno') ${busca ? "AND estabelecimento_norm LIKE ?" : ""}
       ORDER BY data_local DESC LIMIT 2000`,
    )
    .all(...(busca ? [usuarioId, eventoId, busca] : [usuarioId, eventoId])) as Omit<GastoCandidato, "distancia_dias">[];
  const dist = (d: string) => (d < e.data_inicio ? diasEntre(e.data_inicio, d) : d > e.data_fim ? diasEntre(d, e.data_fim) : 0);
  const peso = (r: Omit<GastoCandidato, "distancia_dias">) => (r.categoria === "viagem" && r.evento_id === null ? 0 : 1);
  return rows
    .map((r) => ({ ...r, distancia_dias: dist(r.data_local) }))
    .sort((a, b) => peso(a) - peso(b) || a.distancia_dias - b.distancia_dias || b.valor_centavos - a.valor_centavos)
    .slice(0, Math.min(Math.max(opcoes.limite ?? 60, 1), 200));
}

/** Vincula vários lançamentos ao evento, em qualquer data. Devolve quantos foram alterados. */
export function vincularLancamentos(db: Db, usuarioId: string, eventoId: number, ids: number[]): number {
  if (!db.prepare("SELECT 1 FROM evento WHERE id = ? AND usuario_id = ?").get(eventoId, usuarioId)) throw new Error("Evento não encontrado.");
  let n = 0;
  const tx = db.transaction(() => {
    for (const id of ids) n += db.prepare("UPDATE lancamento SET evento_id = ?, atualizado_em = ? WHERE id = ? AND usuario_id = ? AND tipo = 'despesa'").run(eventoId, new Date().toISOString(), id, usuarioId).changes;
  });
  tx();
  return n;
}
