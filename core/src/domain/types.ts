export const NATUREZAS = [
  "fixo",
  "recorrente_variavel",
  "assinatura",
  "parcelado",
  "eventual",
  "extraordinario",
  "investimento",
  "divida_juros_tarifas",
  "transferencia",
  /** Crédito que reduz uma despesa (estorno, desconto, devolução): entra como entrada, mas abate a despesa da categoria. */
  "estorno",
] as const;
export type Natureza = (typeof NATUREZAS)[number];

export const TIPOS = ["despesa", "receita", "transferencia", "investimento"] as const;
export type Tipo = (typeof TIPOS)[number];

export const FORMAS_PAGAMENTO = ["pix", "debito", "credito", "dinheiro", "boleto", "outro"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export type PrecisaoHorario = "exato" | "aproximado" | "desconhecido";
export type Status = "pendente" | "confirmado" | "cancelado";
export type Origem = "whatsapp" | "texto_manual" | "manual" | "recorrente" | "parcela_prevista" | "ofx" | "csv" | "fatura_texto" | "foto" | "pdf" | "open_finance";

/** Limiar a partir do qual um lançamento é confirmado sem revisão humana. */
export const LIMIAR_CONFIANCA = 0.8;

export interface Lancamento {
  id: number;
  usuario_id: string;
  tipo: Tipo;
  valor_centavos: number;
  descricao: string;
  estabelecimento_norm: string;
  categoria: string;
  natureza: Natureza;
  forma_pagamento: FormaPagamento | null;
  cartao_id: number | null;
  conta_id: number | null;
  parcela_atual: number | null;
  parcela_total: number | null;
  ocorrido_em: string; // ISO UTC
  data_local: string; // YYYY-MM-DD no fuso do usuário
  hora_local: number | null; // 0-23
  precisao_horario: PrecisaoHorario;
  status: Status;
  confianca: number;
  hash_dedup: string;
  possivel_duplicado_de: number | null;
  motivo_revisao: string | null;
  /** Evento (viagem, férias) a que o gasto pertence, além da categoria. */
  evento_id: number | null;
  criado_em: string;
  atualizado_em: string;
}

/** Lançamento ainda não persistido, produzido por qualquer fonte de captura. */
export interface NovoLancamento {
  usuario_id: string;
  tipo: Tipo;
  valor_centavos: number;
  descricao: string;
  forma_pagamento?: FormaPagamento | null;
  cartao_id?: number | null;
  conta_id?: number | null;
  parcela_atual?: number | null;
  parcela_total?: number | null;
  data_local: string;
  hora_local?: number | null;
  precisao_horario: PrecisaoHorario;
  origem: Origem;
  /** Identificador único na origem (wamid, FITID, hash de linha): garante idempotência. */
  referencia: string;
  texto_bruto?: string;
  /** Categoria/natureza definidas pelo usuário (formulário, recorrência): dispensam a classificação automática e o lançamento nasce confirmado. */
  categoria?: string;
  natureza?: Natureza;
  /** Quando preenchido, o lançamento nasce pendente com este motivo, mesmo se a classificação for confiável. */
  alerta_revisao?: string;
  /** Crédito que abate uma despesa anterior (estorno, desconto, devolução). Grava como entrada de natureza `estorno` e classifica pela despesa de origem. */
  estorno?: boolean;
  /** Valor de cada parcela (índice 0 = parcela 1), quando as parcelas não são todas iguais (compra parcelada digitada). */
  valores_parcelas?: number[];
}
