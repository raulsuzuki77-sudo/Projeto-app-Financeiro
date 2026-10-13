import { dataValida } from "../parsing/tempo.js";
import { paraCentavos } from "../parsing/text.js";
import type { LinhaOcr } from "../ocr/tesseract.js";
import type { ItemImportado } from "./comum.js";

export interface Conciliacao {
  total_declarado_centavos: number;
  soma_itens_centavos: number;
  diferenca_centavos: number;
  fecha: boolean;
}

export interface ResultadoFatura {
  itens: ItemImportado[];
  /** Linhas que começam com data mas não foram lidas por completo: precisam de revisão manual. */
  nao_lidas: string[];
  /** Soma dos itens x total declarado na própria fatura; null se o total não foi localizado. */
  conciliacao: Conciliacao | null;
}

/** Abaixo disto a linha lida por OCR vai para revisão. */
export const LIMIAR_CONFIANCA_OCR = 80;

const RE_ITEM = /^[(\[|\s]*(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+(-)?\s*R\$\s*([\d.]+,\d{2})$/;
const RE_PGTO_ANTERIOR = /pagamento de fatura|pagamento recebido/i;
const RE_TOTAL = /Despesas e cr\S+ do m\S+.*?R\$\s*([\d.]+,\d{2})/i;

/** Marca itens cuja data quebra a ordem cronológica do extrato (maior subsequência não decrescente = confiável). */
function marcarForaDeOrdem(itens: ItemImportado[]): Set<number> {
  const idx = itens.map((it, i) => ({ it, i })).filter((x) => !RE_PGTO_ANTERIOR.test(x.it.descricao));
  const n = idx.length;
  const comp = new Array<number>(n).fill(1);
  const ant = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++)
      if (idx[j]!.it.data_local <= idx[i]!.it.data_local && comp[j]! + 1 > comp[i]!) {
        comp[i] = comp[j]! + 1;
        ant[i] = j;
      }
  let fim = 0;
  for (let i = 1; i < n; i++) if (comp[i]! > comp[fim]!) fim = i;
  const ok = new Set<number>();
  for (let k = n ? fim : -1; k >= 0; k = ant[k]!) ok.add(idx[k]!.i);
  return new Set(idx.filter((x) => !ok.has(x.i)).map((x) => x.i));
}

/**
 * Lê as linhas de uma fatura de cartão no layout "DD/MM/AAAA  DESCRICAO  R$ valor"
 * (layout observado na fatura Nomad). Compras são positivas; pagamentos/créditos, negativos.
 * Como OCR erra, cada item recebe verificações independentes: confiança da linha,
 * ordem cronológica e conferência da soma com o total declarado pela própria fatura.
 */
export function lerFaturaLinhas(linhas: { texto: string; confianca?: number }[]): ResultadoFatura {
  const itens: ItemImportado[] = [];
  const nao_lidas: string[] = [];
  let total: number | null = null;

  for (const l of linhas) {
    const linha = l.texto.trim();
    const t = linha.match(RE_TOTAL);
    if (t && total === null) total = paraCentavos(t[1]!);

    if (!/^[(\[|\s]*\d{2}\/\d{2}\/\d{4}\b/.test(linha) || !/R\$/.test(linha)) continue;
    const m = linha.match(RE_ITEM);
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
    const alertas: string[] = [];
    if (l.confianca !== undefined && l.confianca < LIMIAR_CONFIANCA_OCR) alertas.push(`confianca do OCR baixa (${l.confianca.toFixed(0)}%)`);
    if (!/[A-Za-z]{3,}/.test(descricao)) alertas.push("descricao ilegivel");
    itens.push({
      data_local: `${m[3]}-${m[2]}-${m[1]}`,
      descricao,
      valor_centavos: m[5] ? -cents : cents,
      parcela_atual,
      parcela_total,
      confianca_ocr: l.confianca,
      alerta: alertas.length ? alertas.join("; ") : undefined,
    });
  }

  for (const i of marcarForaDeOrdem(itens)) {
    const it = itens[i]!;
    it.alerta = [it.alerta, "data fora da ordem cronologica do extrato (possivel erro de leitura)"].filter(Boolean).join("; ");
  }

  const soma = itens.filter((it) => !RE_PGTO_ANTERIOR.test(it.descricao)).reduce((a, it) => a + it.valor_centavos, 0);
  const conciliacao: Conciliacao | null =
    total === null ? null : { total_declarado_centavos: total, soma_itens_centavos: soma, diferenca_centavos: soma - total, fecha: soma === total };
  return { itens, nao_lidas, conciliacao };
}

export function lerFaturaTexto(texto: string): ResultadoFatura {
  return lerFaturaLinhas(texto.split(/\r?\n/).map((t) => ({ texto: t })));
}

export function lerFaturaOcr(linhas: LinhaOcr[]): ResultadoFatura {
  return lerFaturaLinhas(linhas);
}
