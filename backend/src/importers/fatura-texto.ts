import { dataValida } from "../parsing/tempo.js";
import { paraCentavos } from "../parsing/text.js";
import type { ItemImportado } from "./comum.js";

export interface ResultadoFatura {
  itens: ItemImportado[];
  /** Linhas que começam com data mas não foram lidas por completo: precisam de revisão manual. */
  nao_lidas: string[];
}

/**
 * Lê o texto de uma fatura de cartão no layout "DD/MM/AAAA  DESCRICAO  R$ valor"
 * (layout observado na fatura Nomad). O texto vem de OCR ou de camada de texto do PDF;
 * o PDF de exemplo fornecido NAO tem camada de texto, portanto o OCR e etapa da Fase 2.
 * Compras sao positivas; pagamentos/creditos sao negativos ("-R$ 4.512,31").
 */
export function lerFaturaTexto(texto: string): ResultadoFatura {
  const itens: ItemImportado[] = [];
  const nao_lidas: string[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!/^\d{2}\/\d{2}\/\d{4}\b/.test(linha)) continue;
    const m = linha.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+(-)?\s*R\$\s*([\d.]+,\d{2})$/);
    const cents = m ? paraCentavos(m[6]!) : null;
    if (!m || cents === null || !dataValida(+m[3]!, +m[2]!, +m[1]!)) {
      nao_lidas.push(linha);
      continue;
    }
    let descricao = m[4]!.replace(/\s+/g, " ");
    let parcela_atual: number | null = null;
    let parcela_total: number | null = null;
    const p = descricao.match(/\s*\((\d{2})\/(\d{2})\)\s*$/);
    if (p) {
      parcela_atual = Number(p[1]);
      parcela_total = Number(p[2]);
      descricao = descricao.replace(p[0], "").trim();
    }
    itens.push({
      data_local: `${m[3]}-${m[2]}-${m[1]}`,
      descricao,
      valor_centavos: m[5] ? -cents : cents,
      parcela_atual,
      parcela_total,
    });
  }
  return { itens, nao_lidas };
}
