export function formatarBRL(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function mesAtual(hoje: Date = new Date()): string {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

export function mudarMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const d = new Date(a, m - 1 + delta, 1);
  return mesAtual(d);
}

export function nomeMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const nome = new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
  return `${nome} de ${a}`;
}

export function ultimoDia(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
}

export function rotuloCategoria(c: string): string {
  const t = c.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

/** Intensidade 0..1 relativa ao maior valor; 0 quando não há máximo. */
export function intensidade(valor: number, maximo: number): number {
  return maximo > 0 ? Math.min(1, valor / maximo) : 0;
}

/** Aceita apenas https, ou http em endereço local (localhost, 127.x, 10.x, 192.168.x, 172.16-31.x, .local). */
export function urlServidorValida(url: string): { ok: true; url: string } | { ok: false; motivo: string } {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return { ok: false, motivo: "Endereco invalido." };
  }
  if (u.protocol === "https:") return { ok: true, url: u.origin };
  if (u.protocol !== "http:") return { ok: false, motivo: "Use https." };
  const h = u.hostname;
  const local = h === "localhost" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith(".local");
  return local ? { ok: true, url: u.origin } : { ok: false, motivo: "Fora da rede local, o servidor deve usar https para proteger seus dados financeiros." };
}

/** Converte "1.234,56", "1234,5" ou "1234" (reais) em centavos; null se invalido. */
export function reaisParaCentavos(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/i, "");
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(t)) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
