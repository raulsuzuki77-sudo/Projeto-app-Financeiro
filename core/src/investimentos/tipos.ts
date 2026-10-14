/** Linha de texto de um extrato: o mesmo formato de `LinhaOcr`, com confianca e pagina opcionais. */
export interface LinhaTexto {
  texto: string;
  confianca?: number;
  pagina?: number;
}

export const CLASSES_ATIVO = ["previdencia", "renda_variavel", "renda_fixa", "caixa", "transito", "outros"] as const;
export type ClasseAtivo = (typeof CLASSES_ATIVO)[number];

export const ROTULO_CLASSE: Record<ClasseAtivo, string> = {
  previdencia: "Previdência",
  renda_variavel: "Renda variável",
  renda_fixa: "Renda fixa",
  caixa: "Caixa e conta corrente",
  transito: "Valores em trânsito",
  outros: "Outros",
};

export const TIPOS_MOVIMENTO = ["aporte", "resgate", "compra", "venda", "provento", "custodia", "outro"] as const;
export type TipoMovimento = (typeof TIPOS_MOVIMENTO)[number];

export type Moeda = "BRL" | "USD";
export type NomeLeitor = "btg_brasil" | "btg_us";

export interface PosicaoLida {
  classe_ativo: ClasseAtivo;
  ativo: string;
  codigo: string | null;
  quantidade: number | null;
  /** Na moeda do extrato, em centavos. Pode ser negativo (valores em transito). */
  valor_centavos: number;
}

/**
 * Convencao de sinal: aporte, resgate, compra e venda guardam o MODULO do valor (o tipo diz o sentido);
 * provento, custodia e outro guardam o sinal do extrato (custodia negativa = retirada de custodia).
 */
export interface MovimentoLido {
  data_local: string;
  tipo: TipoMovimento;
  descricao: string;
  codigo: string | null;
  valor_centavos: number;
  em_transito: boolean;
}

export interface ConferenciaItem {
  rotulo: string;
  declarado_centavos: number;
  lido_centavos: number;
  diferenca_centavos: number;
  confere: boolean;
}

/** Soma das posicoes lidas contra o total declarado no proprio extrato. Divergencia nunca e descartada. */
export interface Conferencia {
  soma_posicoes_centavos: number;
  total_declarado_centavos: number | null;
  /** soma - declarado; null quando o total nao foi localizado. */
  diferenca_centavos: number | null;
  /** null quando nao ha total declarado para comparar. */
  confere: boolean | null;
  /** Conferencias parciais (por mercado do sumario, totais de secao). */
  parciais: ConferenciaItem[];
}

export interface ExtratoLido {
  leitor: NomeLeitor;
  instituicao: string;
  /** Somente os ultimos 4 caracteres do identificador da conta. */
  conta: string;
  moeda: Moeda;
  periodo_inicio: string;
  periodo_fim: string;
  posicoes: PosicaoLida[];
  movimentos: MovimentoLido[];
  total_declarado_centavos: number | null;
  conferencia: Conferencia;
  /** Observacoes da leitura (linhas nao interpretadas, itens sem valor, duplicidades evitadas). */
  avisos: string[];
}

export type ResultadoLeitura = { ok: true; extrato: ExtratoLido } | { ok: false; erro: string };
