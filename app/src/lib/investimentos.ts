import { Platform, Share } from "react-native";
import { detectarExtrato, explicarDeteccao, lerExtratoInvestimento, novoDiagnostico, sha256Bytes, textoDiagnostico, type DiagnosticoLeitura, type LinhaTexto, type ResultadoLeitura } from "../../../core/src/index";
import { api } from "./api";
import { lerBytes } from "./arquivos";
import { textoDoPdf } from "./extrato-pdf";

import { ErroPdfProtegido } from "./ocr";

export { ErroPdfProtegido };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export interface LeituraDoArquivo {
  resultado: ResultadoLeitura;
  hash: string;
  /** Já existe um extrato com o mesmo arquivo (mesmo conteúdo) gravado. */
  jaImportado: boolean;
  /** Caminho de leitura usado, tentativas e primeiras linhas, para o "Copiar diagnóstico". */
  diagnostico: DiagnosticoLeitura;
  /** Marcas de cada leitor encontradas (ou não) no texto. */
  deteccao: string[];
  linhas: LinhaTexto[];
}

/**
 * Lê o PDF do extrato (camada de texto, com OCR só se necessário), escolhe o leitor e devolve a prévia.
 * Nada é gravado aqui. Lança `ErroPdfProtegido` se o PDF pedir senha. `diag` (criado por quem chama) recebe o caminho e as
 * tentativas mesmo quando a leitura falha antes de haver linhas.
 */
export async function lerArquivoDeExtrato(uri: string, senha?: string | null, diag: DiagnosticoLeitura = novoDiagnostico()): Promise<LeituraDoArquivo> {
  const bytes = new Uint8Array(await lerBytes(uri));
  const hash = hex(sha256Bytes(bytes));
  let linhas: LinhaTexto[];
  try {
    linhas = await textoDoPdf(uri, senha, diag);
  } catch (e) {
    // senha pedida não é falha de leitura; qualquer outra entra no diagnóstico
    if (!(e instanceof ErroPdfProtegido)) diag.erro = e instanceof Error ? e.message : String(e);
    throw e;
  }
  const resultado = lerExtratoInvestimento(linhas);
  const reconhecido = detectarExtrato(linhas) !== null;
  const jaImportado = reconhecido && (await api.extratoInvestimentoImportado(hash));
  return { resultado, hash, jaImportado, diagnostico: diag, deteccao: explicarDeteccao(linhas), linhas };
}

/** Texto do diagnóstico para copiar: caminho, contagens, primeiras linhas (dados pessoais ocultados) e o motivo da falha. */
export function diagnosticoDaLeitura(l: LeituraDoArquivo | null, diag: DiagnosticoLeitura, erro: string | null): string {
  const ok = l && l.resultado.ok ? l.resultado.extrato : null;
  return textoDiagnostico(diag, {
    plataforma: Platform.OS,
    leitor: ok ? ok.leitor : l ? detectarExtrato(l.linhas) : null,
    erroLeitura: erro ?? (l && !l.resultado.ok ? l.resultado.erro : null),
    avisos: ok ? ok.avisos : [],
    deteccao: l?.deteccao,
    agora: new Date(),
  });
}

/**
 * Copia o texto para a área de transferência. No navegador usa a API de clipboard; no iPhone abre a folha de compartilhamento
 * do sistema (que oferece "Copiar"), porque o app não tem módulo de clipboard. Devolve como foi entregue.
 */
export async function copiarTexto(texto: string): Promise<"copiado" | "compartilhado"> {
  if (Platform.OS === "web") {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
    if (!nav?.clipboard) throw new Error("O navegador não permitiu copiar. Selecione e copie o texto manualmente.");
    await nav.clipboard.writeText(texto);
    return "copiado";
  }
  await Share.share({ message: texto });
  return "compartilhado";
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

/** Preço unitário (cotação, preço médio) na moeda do ativo, com 2 a 8 casas conforme o dado (cotas de fundo têm 7 casas). */
export function formatarPreco(valor: number, moeda: string): string {
  const casas = Math.min(8, Math.max(2, (String(valor).split(".")[1] ?? "").length));
  const [inteiro, frac] = valor.toFixed(casas).split(".") as [string, string];
  if (moeda === "USD") return `US$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

/** Quantidade com até 8 casas e vírgula decimal ("7.123,34245949"; inteiros sem casas). */
export function formatarQuantidade(q: number): string {
  const [inteiro, frac] = String(q).split(".") as [string, string | undefined];
  const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac ? `${milhar},${frac}` : milhar;
}

/** "4,3210" ou "4.3210" -> 4.321; null se inválido ou fora de 0,0001 a 1000. */
export function lerTaxaCambio(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, "");
  if (!/^\d{1,4}([.,]\d{1,4})?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return n > 0 && n <= 1000 ? n : null;
}

/** Preço médio digitado ("111,31", "1.234,5678", "98.5"): até 8 casas; null se inválido ou zero. */
export function lerPrecoUnitario(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, "").replace(/^(R\$|US\$)/, "");
  if (t === "") return null;
  const normal = /,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d{1,8})?$/.test(normal)) return null;
  const n = Number(normal);
  return n > 0 && n < 1e9 ? n : null;
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
  custodia: "Depósito / transferência de custódia",
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

/** 0,0123 -> "+1,23%" */
export function percentualTexto(fracao: number, casas = 2): string {
  return `${fracao >= 0 ? "+" : "-"}${(Math.abs(fracao) * 100).toFixed(casas).replace(".", ",")}%`;
}

/** Percentual do documento (1,07 -> "1,07%"), sem sinal forçado. */
export function pctDoDocumento(p: number | null): string {
  return p === null ? "n/d" : `${p.toFixed(2).replace(".", ",")}%`;
}
