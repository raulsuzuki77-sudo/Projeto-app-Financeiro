import { dataValida } from "../parsing/tempo.js";
import { paraCentavos } from "../parsing/text.js";

export interface ComprovanteLido {
  valor_centavos: number;
  estabelecimento: string;
  data_local: string | null;
  hora_local: number | null;
  cnpj: string | null;
  cnpj_valido: boolean | null;
  forma_pagamento: "pix" | null;
  /** ID da transação PIX (E2E ID, 32 caracteres), quando legível: serve de referência única. */
  id_transacao: string | null;
  /** Divergências entre campos que deveriam concordar (ex.: data exibida x data embutida no ID do PIX). */
  inconsistencias: string[];
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
const MESES: Record<string, number> = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const RE_ID_PIX = /[ED]\d{8}\d{12}[0-9A-Za-z]{11}/;

/** Instante embutido no ID PIX (posições 9 a 20: AAAAMMDDHHMM em UTC) convertido para o fuso de Brasília (UTC-3). */
function dataDoIdPix(id: string): { data_local: string; hora_local: number } | null {
  const m = id.slice(9, 21).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m || !dataValida(+m[1]!, +m[2]!, +m[3]!)) return null;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) - 3 * 3600_000);
  return { data_local: d.toISOString().slice(0, 10), hora_local: d.getUTCHours() };
}

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
    const h = l.match(/(?<!\d)([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?!\d)/);
    const d = l.match(/(?<!\d)(\d{2})\/(\d{2})\/(\d{4})(?!\d)/);
    if (d && dataValida(+d[3]!, +d[2]!, +d[1]!)) {
      data_local = `${d[3]}-${d[2]}-${d[1]}`;
      if (h) hora_local = Number(h[1]);
      break;
    }
    const e = l.match(/(?<!\d)(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\.?\s+(\d{4})(?!\d)/i);
    if (e) {
      const mes = MESES[e[2]!.toUpperCase()]!;
      if (dataValida(+e[3]!, mes, +e[1]!)) {
        data_local = `${e[3]}-${String(mes).padStart(2, "0")}-${String(+e[1]!).padStart(2, "0")}`;
        if (h) hora_local = Number(h[1]);
        break;
      }
    }
  }

  // ID PIX: o OCR costuma quebrar o ID em duas linhas; junta a linha do rótulo com a seguinte.
  const inconsistencias: string[] = [];
  let id_transacao: string | null = null;
  for (let i = 0; i < texto.length && !id_transacao; i++) {
    if (!/\bID\b.*transa/i.test(texto[i]!)) continue;
    const juntas = `${texto[i]!.replace(/^.*?(?=[ED]\d)/i, "")}${texto[i + 1] ?? ""}`.replace(/\s+/g, "");
    id_transacao = juntas.match(RE_ID_PIX)?.[0] ?? null;
  }
  if (!id_transacao) id_transacao = texto.join("").replace(/\s+/g, "").match(RE_ID_PIX)?.[0] ?? null;
  if (id_transacao) {
    const emb = dataDoIdPix(id_transacao);
    if (emb && data_local && emb.data_local !== data_local) inconsistencias.push(`data exibida (${data_local}) difere da data embutida no ID do PIX (${emb.data_local})`);
    else if (emb && hora_local !== null && Math.abs(emb.hora_local - hora_local) > 1 && emb.data_local === data_local) inconsistencias.push(`hora exibida (${hora_local}h) difere da hora embutida no ID do PIX (${emb.hora_local}h)`);
    if (emb && !data_local) {
      data_local = emb.data_local;
      hora_local = emb.hora_local;
    }
  }

  // Layout de comprovante PIX: seções "Destino" e "Origem". O que interessa é o Destino;
  // CNPJ do rodapé (instituição) e dados da Origem (o próprio usuário) são ignorados.
  const iDestino = texto.findIndex((l) => /^destino\b/i.test(l));
  const iOrigem = texto.findIndex((l, i) => i > iDestino && /^origem\b/i.test(l));
  const secaoDestino = iDestino >= 0 ? texto.slice(iDestino + 1, iOrigem > iDestino ? iOrigem : undefined) : null;
  let cnpj: string | null = null;
  if (secaoDestino) {
    const bruto = secaoDestino.join("\n").match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|(?<!\d)\d{14}(?!\d)/)?.[0];
    if (bruto) cnpj = bruto.replace(/\D/g, "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  } else {
    cnpj = texto.join("\n").match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)?.[0] ?? null;
  }
  const ehPix = /tipo de transfer\S* +pix|comprovante de pix|\bpix\b/i.test(texto.join("\n"));

  // Estabelecimento: PIX (linha após/ao lado de Para|Favorecido|Destino) ou primeira linha textual do cupom.
  let estabelecimento = "";
  if (secaoDestino) {
    const nome = secaoDestino.find((l) => /^nome\b/i.test(l));
    if (nome) estabelecimento = nome.replace(/^nome\s*:?\s*/i, "");
  }
  const iPix = estabelecimento ? -1 : texto.findIndex((l) => /^(para|favorecido|destino|recebedor)\b/i.test(l));
  if (iPix >= 0) {
    const mesma = texto[iPix]!.replace(/^(para|favorecido|destino|recebedor)\s*:?\s*/i, "").trim();
    estabelecimento = mesma || texto[iPix + 1] || "";
  } else if (!estabelecimento) {
    estabelecimento = texto.find((l) => /[A-Za-zÀ-ú]{3,}/.test(l) && !/cnpj|nfc|cupom|documento|data\b/i.test(l)) ?? "";
  }
  estabelecimento = estabelecimento.replace(/\s+/g, " ").trim();
  if (!estabelecimento) return { ok: false, motivo: "Nao identifiquei o estabelecimento." };

  return { ok: true, dados: { valor_centavos: valor, estabelecimento, data_local, hora_local, cnpj, cnpj_valido: cnpj ? cnpjValido(cnpj) : null, forma_pagamento: ehPix ? "pix" : null, id_transacao, inconsistencias } };
}
