import type { Db } from "../db/tipos";
import type { Natureza, Tipo } from "../domain/types";
import { normalizar } from "../parsing/text";
import { naturezaPadraoDaCategoria } from "./categorias";
import { REGRAS_BASE } from "./regras-base";

export interface Classificacao {
  categoria: string;
  natureza: Natureza;
  confianca: number;
  fonte: "usuario" | "historico" | "base" | "similar" | "nenhuma";
}

const CONF_USUARIO = 0.95;
const CONF_HISTORICO = 0.9;
const CONF_BASE = 0.8;
const CONF_SIMILAR = 0.82;

const regexCache = new Map<string, RegExp>();
function contemTermo(descNorm: string, termo: string): boolean {
  let re = regexCache.get(termo);
  if (!re) {
    re = new RegExp(`(^|\\s)${termo.replace(/\s+/g, "\\s+")}(\\s|$)`);
    regexCache.set(termo, re);
  }
  return re.test(descNorm);
}

/** Prefixos de intermediadores de pagamento que antecedem o nome do estabelecimento ("IFD*", "PTY*", "MP*"...). */
const PREFIXOS = new Set(["ifd", "pty", "mp", "pag", "sumup", "iz", "zp", "ec", "pagseguro", "mercadopago", "picpay", "paypal", "stone", "cielo", "getnet", "rede"]);
const RUIDO = new Set(["br", "ltda", "sa", "me", "epp", "eireli", "com", "de", "da", "do", "das", "dos", "e", "lj", "loja"]);

/**
 * Chave estável do estabelecimento: tira prefixos de intermediadores, números, códigos de loja, cidade/UF no fim
 * e fica com as duas primeiras palavras relevantes. "DROGASIL 1473 GOIANIA" e "DROGASIL 2346 GOIANIA" -> "drogasil goiania".
 */
export function chaveEstabelecimento(descricao: string): string {
  const toks = normalizar(descricao).split(" ").filter(Boolean);
  const limpos = toks.filter((t) => !PREFIXOS.has(t) && !RUIDO.has(t) && !/\d/.test(t) && t.length > 1);
  return limpos.slice(0, 2).join(" ");
}

