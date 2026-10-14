import type { LinhaTexto } from "./tipos";

/**
 * Diagnostico da leitura de um extrato em PDF: o que foi lido e por qual caminho, para o usuario copiar e colar de volta
 * ao desenvolvedor quando o PDF nao e reconhecido. Nao contem o arquivo; so o texto das primeiras linhas, com os dados
 * pessoais mais comuns (CPF, numero de conta, nome, endereco, e-mail, telefone) ocultados.
 */

export type CaminhoLeitura = "pdfkit-posicional" | "pdfkit-antigo" | "ocr" | "pdfjs" | "ocr-web" | "nenhum";

export interface DiagnosticoLeitura {
  /** Caminho que produziu as linhas ("nenhum" se a leitura falhou antes). */
  caminho: CaminhoLeitura;
  /** Cada tentativa feita, na ordem, com o resultado (por exemplo "pdfkit-posicional: 0 itens, seguiu para o caminho antigo"). */
  tentativas: string[];
  /** Quantidade de itens posicionados recebidos (null quando o caminho nao os usa). */
  itens: number | null;
  /** Primeiras linhas lidas (texto bruto; a ocultacao de dados pessoais ocorre ao montar o texto). */
  linhas: string[];
  totalLinhas: number;
  /** Mensagem de erro da leitura do PDF, se houve. */
  erro: string | null;
}

export const LINHAS_NO_DIAGNOSTICO = 80;

export function novoDiagnostico(): DiagnosticoLeitura {
  return { caminho: "nenhum", tentativas: [], itens: null, linhas: [], totalLinhas: 0, erro: null };
}

/** Registra as linhas lidas (guarda so as primeiras). */
export function registrarLinhas(d: DiagnosticoLeitura, linhas: LinhaTexto[], caminho: CaminhoLeitura): void {
  d.caminho = caminho;
  d.totalLinhas = linhas.length;
  d.linhas = linhas.slice(0, LINHAS_NO_DIAGNOSTICO).map((l) => l.texto);
}

const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const RE_EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const RE_TELEFONE = /\(?\b\d{2}\)?[ -]?9?\d{4}-\d{4}\b/g;
const RE_CEP = /\b\d{5}-?\d{3}\b/g;
const RE_ENDERECO = /^(rua|r\.|av\.?|avenida|alameda|travessa|rodovia|praca|praça|quadra|qd\.?|lote|street|st\.|avenue|ave\.?|road|rd\.?)\s/i;
/** Numero de conta/cartao: sequencia longa de digitos (os 4 ultimos ficam). */
const RE_CONTA_LONGA = /\d{7,}/g;

/**
 * Oculta dados pessoais de linhas de extrato. Melhor esforco por padroes: CPF, e-mail, telefone, CEP, enderecos,
 * "Account Name:", numeros longos (ficam os 4 ultimos digitos) e, nas primeiras linhas, linhas inteiras em maiusculas com
 * 2 a 6 palavras (nome do titular). CNPJ e valores nao sao tocados. Devolve o texto e quantas linhas foram alteradas.
 */
export function ocultarDadosPessoais(linhas: string[]): { linhas: string[]; alteradas: number } {
  let alteradas = 0;
  const saida = linhas.map((original, i) => {
    let l = original;
    if (i < 14 && /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ'.-]+(?: [A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ'.-]+){1,5}$/.test(l.trim()) && !/\d/.test(l) && !/(LLC|INC|LTDA|S\.A\.)$/i.test(l.trim())) l = "[nome oculto]";
    else if (RE_ENDERECO.test(l.trim())) l = "[endereço oculto]";
    else {
      l = l.replace(/(account name:\s*)(.+)$/i, "$1[nome oculto]");
      l = l.replace(RE_CPF, (m) => (/\d{3}\.\d{3}\.\d{3}-\d{2}|^\d{11}$/.test(m) ? "[cpf oculto]" : m));
      l = l.replace(RE_EMAIL, "[e-mail oculto]");
      l = l.replace(RE_TELEFONE, "[telefone oculto]");
      l = l.replace(RE_CEP, (m) => (/^\d{5}-\d{3}$/.test(m) ? "[cep oculto]" : m));
      l = l.replace(/(account number:\s*)(\S+)/i, (_t, pre: string, id: string) => `${pre}***${id.replace(/[^0-9A-Za-z]/g, "").slice(-4)}`);
      // sequencias longas de digitos (conta, cartao); partes decimais de quantidades e cotas (depois de virgula ou ponto) ficam
      l = l.replace(RE_CONTA_LONGA, (m, desloc: number, tudo: string) => (/[.,]/.test(tudo[desloc - 1] ?? "") ? m : `***${m.slice(-4)}`));
    }
    if (l !== original) alteradas++;
    return l;
  });
  return { linhas: saida, alteradas };
}

export interface ContextoDiagnostico {
  plataforma: string;
  /** Leitor que reconheceu o PDF, ou null. */
  leitor: string | null;
  /** Erro devolvido pela leitura do extrato (reconhecimento ou interpretacao), se houve. */
  erroLeitura: string | null;
  avisos: string[];
  /** Marcas de cada leitor encontradas ou nao no texto (ver `explicarDeteccao`). */
  deteccao?: string[];
  agora: Date;
}

/** Texto pronto para copiar. Nao inclui o arquivo nem dados alem das primeiras linhas lidas, ja com a ocultacao aplicada. */
export function textoDiagnostico(d: DiagnosticoLeitura, ctx: ContextoDiagnostico): string {
  const { linhas, alteradas } = ocultarDadosPessoais(d.linhas);
  const partes: string[] = [
    "DIAGNÓSTICO DE LEITURA DE EXTRATO",
    `Gerado em: ${ctx.agora.toISOString()}`,
    `Plataforma: ${ctx.plataforma}`,
    `Caminho usado: ${d.caminho}`,
    `Tentativas: ${d.tentativas.length ? d.tentativas.join(" | ") : "(nenhuma registrada)"}`,
    `Itens posicionados: ${d.itens === null ? "não se aplica" : d.itens}`,
    `Linhas lidas: ${d.totalLinhas} (mostradas: ${linhas.length})`,
    `Leitor que reconheceu o PDF: ${ctx.leitor ?? "nenhum"}`,
  ];
  if (d.erro) partes.push(`Erro ao ler o PDF: ${d.erro}`);
  if (ctx.erroLeitura) partes.push(`Erro da interpretação: ${ctx.erroLeitura}`);
  if (ctx.deteccao?.length) partes.push(`Detecção: ${ctx.deteccao.join(" | ")}`);
  if (ctx.avisos.length) partes.push(`Avisos: ${ctx.avisos.join(" | ")}`);
  const substituicao = d.linhas.join("\n").match(/�/g)?.length ?? 0;
  if (substituicao > 0) partes.push(`Caracteres de substituição (U+FFFD) nas linhas mostradas: ${substituicao}`);
  partes.push(`Dados pessoais ocultados automaticamente em ${alteradas} linha(s). Confira antes de enviar: nomes e endereços podem escapar.`);
  partes.push("--- primeiras linhas ---");
  partes.push(...linhas.map((l, i) => `${String(i + 1).padStart(2, "0")}| ${l}`));
  return partes.join("\n");
}
