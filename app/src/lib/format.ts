/** "R$ 1.234,56" sem depender de Intl (idêntico em Node, no navegador e no Hermes). */
export function formatarBRL(centavos: number): string {
  const neg = centavos < 0;
  const abs = Math.abs(Math.round(centavos));
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}R$ ${reais},${String(abs % 100).padStart(2, "0")}`;
}

export function mesAtual(hoje: Date = new Date()): string {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

export function mudarMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const d = new Date(a, m - 1 + delta, 1);
  return mesAtual(d);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function nomeMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return `${MESES[m - 1]} de ${a}`;
}

export function ultimoDia(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
}

export const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

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

/**
 * Máscara de valor em reais enquanto se digita: só os dígitos contam e os dois últimos são os centavos, então a vírgula
 * e os pontos de milhar aparecem sozinhos ("1" -> "0,01"; "123456" -> "1.234,56"). Vazio continua vazio.
 */
export function mascararValor(texto: string): string {
  const digitos = texto.replace(/\D/g, "").replace(/^0+/, "").slice(0, 12);
  if (!digitos) return "";
  const cheio = digitos.padStart(3, "0");
  const reais = cheio.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${reais},${cheio.slice(-2)}`;
}

/** Centavos -> texto já mascarado, para preencher um campo de valor ao editar. */
export function mascaraDeCentavos(centavos: number): string {
  return mascararValor(String(Math.max(0, Math.round(centavos))));
}

/** Converte "1.234,56", "1234,5" ou "1234" (reais) em centavos; null se invalido. */
export function reaisParaCentavos(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/i, "");
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(t)) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** "10", "10,5" ou "10.5" (percentual ao ano) -> fração 0,10 / 0,105; null se inválido ou fora de 0..100. */
export function percentualParaFracao(texto: string): number | null {
  const t = texto.trim().replace("%", "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 100 ? n / 100 : null;
}

/** "13/10/2026" para uma data AAAA-MM-DD. */
export function dataBR(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/** Converte "dd/mm/aaaa" (ou "dd/mm") em AAAA-MM-DD; null se inválida. Sem ano, usa o ano de referência. */
export function dataParaISO(texto: string, anoReferencia: number): string | null {
  const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  let ano = m[3] ? Number(m[3]) : anoReferencia;
  if (ano < 100) ano += 2000;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
