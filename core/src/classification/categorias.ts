import type { Natureza } from "../domain/types";

/** Classes do orçamento (segunda visão dos gastos, além da categoria): para onde o dinheiro vai, do ponto de vista do planejamento. */
export const CLASSES = [
  { id: "custo_fixo", rotulo: "Custo fixo", exemplos: "Aluguel, condomínio, contas da casa, feira, saúde, seguros, combustível" },
  { id: "meta", rotulo: "Meta", exemplos: "Viagens de fim de ano, presentes, pontos e doações" },
  { id: "prazeres", rotulo: "Prazeres", exemplos: "Bebidas, boteco, jantar fora, delivery, passeios" },
  { id: "eventualidade", rotulo: "Eventualidade", exemplos: "Compras diversas, pequenos eletros, pets" },
  { id: "liberdade", rotulo: "Liberdade financeira", exemplos: "Investimentos, previdência privada, parcela do apartamento" },
  { id: "conforto", rotulo: "Conforto", exemplos: "Diarista, cabelo, roupas, aplicativos de transporte, academia" },
  { id: "conhecimento", rotulo: "Conhecimento", exemplos: "Inteligência artificial, livros, audiolivros, cursos" },
] as const;
export type ClasseId = (typeof CLASSES)[number]["id"];

export interface Categoria {
  id: string;
  rotulo: string;
  /** Agrupamento para o seletor de categorias. */
  grupo: "Alimentação" | "Transporte" | "Moradia" | "Saúde" | "Lazer" | "Compras" | "Educação" | "Finanças" | "Receitas" | "Outros";
  /** Natureza assumida quando o usuário escolhe esta categoria sem informar a natureza. */
  natureza: Natureza;
  /** Classe do orçamento a que a categoria pertence por padrão (o usuário pode mudar). Nula: não entra no orçamento (transferências, receitas). */
  classe: ClasseId | null;
}

