import type { Natureza } from "../domain/types";

export interface RegraBase {
  /** Termos (já normalizados) que, se presentes na descrição normalizada, acionam a regra. */
  termos: string[];
  categoria: string;
  natureza: Natureza;
}

export const REGRAS_BASE: RegraBase[] = [
  { termos: ["drogasil", "droga raia", "drogaria", "farmacia", "pacheco", "pague menos"], categoria: "saude", natureza: "eventual" },
  { termos: ["assai", "atacadista", "supermercado", "mercado", "mercadinho", "carrefour", "extra hiper", "hortifruti", "acougue"], categoria: "alimentacao_supermercado", natureza: "recorrente_variavel" },
  { termos: ["posto", "auto posto", "combustivel", "gasolina", "etanol", "shell", "ipiranga"], categoria: "transporte_combustivel", natureza: "recorrente_variavel" },
  { termos: ["ifd", "ifood", "rappi", "delivery"], categoria: "alimentacao_delivery", natureza: "eventual" },
  { termos: ["restaurante", "lanchonete", "pizzaria", "burger", "padaria", "cafe", "bacio di latte", "sorveteria", "doceria", "doces", "almoco", "jantar", "lanche"], categoria: "alimentacao_restaurante", natureza: "eventual" },
  { termos: ["bar", "botequim", "choppana", "choperia", "cervejaria"], categoria: "lazer_bar", natureza: "eventual" },
  { termos: ["academia", "fitness", "fitnes", "crossfit", "pilates"], categoria: "saude_academia", natureza: "assinatura" },
  { termos: ["netflix", "spotify", "disney", "hbo", "prime video", "youtube premium", "icloud", "apple com bill", "assinatura"], categoria: "lazer_assinaturas", natureza: "assinatura" },
  { termos: ["uber", "99 pop", "99app", "taxi", "estacionamento", "pedagio", "sem parar"], categoria: "transporte_aplicativo_pedagio", natureza: "eventual" },
  { termos: ["ferragista", "ferragens", "leroy", "construcao", "tintas"], categoria: "moradia_manutencao", natureza: "eventual" },
  { termos: ["aluguel", "condominio", "iptu"], categoria: "moradia", natureza: "fixo" },
  { termos: ["energia", "enel", "equatorial", "neoenergia", "saneago", "sabesp", "agua"], categoria: "moradia_contas", natureza: "recorrente_variavel" },
  { termos: ["internet", "claro", "vivo", "tim", "oi fibra", "telefone"], categoria: "moradia_contas", natureza: "fixo" },
  { termos: ["escola", "faculdade", "curso", "mensalidade"], categoria: "educacao", natureza: "fixo" },
  { termos: ["plano de saude", "unimed", "amil", "hapvida"], categoria: "saude", natureza: "fixo" },
  { termos: ["ipva", "licenciamento", "seguro auto"], categoria: "transporte_impostos", natureza: "extraordinario" },
  { termos: ["juros", "iof", "tarifa", "anuidade", "multa", "mora", "encargos"], categoria: "financeiro_custos", natureza: "divida_juros_tarifas" },
  { termos: ["salario", "pro labore", "rendimento"], categoria: "receita_trabalho", natureza: "eventual" },
  { termos: ["tesouro", "cdb", "lci", "lca", "fundo", "acoes", "aporte"], categoria: "investimento", natureza: "investimento" },
  { termos: ["pagamento de fatura", "pagamento fatura", "pgto fatura", "pagto fatura", "pagamento recebido"], categoria: "transferencia_fatura", natureza: "transferencia" },
];
