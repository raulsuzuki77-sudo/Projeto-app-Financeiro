import type { Natureza } from "../domain/types";

export interface Categoria {
  id: string;
  rotulo: string;
  /** Agrupamento para o seletor de categorias. */
  grupo: "Alimentação" | "Transporte" | "Moradia" | "Saúde" | "Lazer" | "Compras" | "Educação" | "Finanças" | "Receitas" | "Outros";
  /** Natureza assumida quando o usuário escolhe esta categoria sem informar a natureza. */
  natureza: Natureza;
}

export const CATEGORIAS: Categoria[] = [
  { id: "alimentacao_supermercado", rotulo: "Supermercado", grupo: "Alimentação", natureza: "recorrente_variavel" },
  { id: "alimentacao_restaurante", rotulo: "Restaurantes e lanches", grupo: "Alimentação", natureza: "eventual" },
  { id: "alimentacao_delivery", rotulo: "Delivery", grupo: "Alimentação", natureza: "eventual" },
  { id: "lazer_bar", rotulo: "Bares", grupo: "Alimentação", natureza: "eventual" },
  { id: "transporte_combustivel", rotulo: "Combustível", grupo: "Transporte", natureza: "recorrente_variavel" },
  { id: "transporte_aplicativo_pedagio", rotulo: "Aplicativos, táxi e pedágio", grupo: "Transporte", natureza: "eventual" },
  { id: "transporte_manutencao", rotulo: "Manutenção do veículo", grupo: "Transporte", natureza: "eventual" },
  { id: "transporte_impostos", rotulo: "IPVA, licenciamento e seguro", grupo: "Transporte", natureza: "extraordinario" },
  { id: "viagem", rotulo: "Viagens e hospedagem", grupo: "Transporte", natureza: "eventual" },
  { id: "moradia", rotulo: "Aluguel, condomínio e IPTU", grupo: "Moradia", natureza: "fixo" },
  { id: "moradia_contas", rotulo: "Energia, água, internet e telefone", grupo: "Moradia", natureza: "recorrente_variavel" },
  { id: "moradia_manutencao", rotulo: "Casa e manutenção", grupo: "Moradia", natureza: "eventual" },
  { id: "saude", rotulo: "Saúde e farmácia", grupo: "Saúde", natureza: "eventual" },
  { id: "saude_academia", rotulo: "Academia e esportes", grupo: "Saúde", natureza: "assinatura" },
  { id: "lazer_assinaturas", rotulo: "Assinaturas e streaming", grupo: "Lazer", natureza: "assinatura" },
  { id: "lazer_jogos", rotulo: "Jogos e entretenimento digital", grupo: "Lazer", natureza: "eventual" },
  { id: "lazer_passeios", rotulo: "Passeios e eventos", grupo: "Lazer", natureza: "eventual" },
  { id: "compras_diversas", rotulo: "Compras diversas", grupo: "Compras", natureza: "eventual" },
  { id: "vestuario", rotulo: "Vestuário", grupo: "Compras", natureza: "eventual" },
  { id: "pets", rotulo: "Pets", grupo: "Compras", natureza: "eventual" },
  { id: "presentes_doacoes", rotulo: "Presentes e doações", grupo: "Compras", natureza: "eventual" },
  { id: "educacao", rotulo: "Educação", grupo: "Educação", natureza: "fixo" },
  { id: "impostos_taxas", rotulo: "Impostos e taxas", grupo: "Finanças", natureza: "extraordinario" },
  { id: "seguros", rotulo: "Seguros", grupo: "Finanças", natureza: "fixo" },
  { id: "contribuicoes", rotulo: "Sindicato, associações e mútuas", grupo: "Finanças", natureza: "fixo" },
  { id: "financeiro_custos", rotulo: "Juros e tarifas", grupo: "Finanças", natureza: "divida_juros_tarifas" },
  { id: "investimento", rotulo: "Investimento", grupo: "Finanças", natureza: "investimento" },
  { id: "resgate_investimento", rotulo: "Resgate de investimento", grupo: "Finanças", natureza: "transferencia" },
  { id: "transferencia", rotulo: "Transferência entre contas", grupo: "Finanças", natureza: "transferencia" },
  { id: "receita_trabalho", rotulo: "Salário e trabalho", grupo: "Receitas", natureza: "eventual" },
  { id: "receita_outras", rotulo: "Outras receitas", grupo: "Receitas", natureza: "eventual" },
  { id: "nao_classificado", rotulo: "Sem categoria", grupo: "Outros", natureza: "eventual" },
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
