import { detectarExtrato, lerExtratoInvestimento, sha256Bytes, type ResultadoLeitura } from "../../../core/src/index";
import { api } from "./api";
import { lerBytes } from "./arquivos";
import { textoDoPdf } from "./extrato-pdf";

export { ErroPdfProtegido } from "./ocr";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export interface LeituraDoArquivo {
  resultado: ResultadoLeitura;
  hash: string;
  /** Já existe um extrato com o mesmo arquivo (mesmo conteúdo) gravado. */
  jaImportado: boolean;
}

/**
 * Lê o PDF do extrato (camada de texto, com OCR só se necessário), escolhe o leitor e devolve a prévia.
 * Nada é gravado aqui. Lança `ErroPdfProtegido` se o PDF pedir senha.
 */
export async function lerArquivoDeExtrato(uri: string, senha?: string | null): Promise<LeituraDoArquivo> {
  const bytes = new Uint8Array(await lerBytes(uri));
  const hash = hex(sha256Bytes(bytes));
  const linhas = await textoDoPdf(uri, senha);
  const resultado = lerExtratoInvestimento(linhas);
  const reconhecido = detectarExtrato(linhas) !== null;
  const jaImportado = reconhecido && (await api.extratoInvestimentoImportado(hash));
  return { resultado, hash, jaImportado };
}

/** "US$ 1,234.56" sem depender de Intl. */
export function formatarUSD(centavos: number): string {
  const neg = centavos < 0;
  const abs = Math.abs(Math.round(centavos));
  const dolares = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}US$ ${dolares}.${String(abs % 100).padStart(2, "0")}`;
}

/** Valor na moeda original da posição ou do movimento. */
export function formatarMoeda(centavos: number, moeda: string, brl: (c: number) => string): string {
  return moeda === "USD" ? formatarUSD(centavos) : brl(centavos);
}

/** "4,3210" ou "4.3210" -> 4.321; null se inválido ou fora de 0,0001 a 1000. */
export function lerTaxaCambio(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, "");
  if (!/^\d{1,4}([.,]\d{1,4})?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return n > 0 && n <= 1000 ? n : null;
}

export function textoTaxa(taxaX10000: number): string {
  return (taxaX10000 / 10000).toFixed(4).replace(".", ",");
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "set/26" */
export function mesCurto(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return `${MESES_CURTOS[m - 1]}/${String(a).slice(2)}`;
}

export const ROTULO_TIPO_MOVIMENTO: Record<string, string> = {
  aporte: "Aporte",
  resgate: "Resgate",
  compra: "Compra",
  venda: "Venda",
  provento: "Provento",
  custodia: "Transferência de custódia",
  outro: "Outro",
};

export function nomeDaConta(c: { instituicao: string; conta: string }): string {
  return c.conta ? `${c.instituicao}, conta final ${c.conta}` : c.instituicao;
}

/** "+R$ 1.234,56" / "-R$ 1.234,56": o sinal vai sempre por escrito, a cor nunca é o único indicador. */
export function comSinal(centavos: number, brl: (c: number) => string): string {
  if (centavos === 0) return brl(0);
  return centavos > 0 ? `+${brl(centavos)}` : brl(centavos);
}

/** 0,0123 -> "1,23%" */
export function percentualTexto(fracao: number, casas = 2): string {
  return `${fracao >= 0 ? "+" : "-"}${(Math.abs(fracao) * 100).toFixed(casas).replace(".", ",")}%`;
}