export const CATEGORIAS: Categoria[] = [
  { id: "alimentacao_supermercado", rotulo: "Supermercado", grupo: "Alimentação", natureza: "recorrente_variavel", classe: "custo_fixo" },
  { id: "alimentacao_restaurante", rotulo: "Restaurantes e lanches", grupo: "Alimentação", natureza: "eventual", classe: "prazeres" },
  { id: "alimentacao_delivery", rotulo: "Delivery", grupo: "Alimentação", natureza: "eventual", classe: "prazeres" },
  { id: "lazer_bar", rotulo: "Bares", grupo: "Alimentação", natureza: "eventual", classe: "prazeres" },
  { id: "bebidas", rotulo: "Depósito de bebidas", grupo: "Alimentação", natureza: "eventual", classe: "prazeres" },
  { id: "transporte_combustivel", rotulo: "Combustível", grupo: "Transporte", natureza: "recorrente_variavel", classe: "custo_fixo" },
  { id: "transporte_aplicativo_pedagio", rotulo: "Aplicativos, táxi e pedágio", grupo: "Transporte", natureza: "eventual", classe: "conforto" },
  { id: "transporte_manutencao", rotulo: "Manutenção do veículo", grupo: "Transporte", natureza: "eventual", classe: "eventualidade" },
  { id: "transporte_impostos", rotulo: "IPVA, licenciamento e seguro", grupo: "Transporte", natureza: "extraordinario", classe: "custo_fixo" },
  { id: "viagem", rotulo: "Viagens e hospedagem", grupo: "Transporte", natureza: "eventual", classe: "meta" },
  { id: "moradia", rotulo: "Aluguel, condomínio e IPTU", grupo: "Moradia", natureza: "fixo", classe: "custo_fixo" },
  { id: "moradia_contas", rotulo: "Energia, água, internet e telefone", grupo: "Moradia", natureza: "recorrente_variavel", classe: "custo_fixo" },
  { id: "moradia_manutencao", rotulo: "Casa e manutenção", grupo: "Moradia", natureza: "eventual", classe: "eventualidade" },
  { id: "servicos_domesticos", rotulo: "Diarista e serviços domésticos", grupo: "Moradia", natureza: "recorrente_variavel", classe: "conforto" },
  { id: "saude", rotulo: "Saúde e farmácia", grupo: "Saúde", natureza: "eventual", classe: "custo_fixo" },
  { id: "saude_plano", rotulo: "Plano de saúde e coparticipação", grupo: "Saúde", natureza: "fixo", classe: "custo_fixo" },
  { id: "saude_cabelo", rotulo: "Corte de cabelo", grupo: "Saúde", natureza: "eventual", classe: "conforto" },
  { id: "saude_academia", rotulo: "Academia e esportes", grupo: "Saúde", natureza: "assinatura", classe: "conforto" },
  { id: "lazer_assinaturas", rotulo: "Assinaturas e streaming", grupo: "Lazer", natureza: "assinatura", classe: "prazeres" },
  { id: "lazer_jogos", rotulo: "Jogos e entretenimento digital", grupo: "Lazer", natureza: "eventual", classe: "prazeres" },
  { id: "lazer_passeios", rotulo: "Passeios e eventos", grupo: "Lazer", natureza: "eventual", classe: "prazeres" },
  { id: "clube_pontos", rotulo: "Clube de pontos e milhas", grupo: "Lazer", natureza: "assinatura", classe: "meta" },
  { id: "compras_diversas", rotulo: "Compras diversas", grupo: "Compras", natureza: "eventual", classe: "eventualidade" },
  { id: "vestuario", rotulo: "Vestuário", grupo: "Compras", natureza: "eventual", classe: "conforto" },
  { id: "pets", rotulo: "Pets", grupo: "Compras", natureza: "eventual", classe: "eventualidade" },
  { id: "presentes_doacoes", rotulo: "Presentes e doações", grupo: "Compras", natureza: "eventual", classe: "meta" },
  { id: "educacao", rotulo: "Educação", grupo: "Educação", natureza: "fixo", classe: "conhecimento" },
  { id: "educacao_cursos", rotulo: "Cursos e idiomas", grupo: "Educação", natureza: "eventual", classe: "conhecimento" },
  { id: "conhecimento_ia", rotulo: "IA, livros e audiolivros", grupo: "Educação", natureza: "assinatura", classe: "conhecimento" },
  { id: "impostos_taxas", rotulo: "Impostos e taxas", grupo: "Finanças", natureza: "extraordinario", classe: "custo_fixo" },
  { id: "seguros", rotulo: "Seguros", grupo: "Finanças", natureza: "fixo", classe: "custo_fixo" },
  { id: "contribuicoes", rotulo: "Sindicato e associações", grupo: "Finanças", natureza: "fixo", classe: "custo_fixo" },
  { id: "financeiro_custos", rotulo: "Juros e tarifas", grupo: "Finanças", natureza: "divida_juros_tarifas", classe: "custo_fixo" },
  { id: "investimento", rotulo: "Investimento", grupo: "Finanças", natureza: "investimento", classe: "liberdade" },
  { id: "investimento_previdencia", rotulo: "Previdência privada", grupo: "Finanças", natureza: "investimento", classe: "liberdade" },
  { id: "investimento_apartamento", rotulo: "Parcela de apartamento", grupo: "Finanças", natureza: "investimento", classe: "liberdade" },
  { id: "resgate_investimento", rotulo: "Resgate de investimento", grupo: "Finanças", natureza: "transferencia", classe: null },
  { id: "transferencia", rotulo: "Transferência entre contas", grupo: "Finanças", natureza: "transferencia", classe: null },
  { id: "receita_trabalho", rotulo: "Salário e trabalho", grupo: "Receitas", natureza: "eventual", classe: null },
  { id: "receita_custo_vida", rotulo: "Custo de vida (recebido de outra conta sua)", grupo: "Receitas", natureza: "eventual", classe: null },
  { id: "receita_outras", rotulo: "Outras receitas", grupo: "Receitas", natureza: "eventual", classe: null },
  { id: "nao_classificado", rotulo: "Sem categoria", grupo: "Outros", natureza: "eventual", classe: null },
];

const POR_ID = new Map(CATEGORIAS.map((c) => [c.id, c]));

/** Nome legível; para categorias personalizadas (digitadas pelo usuário) formata o identificador. */
export function rotuloCategoria(id: string): string {
  const c = POR_ID.get(id);
  if (c) return c.rotulo;
  const t = id.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function naturezaPadraoDaCategoria(id: string): Natureza | null {
  return POR_ID.get(id)?.natureza ?? null;
}

/** Classe padrão da categoria (sem considerar mudanças do usuário). */
export function classePadraoDaCategoria(id: string): ClasseId | null {
  return POR_ID.get(id)?.classe ?? null;
}
