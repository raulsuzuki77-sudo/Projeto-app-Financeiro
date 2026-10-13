import { dataValida } from "../parsing/tempo.js";
import { paraCentavos } from "../parsing/text.js";

export interface ComprovanteLido {
  valor_centavos: number;
  estabelecimento: string;
  data_local: string | null;
  hora_local: number | null;
  cnpj: string | null;
  cnpj_valido: boolean | null;
}

export type ResultadoComprovante = { ok: true; dados: ComprovanteLido } | { ok: false; motivo: string };

/** Valida os dois dígitos verificadores de um CNPJ (somente dígitos). */
export function cnpjValido(cnpj: string): boolean {
  const n = cnpj.replace(/\D/g, "");
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return false;
  const dv = (base: string, pesos: number[]) => {
    const r = base.split("").reduce((a, c, i) => a + Number(c) * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(n.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return n.endsWith(`${d1}${d2}`);
}

const RE_VALOR = /R\$\s*([\d.]+,\d{2})/i;

/**
 * Extrai valor, estabelecimento, data/hora e CNPJ de texto de cupom/NFC-e ou comprovante de PIX.
 * Não adivinha: sem valor total identificável, recusa. O valor só é aceito quando vem de uma linha
 * rotulada como total/valor, ou quando é o único valor monetário do documento.
 */
export function lerComprovante(linhas: string[]): ResultadoComprovante {
  const texto = linhas.map((l) => l.trim()).filter(Boolean);

  const rotulados: number[] = [];
  for (const l of texto) {
    if (/\b(sub\s*total)\b/i.test(l)) continue;
    if (/\b(valor\s+total|total\s+a\s+pagar|total\s+r\$|total|valor\s+pago|valor)\b/i.test(l)) {
      const m = l.match(RE_VALOR);
      const c = m ? paraCentavos(m[1]!) : null;
      if (c) rotulados.push(c);
    }
  }
  let valor: number | null = null;
  const distintos = new Set(rotulados);
  if (distintos.size === 1) valor = rotulados[0]!;
  else if (distintos.size > 1) return { ok: false, motivo: "Mais de um valor total no documento; confirme manualmente." };
  else {
    const todos = new Set(texto.flatMap((l) => [...l.matchAll(/R\$\s*([\d.]+,\d{2})/gi)].map((m) => paraCentavos(m[1]!))).filter((x): x is number => !!x));
    if (todos.size === 1) valor = [...todos][0]!;
  }
  if (valor === null) return { ok: false, motivo: "Nao identifiquei o valor total do comprovante." };

  let data_local: string | null = null;
  let hora_local: number | null = null;
  for (const l of texto) {
    const d = l.match(/(?<!\d)(\d{2})\/(\d{2})\/(\d{4})(?!\d)/);
    if (d && dataValida(+d[3]!, +d[2]!, +d[1]!)) {
      data_local = `${d[3]}-${d[2]}-${d[1]}`;
      const h = l.match(/(?<!\d)([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?!\d)/);
      if (h) hora_local = Number(h[1]);
      break;
    }
  }

  const cj = texto.join("\n").match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  const cnpj = cj ? cj[0] : null;

  // Estabelecimento: PIX (linha após/ao lado de Para|Favorecido|Destino) ou primeira linha textual do cupom.
  let estabelecimento = "";
  const iPix = texto.findIndex((l) => /^(para|favorecido|destino|recebedor)\b/i.test(l));
  if (iPix >= 0) {
    const mesma = texto[iPix]!.replace(/^(para|favorecido|destino|recebedor)\s*:?\s*/i, "").trim();
    estabelecimento = mesma || texto[iPix + 1] || "";
  } else {
    estabelecimento = texto.find((l) => /[A-Za-zÀ-ú]{3,}/.test(l) && !/cnpj|nfc|cupom|documento|data\b/i.test(l)) ?? "";
  }
  estabelecimento = estabelecimento.replace(/\s+/g, " ").trim();
  if (!estabelecimento) return { ok: false, motivo: "Nao identifiquei o estabelecimento." };

  return { ok: true, dados: { valor_centavos: valor, estabelecimento, data_local, hora_local, cnpj, cnpj_valido: cnpj ? cnpjValido(cnpj) : null } };
}
