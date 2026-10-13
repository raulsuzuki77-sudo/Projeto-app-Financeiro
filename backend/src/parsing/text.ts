/** Minúsculas, sem acentos, sem pontuação, espaços colapsados. */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Converte "1.234,56", "42,9", "42.90", "R$ 7,70" em centavos. Retorna null se inválido. */
export function paraCentavos(texto: string): number | null {
  let t = texto.replace(/R\$\s*/i, "").trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+\.\d{1,2}$/.test(t)) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function formatarBRL(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
