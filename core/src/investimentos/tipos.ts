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

/** Rentabilidade de um fundo (previdencia) no extrato: percentuais como no documento (1,07 = 1,07%). */
export interface RentabilidadeFundo {
  benchmark: string | null;
  fundo_mes: number | null;
  benchmark_mes: number | null;
  fundo_ano: number | null;
  benchmark_ano: number | null;
  fundo_12m: number | null;
  benchmark_12m: number | null;
}

/** Linha de "posicoes abertas por aliquota" (previdencia regressiva): quanto do saldo esta em cada aliquota de IR. */
export interface LoteAliquota {
  /** Em percentual (35 = 35%). */
  aliquota: number;
  cotas: number;
  liquido_centavos: number;
  ir_centavos: number;
  bruto_centavos: number;
}

/** Dados extras de uma posicao, guardados como JSON. Tudo opcional: so entra o que o documento trouxe. */
export interface DetalhePosicao {
  /** Previdencia: produto (PGBL, VGBL) e data de referencia da cota. */
  produto?: string;
  regime?: string;
  data_referencia?: string;
  rentabilidade?: RentabilidadeFundo;
  aliquotas?: LoteAliquota[];
  valor_liquido_centavos?: number;
  ir_centavos?: number;
  /** Fundos listados: tipo (FII). */
  tipo?: string;
  /** Setor atribuido pela leitura (conciliando a distribuicao setorial do extrato com os saldos). */
  setor?: string;
  setor_origem?: "extrato";
  /** Valores em transito: data de liquidacao, quando informada. */
  data_liquidacao?: string | null;
  /** Renda fixa estrangeira: vencimento (ISO) e cupom (% a.a.). */
  vencimento?: string;
  cupom?: number;
  /** Conta estrangeira: texto original da descricao, tipo de conta e ganho/perda do proprio extrato (so quando ha custo). */
  descricao_original?: string;
  tipo_conta?: string;
  gain_loss_extrato_centavos?: number;
  /** valor = quantidade x preco x fator (titulos cotados por 100 de valor de face tem fator 0,01). */
  fator_preco?: number;
}

export interface PosicaoLida {
  /** Genero da hierarquia (previdencia, renda variavel, renda fixa, caixa, transito, outros). */
  classe_ativo: ClasseAtivo;
  ativo: string;
  codigo: string | null;
  quantidade: number | null;
  /** Saldo bruto na moeda do extrato, em centavos. Pode ser negativo (valores em transito). */
  valor_centavos: number;
  /** Especie dentro do genero (Acoes, ETFs, Fundos listados, PGBL, Treasury Bills...). */
  especie?: string | null;
  cnpj?: string | null;
  /** Preco de fechamento / cotacao atual / preco de mercado, na moeda do extrato (unidade, nao centavos). */
  preco_fechamento?: number | null;
  /** Preco medio; null = o documento nao informa (um "-" no extrato). Nunca zero. */
  preco_medio?: number | null;
  /** Custo total na moeda do extrato, em centavos; null = nao informado (custo 0,00 de transferencia ACATS tambem e nao informado). */
  custo_total_centavos?: number | null;
  detalhe?: DetalhePosicao | null;
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
  /** Quantidade (acoes, cotas, titulos) e preco unitario do movimento, quando o extrato traz. */
  quantidade?: number | null;
  preco?: number | null;
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

/** Linha da "Distribuicao Setorial" do extrato: percentual (42,39 = 42,39%) das acoes, como no documento. */
export interface SetorPercentual {
  setor: string;
  pct: number;
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
  /** Distribuicao setorial das acoes, como veio no extrato (guardada por extrato). */
  distribuicao_setorial?: SetorPercentual[];
  /** Observacoes da leitura (linhas nao interpretadas, itens sem valor, duplicidades evitadas). */
  avisos: string[];
}

export type ResultadoLeitura = { ok: true; extrato: ExtratoLido } | { ok: false; erro: string };
