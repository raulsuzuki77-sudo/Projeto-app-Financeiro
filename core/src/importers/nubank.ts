import type { FormaPagamento } from "../domain/types";

/**
 * Leitura dos CSVs exportados pelo Nubank.
 *  - Conta: `Data,Valor,Identificador,Descrição` (valor com sinal: negativo = saída; data dd/mm/aaaa; ponto decimal).
 *  - Cartão: `date,title,amount` (valor positivo = compra; negativo = pagamento ou crédito; vírgula decimal).
 * Os formatos acima foram deduzidos de arquivos de exemplo do usuário; o Nubank pode alterá-los sem aviso. Qualquer cabeçalho
 * diferente cai no leitor genérico, e linhas que não se encaixam são reportadas (nunca descartadas em silêncio).
 */
export type FormatoCsv = "nubank_conta" | "nubank_cartao" | "generico";

export function detectarFormatoCsv(cabecalho: string[]): FormatoCsv {
  const c = new Set(cabecalho.map((x) => x.trim().toLowerCase()));
  if (c.has("identificador") && c.has("data") && c.has("valor") && (c.has("descrição") || c.has("descricao"))) return "nubank_conta";
  if (c.size === 3 && c.has("date") && c.has("title") && c.has("amount")) return "nubank_cartao";
  return "generico";
}

export interface Interpretacao {
  /** Texto legível, sem códigos de agência/conta, e estável entre meses (base da classificação). */
  descricao: string;
  forma_pagamento: FormaPagamento | null;
  /** Crédito que abate uma despesa (estorno, desconto, devolução). */
  estorno: boolean;
  parcela_atual?: number;
  parcela_total?: number;
}

const limpar = (s: string) => s.replace(/\s+/g, " ").trim();
const limitar = (s: string, n = 80) => (s.length > n ? s.slice(0, n).trim() : s);
const RE_DOC = /^[•\d.\/*-]+$/;

/** "Nome - 12.345.678/0001-90 - BANCO (0001) Agência: 1 Conta: 2" -> "Nome". O documento e o banco ficam só no texto bruto. */
function nomeDoFavorecido(resto: string): string {
  const partes = resto.split(" - ").map(limpar);
  const doc = partes.findIndex((p, i) => i > 0 && RE_DOC.test(p));
  const nome = doc > 0 ? partes.slice(0, doc).join(" - ") : partes[0] ?? resto;
  return limitar(nome);
}

export function interpretarConta(bruto: string): Interpretacao {
  const t = limpar(bruto);
  let m = t.match(/^(Estorno - )?Transfer[êe]ncia (enviada|recebida) pelo Pix - (.+)$/i);
  if (m) {
    const direcao = m[2]!.toLowerCase() === "enviada" ? "enviado" : "recebido";
    // O estorno de um Pix enviado herda a descricao do envio: assim abate a despesa certa e herda a mesma classificacao.
    return { descricao: `Pix ${m[1] ? "enviado" : direcao}: ${nomeDoFavorecido(m[3]!)}`, forma_pagamento: "pix", estorno: Boolean(m[1]) };
  }
  m = t.match(/^(Estorno - )?Pagamento de boleto efetuado - (.+)$/i);
  if (m) return { descricao: `Boleto: ${limitar(m[2]!)}`, forma_pagamento: "boleto", estorno: Boolean(m[1]) };
  m = t.match(/^Transfer[êe]ncia (enviada|recebida)(?: - (.+))?$/i);
  if (m) return { descricao: `Transferência ${m[1]!.toLowerCase()}${m[2] ? `: ${limitar(m[2])}` : ""}`, forma_pagamento: null, estorno: false };
  m = t.match(/^Estorno - (.+)$/i);
  if (m) return { descricao: limitar(m[1]!), forma_pagamento: null, estorno: true };
  return { descricao: limitar(t, 120), forma_pagamento: null, estorno: false };
}

export function interpretarCartao(titulo: string, valorCentavos: number): Interpretacao {
  let t = limpar(titulo);
  if (/^pagamento recebido$/i.test(t)) return { descricao: "Pagamento de fatura", forma_pagamento: null, estorno: false };
  let parcela: Pick<Interpretacao, "parcela_atual" | "parcela_total"> = {};
  const p = t.match(/\s*-?\s*Parcela\s+(\d+)\/(\d+)\s*$/i);
  if (p) {
    parcela = { parcela_atual: Number(p[1]), parcela_total: Number(p[2]) };
    t = t.slice(0, p.index).trim();
  }
  let estorno = valorCentavos < 0;
  const desc = t.match(/^Desconto Antecipa[çc][ãa]o\s+(.+)$/i);
  if (desc) { t = `Desconto antecipação: ${desc[1]}`; estorno = true; }
  const iof = t.match(/^IOF de volta de\s+(.+)$/i);
  if (iof) { t = `IOF de volta de: ${iof[1]}`; estorno = true; }
  return { descricao: limitar(t, 120), forma_pagamento: "credito", estorno, ...parcela };
}
