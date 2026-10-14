import type { Moeda } from "./tipos";

/**
 * Dicionarios PEQUENOS e PADRAO: ponto de partida, sempre sobrepostos pelo que o usuario informar no cadastro do ativo
 * (setor, exposicao). Foram escritos de memoria e nao verificados contra a classificacao oficial da B3: confira os que
 * importam. Um setor lido do proprio extrato (conciliado com os saldos) vale mais que este dicionario.
 */

/** Primeira letra maiuscula, resto minusculo ("SERVICOS FINANCEIROS DIVERSOS" -> "Servicos financeiros diversos"). */
export function nomeDeSetor(s: string): string {
  const t = s.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  return t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1);
}

export const SETOR_PADRAO: Readonly<Record<string, string>> = {
  BBAS3: "Bancos", BBDC3: "Bancos", BBDC4: "Bancos", ITUB3: "Bancos", ITUB4: "Bancos", SANB11: "Bancos", BPAC11: "Bancos", BRSR6: "Bancos",
  B3SA3: "Serviços financeiros diversos",
  EGIE3: "Energia elétrica", ELET3: "Energia elétrica", ELET6: "Energia elétrica", CMIG4: "Energia elétrica", CPLE6: "Energia elétrica",
  TAEE11: "Energia elétrica", EQTL3: "Energia elétrica", CPFE3: "Energia elétrica", ENGI11: "Energia elétrica", NEOE3: "Energia elétrica",
  SBSP3: "Água e saneamento", SAPR11: "Água e saneamento", CSMG3: "Água e saneamento",
  AGRO3: "Agricultura", SLCE3: "Agricultura", SMTO3: "Agricultura",
  PETR3: "Petróleo, gás e biocombustíveis", PETR4: "Petróleo, gás e biocombustíveis", PRIO3: "Petróleo, gás e biocombustíveis", RECV3: "Petróleo, gás e biocombustíveis",
  VALE3: "Mineração",
  CSNA3: "Siderurgia e metalurgia", GGBR4: "Siderurgia e metalurgia", GOAU4: "Siderurgia e metalurgia", USIM5: "Siderurgia e metalurgia",
  SUZB3: "Papel e celulose", KLBN11: "Papel e celulose",
  WEGE3: "Máquinas e equipamentos",
  ABEV3: "Bebidas",
  JBSS3: "Carnes e derivados", BRFS3: "Carnes e derivados", MRFG3: "Carnes e derivados", BEEF3: "Carnes e derivados",
};

/** Fundos de indice listados no Brasil com exposicao a ativos no exterior. */
const EXPOSICAO_ESTRANGEIRA = new Set(["IVVB11", "SPXI11", "NASD11", "WRLD11", "ACWI11", "EURP11", "XINA11", "BNDX11"]);

export type Exposicao = "nacional" | "estrangeira";
export const EXPOSICOES: readonly Exposicao[] = ["nacional", "estrangeira"];
export const ROTULO_EXPOSICAO: Record<Exposicao, string> = { nacional: "Nacional", estrangeira: "Estrangeira" };

/** BDRs (recibos de acoes estrangeiras negociados na B3): codigo de 4 letras terminado em 32 a 35. */
const RE_BDR = /^[A-Z]{4}3[2-5]$/;

export function setorPadrao(codigo: string | null): string | null {
  return codigo ? (SETOR_PADRAO[codigo.toUpperCase()] ?? null) : null;
}

/** Exposicao padrao: conta em moeda estrangeira, ETF/BDR do dicionario ou padrao de BDR; senao nacional. */
export function exposicaoPadrao(codigo: string | null, moeda: Moeda | string): Exposicao {
  if (moeda !== "BRL") return "estrangeira";
  const c = codigo?.toUpperCase() ?? "";
  return EXPOSICAO_ESTRANGEIRA.has(c) || RE_BDR.test(c) ? "estrangeira" : "nacional";
}

/** Chave de cadastro de um ativo: o codigo (maiusculo) ou, sem codigo, o nome sem acentos e em minusculas. */
export function chaveDoAtivo(codigo: string | null, ativo: string): string {
  if (codigo && codigo.trim() !== "") return codigo.trim().toUpperCase();
  return "nome:" + ativo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
