import type { Db } from "../db/tipos";
import { EXPOSICOES, type Exposicao } from "./dicionario";

/**
 * Cadastro do ativo: o que o usuario informa e o extrato nao traz (preco medio de ativos depositados, especie, setor,
 * exposicao, marca "Meta"). Persiste entre extratos: a chave e o codigo do ativo (ou o nome, sem codigo).
 */
export interface CadastroAtivo {
  chave: string;
  nome: string;
  especie: string | null;
  setor: string | null;
  exposicao: Exposicao | null;
  /** Na moeda do ativo, por unidade (nao centavos). null = nao informado. */
  preco_medio: number | null;
  meta: boolean;
  atualizado_em: string;
}

export interface AlteracaoCadastro {
  nome?: string;
  especie?: string | null;
  setor?: string | null;
  exposicao?: Exposicao | null;
  preco_medio?: number | null;
  meta?: boolean;
}

interface LinhaCadastro {
  chave: string;
  nome: string;
  especie: string | null;
  setor: string | null;
  exposicao: string | null;
  preco_medio: number | null;
  meta: number;
  atualizado_em: string;
}

const paraCadastro = (r: LinhaCadastro): CadastroAtivo => ({ ...r, exposicao: (r.exposicao as Exposicao | null) ?? null, meta: r.meta === 1 });

export function listarCadastroAtivos(db: Db, usuarioId: string): CadastroAtivo[] {
  return (db.prepare("SELECT chave, nome, especie, setor, exposicao, preco_medio, meta, atualizado_em FROM ativo_cadastro WHERE usuario_id = ? ORDER BY chave").all(usuarioId) as LinhaCadastro[]).map(paraCadastro);
}

export function mapaCadastro(db: Db, usuarioId: string): Map<string, CadastroAtivo> {
  return new Map(listarCadastroAtivos(db, usuarioId).map((c) => [c.chave, c]));
}

function texto(v: string | null | undefined, rotulo: string): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim().replace(/\s+/g, " ");
  if (t === "") return null;
  if (t.length > 60) throw new Error(`${rotulo} longo demais (máximo 60 caracteres)`);
  return t;
}

/**
 * Cria ou atualiza o cadastro de um ativo: so os campos presentes em `alt` mudam (null limpa o campo). Sem nenhum dado,
 * a linha some. Devolve o cadastro resultante, ou null se ficou vazio.
 */
export function salvarCadastroAtivo(db: Db, usuarioId: string, chave: string, alt: AlteracaoCadastro, agora = new Date()): CadastroAtivo | null {
  const k = chave.trim();
  if (k === "" || k.length > 160) throw new Error("chave do ativo inválida");
  const atual = db.prepare("SELECT chave, nome, especie, setor, exposicao, preco_medio, meta, atualizado_em FROM ativo_cadastro WHERE usuario_id = ? AND chave = ?").get(usuarioId, k) as LinhaCadastro | undefined;
  const base = atual ? paraCadastro(atual) : { chave: k, nome: "", especie: null, setor: null, exposicao: null, preco_medio: null, meta: false, atualizado_em: "" };
  const novo: CadastroAtivo = { ...base };
  if (alt.nome !== undefined) novo.nome = texto(alt.nome, "nome") ?? "";
  if (alt.especie !== undefined) novo.especie = texto(alt.especie, "espécie");
  if (alt.setor !== undefined) novo.setor = texto(alt.setor, "setor");
  if (alt.exposicao !== undefined) {
    if (alt.exposicao !== null && !EXPOSICOES.includes(alt.exposicao)) throw new Error("exposição inválida (use nacional ou estrangeira)");
    novo.exposicao = alt.exposicao;
  }
  if (alt.preco_medio !== undefined) {
    if (alt.preco_medio !== null && (!Number.isFinite(alt.preco_medio) || alt.preco_medio <= 0 || alt.preco_medio >= 1e9)) throw new Error("preço médio inválido (informe um valor maior que zero)");
    novo.preco_medio = alt.preco_medio;
  }
  if (alt.meta !== undefined) novo.meta = alt.meta;
  novo.atualizado_em = agora.toISOString();
  const vazio = novo.especie === null && novo.setor === null && novo.exposicao === null && novo.preco_medio === null && !novo.meta;
  if (vazio) {
    db.prepare("DELETE FROM ativo_cadastro WHERE usuario_id = ? AND chave = ?").run(usuarioId, k);
    return null;
  }
  db.prepare(
    `INSERT INTO ativo_cadastro (usuario_id, chave, nome, especie, setor, exposicao, preco_medio, meta, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT (usuario_id, chave) DO UPDATE SET nome = excluded.nome, especie = excluded.especie, setor = excluded.setor, exposicao = excluded.exposicao, preco_medio = excluded.preco_medio, meta = excluded.meta, atualizado_em = excluded.atualizado_em`,
  ).run(usuarioId, k, novo.nome, novo.especie, novo.setor, novo.exposicao, novo.preco_medio, novo.meta ? 1 : 0, novo.atualizado_em);
  return novo;
}

export function removerCadastroAtivo(db: Db, usuarioId: string, chave: string): boolean {
  return db.prepare("DELETE FROM ativo_cadastro WHERE usuario_id = ? AND chave = ?").run(usuarioId, chave).changes > 0;
}
