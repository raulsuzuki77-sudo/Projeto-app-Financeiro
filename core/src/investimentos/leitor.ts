import { ehExtratoBtgBrasil, lerExtratoBtgBrasil, marcasBtgBrasil } from "./btg-brasil";
import { ehExtratoBtgUS, lerExtratoBtgUS, marcasBtgUS } from "./btg-us";
import type { LinhaTexto, NomeLeitor, ResultadoLeitura } from "./tipos";

export { lerExtratoBtgBrasil, lerExtratoBtgUS };

/** Identifica o leitor adequado ao texto do extrato, ou null se o formato nao for reconhecido. */
export function detectarExtrato(linhas: LinhaTexto[]): NomeLeitor | null {
  if (ehExtratoBtgBrasil(linhas)) return "btg_brasil";
  if (ehExtratoBtgUS(linhas)) return "btg_us";
  return null;
}

/** Quais marcas de cada leitor foram encontradas no texto: vai no diagnostico para mostrar por que o PDF nao foi reconhecido. */
export function explicarDeteccao(linhas: LinhaTexto[]): string[] {
  const fmt = (nome: string, marcas: [string, boolean][]) => `${nome}: ${marcas.map(([m, ok]) => `${m}=${ok ? "sim" : "NÃO"}`).join(", ")}`;
  return [fmt("BTG Brasil", marcasBtgBrasil(linhas)), fmt("BTG US", marcasBtgUS(linhas))];
}

export const MENSAGEM_NAO_RECONHECIDO =
  "Formato de extrato não reconhecido. Por ora a leitura cobre o Extrato da Conta Investimento do BTG Pactual (Brasil) e o Account Statement da BTG Pactual US; em outros casos, use a posição manual.";

/** Le o extrato com o leitor certo. Nunca lanca excecao por texto inesperado: devolve `{ ok: false, erro }`. */
export function lerExtratoInvestimento(linhas: LinhaTexto[]): ResultadoLeitura {
  const leitor = detectarExtrato(linhas);
  if (!leitor) return { ok: false, erro: MENSAGEM_NAO_RECONHECIDO };
  try {
    return leitor === "btg_brasil" ? lerExtratoBtgBrasil(linhas) : lerExtratoBtgUS(linhas);
  } catch (e) {
    return { ok: false, erro: `Falha ao interpretar o extrato (${e instanceof Error ? e.message : "erro desconhecido"}). Nada foi gravado.` };
  }
}