function tokensDe(chave: string): Set<string> {
  return new Set(chave.split(" ").filter((t) => t.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const t of a) if (b.has(t)) i++;
  return i / (a.size + b.size - i);
}

interface Hist {
  chave: string;
  categoria: string;
  natureza: Natureza;
}

/** Lançamentos já CONFIRMADOS pelo usuário com categoria real: base do aprendizado automático. */
function historicoConfirmado(db: Db, usuarioId: string, tipo: Tipo): Hist[] {
  const rows = db
    .prepare("SELECT estabelecimento_norm, categoria, natureza FROM lancamento WHERE usuario_id = ? AND tipo = ? AND status = 'confirmado' AND categoria != 'nao_classificado' ORDER BY id DESC LIMIT 4000")
    .all(usuarioId, tipo) as { estabelecimento_norm: string; categoria: string; natureza: Natureza }[];
  return rows.map((r) => ({ chave: chaveEstabelecimento(r.estabelecimento_norm), categoria: r.categoria, natureza: r.natureza })).filter((h) => h.chave);
}

function maisFrequente(itens: Hist[]): { categoria: string; natureza: Natureza; participacao: number } | null {
  if (!itens.length) return null;
  const cont = new Map<string, { n: number; natureza: Natureza }>();
  for (const h of itens) {
    const c = cont.get(h.categoria) ?? { n: 0, natureza: h.natureza };
    c.n++;
    cont.set(h.categoria, c);
  }
  const [categoria, v] = [...cont.entries()].sort((a, b) => b[1].n - a[1].n)[0]!;
  return { categoria, natureza: v.natureza, participacao: v.n / itens.length };
}

/**
 * Classificação em camadas, da mais para a menos confiável:
 *  1. regras que o usuário corrigiu explicitamente;
 *  2. histórico: o mesmo estabelecimento já confirmado antes (aprendizado automático, sem precisar corrigir);
 *  3. regras base (redes e termos conhecidos);
 *  4. estabelecimento parecido já confirmado (palavras em comum);
 *  5. sem correspondência: confiança 0, vai para revisão com sugestões.
 */
export function classificar(db: Db, usuarioId: string, descricao: string, tipo: Tipo): Classificacao {
  const desc = normalizar(descricao);
  const chave = chaveEstabelecimento(descricao);

  const regras = db
    .prepare("SELECT padrao_norm, categoria, natureza FROM regra_classificacao WHERE usuario_id = ? ORDER BY length(padrao_norm) DESC")
    .all(usuarioId) as { padrao_norm: string; categoria: string; natureza: Natureza }[];
  for (const r of regras) {
    if ((chave && r.padrao_norm === chave) || contemTermo(desc, r.padrao_norm)) return { categoria: r.categoria, natureza: r.natureza, confianca: CONF_USUARIO, fonte: "usuario" };
  }

  let hist: Hist[] = [];
  if (chave) {
    hist = historicoConfirmado(db, usuarioId, tipo);
    const mesmos = maisFrequente(hist.filter((h) => h.chave === chave));
    if (mesmos && mesmos.participacao >= 0.6) return { categoria: mesmos.categoria, natureza: mesmos.natureza, confianca: CONF_HISTORICO, fonte: "historico" };
  }

  for (const r of REGRAS_BASE) {
    if (r.termos.some((t) => contemTermo(desc, t))) return { categoria: r.categoria, natureza: r.natureza, confianca: CONF_BASE, fonte: "base" };
  }

  if (chave && hist.length) {
    const meus = tokensDe(chave);
    const parecidos = hist.filter((h) => jaccard(meus, tokensDe(h.chave)) >= 0.6);
    const p = maisFrequente(parecidos);
    if (p && p.participacao >= 0.8) return { categoria: p.categoria, natureza: p.natureza, confianca: CONF_SIMILAR, fonte: "similar" };
  }

  if (tipo === "receita") return { categoria: "receita_outras", natureza: "eventual", confianca: 0.6, fonte: "nenhuma" };
  if (tipo === "investimento") return { categoria: "investimento", natureza: "investimento", confianca: 0.85, fonte: "base" };
  if (tipo === "transferencia") return { categoria: "transferencia", natureza: "transferencia", confianca: 0.85, fonte: "base" };
  return { categoria: "nao_classificado", natureza: "eventual", confianca: 0, fonte: "nenhuma" };
}

export interface Sugestao {
  categoria: string;
  /** Por que esta categoria é sugerida (exibido ao usuário). */
  motivo: "regra" | "historico" | "parecido" | "mais_usada";
}

/**
 * Até `limite` categorias candidatas para o usuário escolher com um toque, da mais provável para a menos provável:
 * o palpite do classificador, as categorias já usadas para o mesmo estabelecimento (ou parecido) e as mais usadas nos últimos lançamentos.
 */
export function sugerirCategorias(db: Db, usuarioId: string, descricao: string, tipo: Tipo, limite = 3): Sugestao[] {
  const out: Sugestao[] = [];
  const add = (categoria: string, motivo: Sugestao["motivo"]) => {
    if (categoria && categoria !== "nao_classificado" && !out.some((s) => s.categoria === categoria)) out.push({ categoria, motivo });
  };
  const palpite = classificar(db, usuarioId, descricao, tipo);
  if (palpite.fonte !== "nenhuma") add(palpite.categoria, palpite.fonte === "historico" ? "historico" : palpite.fonte === "similar" ? "parecido" : "regra");

  const chave = chaveEstabelecimento(descricao);
  const hist = historicoConfirmado(db, usuarioId, tipo);
  if (chave) {
    const contagem = (itens: Hist[]) => {
      const c = new Map<string, number>();
      for (const h of itens) c.set(h.categoria, (c.get(h.categoria) ?? 0) + 1);
      return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([cat]) => cat);
    };
    for (const cat of contagem(hist.filter((h) => h.chave === chave))) add(cat, "historico");
    const meus = tokensDe(chave);
    for (const cat of contagem(hist.filter((h) => h.chave !== chave && jaccard(meus, tokensDe(h.chave)) >= 0.5))) add(cat, "parecido");
  }
  if (out.length < limite) {
    const c = new Map<string, number>();
    for (const h of hist.slice(0, 500)) c.set(h.categoria, (c.get(h.categoria) ?? 0) + 1);
    for (const [cat] of [...c.entries()].sort((a, b) => b[1] - a[1])) add(cat, "mais_usada");
  }
  return out.slice(0, limite);
}

/** Aprende a partir de uma correção explícita: o estabelecimento passa a mapear para a categoria. */
export function aprenderRegra(db: Db, usuarioId: string, estabelecimentoNorm: string, categoria: string, natureza: Natureza): void {
  const padrao = chaveEstabelecimento(estabelecimentoNorm);
  if (padrao.length < 3) return;
  db.prepare(
    `INSERT INTO regra_classificacao (usuario_id, padrao_norm, categoria, natureza, fonte)
     VALUES (?, ?, ?, ?, 'usuario')
     ON CONFLICT (usuario_id, padrao_norm) DO UPDATE SET categoria = excluded.categoria, natureza = excluded.natureza`,
  ).run(usuarioId, padrao, categoria, natureza);
}

export function naturezaPara(categoria: string, atual: Natureza): Natureza {
  if (atual === "parcelado") return atual;
  return naturezaPadraoDaCategoria(categoria) ?? atual;
}
