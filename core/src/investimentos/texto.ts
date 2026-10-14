import type { LinhaTexto } from "./tipos";

/** Minusculas e sem acentos (para comparar rotulos de extrato). */
export function sa(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Espacos normalizados: o pdf.js e o pdftotext separam colunas por um ou muitos espacos. */
export function colapsar(s: string): string {
  return s.replace(/[   \t]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokens(linhas: string[]): string[] {
  const t: string[] = [];
  for (const l of linhas) for (const x of l.split(" ")) if (x) t.push(x);
  return t;
}

export function textoDasLinhas(linhas: LinhaTexto[]): string[] {
  return linhas.map((l) => colapsar(l.texto)).filter((l) => l !== "");
}

const SO_TRACO = /^[-–—]$/;
export const ehTraco = (t: string): boolean => SO_TRACO.test(t);

// ---------- numeros no formato brasileiro (1.234,56) ----------
const RE_BR = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/;
// ---------- numeros no formato americano ($1,234.56 ou (1.53)) ----------
const RE_US = /^(-)?\$?(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;

function paraCentavos(inteiro: string, frac: string | undefined, negativo: boolean): number {
  const f = ((frac ?? "") + "00").slice(0, 2);
  const arredonda = frac !== undefined && frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0;
  const c = Number(inteiro) * 100 + Number(f) + arredonda;
  return negativo && c !== 0 ? -c : c;
}

export function centavosBR(tok: string): number | null {
  const m = RE_BR.exec(tok.replace(/^R\$/, ""));
  if (!m) return null;
  return paraCentavos(m[2]!.replace(/\./g, ""), m[3], !!m[1]);
}

export function numeroBR(tok: string): number | null {
  const m = RE_BR.exec(tok);
  if (!m) return null;
  const n = Number(`${m[2]!.replace(/\./g, "")}${m[3] ? "." + m[3] : ""}`);
  return Number.isFinite(n) ? (m[1] ? -n : n) : null;
}

/** "(1.53)", "$3,736.84", "-1.00" */
export function centavosUS(tok: string): number | null {
  let t = tok;
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  const m = RE_US.exec(t);
  if (!m) return null;
  return paraCentavos(m[3]!.replace(/,/g, ""), m[4], neg || !!m[1] || !!m[2]);
}

export function numeroUS(tok: string): number | null {
  let t = tok;
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  const m = RE_US.exec(t);
  if (!m) return null;
  const n = Number(`${m[3]!.replace(/,/g, "")}${m[4] ? "." + m[4] : ""}`);
  return Number.isFinite(n) ? (neg || m[1] || m[2] ? -n : n) : null;
}

/** dd/mm/aa ou dd/mm/aaaa -> AAAA-MM-DD (null se invalida). */
export function dataDMA(tok: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(tok);
  if (!m) return null;
  const ano = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return dataIso(ano, Number(m[2]), Number(m[1]));
}

export function dataIso(ano: number, mes: number, dia: number): string | null {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Ultimos 4 caracteres alfanumericos de um identificador de conta (nunca o numero completo). */
export function ultimos4(id: string): string {
  return id.replace(/[^0-9A-Za-z]/g, "").slice(-4);
}

/** Primeiro indice em que a sequencia de palavras (sem acento, minuscula) aparece. */
export function acharSequencia(toks: string[], palavras: string[], desde = 0): number {
  const n = toks.map((t) => sa(t));
  for (let i = desde; i + palavras.length <= n.length; i++) {
    let ok = true;
    for (let j = 0; j < palavras.length; j++) if (n[i + j] !== palavras[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}
