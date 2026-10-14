import type { Natureza } from "../domain/types";

export interface RegraBase {
  /** Termos (já normalizados: minúsculas, sem acento) que, presentes como palavra(s) inteira(s) na descrição, acionam a regra. */
  termos: string[];
  categoria: string;
  natureza: Natureza;
}

/** A ordem importa: a primeira regra que casar vence. Regras mais específicas vêm antes. */
export const REGRAS_BASE: RegraBase[] = [
  { termos: ["resgate rdb", "resgate cdb", "resgate"], categoria: "resgate_investimento", natureza: "transferencia" },
  // Boleto da fatura de outro cartao: as compras vem da propria fatura; contar o boleto tambem duplicaria o gasto.
  { termos: ["nomad tecnologia"], categoria: "transferencia", natureza: "transferencia" },
  { termos: ["pagamento de fatura", "pagamento fatura", "pgto fatura", "pagto fatura", "pagamento recebido", "pag fatura"], categoria: "transferencia", natureza: "transferencia" },
  { termos: ["juros", "iof", "tarifa", "anuidade", "multa", "mora", "encargos", "seguro fatura"], categoria: "financeiro_custos", natureza: "divida_juros_tarifas" },
  { termos: ["ipva", "licenciamento", "detran", "seguro auto"], categoria: "transporte_impostos", natureza: "extraordinario" },
  { termos: ["darf", "receita federal", "prefeitura", "municipio", "taxa municipal", "tributo", "tributos", "das simples", "simples nacional", "inss"], categoria: "impostos_taxas", natureza: "extraordinario" },
  { termos: ["salario", "pro labore", "13o salario", "ferias", "folha de pagamento"], categoria: "receita_trabalho", natureza: "eventual" },
  { termos: ["icatu", "allianz", "seguros", "seguro"], categoria: "seguros", natureza: "fixo" },
  { termos: ["sindicato", "sercon", "mutua", "associacao"], categoria: "contribuicoes", natureza: "fixo" },
  { termos: ["tesouro", "rdb", "aplicacao", "avenue", "cdb", "lci", "lca", "fundo", "acoes", "aporte", "corretora", "previdencia", "previdncia", "btg pactual vida", "nuinvest", "xp investimentos", "rico investimentos"], categoria: "investimento", natureza: "investimento" },

  { termos: ["ifd", "ifood", "rappi", "delivery", "uber eats", "aiqfome", "99food", "99 food", "keeta"], categoria: "alimentacao_delivery", natureza: "eventual" },
  { termos: ["drogasil", "droga raia", "raia", "drogaria", "farmacia", "pacheco", "pague menos", "panvel", "drogal", "onofre", "ultrafarma", "clinica", "hospital", "laboratorio", "consulta", "dentista", "odonto", "odontologia", "medico", "fisioterapia", "psicologo", "psicologa", "otica", "exame", "exames", "vacina", "hemocare"], categoria: "saude", natureza: "eventual" },
  { termos: ["plano de saude", "unimed", "amil", "hapvida", "bradesco saude", "sulamerica"], categoria: "saude", natureza: "fixo" },
  { termos: ["academia", "fitness", "fitnes", "crossfit", "pilates", "smartfit", "smart fit", "bluefit", "bodytech", "personal trainer"], categoria: "saude_academia", natureza: "assinatura" },
  { termos: ["netflix", "spotify", "disney", "disney plus", "hbo", "prime video", "amazon prime", "youtube premium", "youtube", "icloud", "apple com bill", "google one", "google storage", "deezer", "globoplay", "paramount", "crunchyroll", "canva", "openai", "chatgpt", "anthropic", "claude", "dropbox", "adobe", "notion", "livelo", "amazonprimebr", "dl google", "assinatura"], categoria: "lazer_assinaturas", natureza: "assinatura" },
  { termos: ["playstation", "steam", "xbox", "nintendo", "ebn"], categoria: "lazer_jogos", natureza: "eventual" },
  { termos: ["cinema", "cinemark", "kinoplex", "ingresso", "ingressos", "sympla", "eventim", "teatro", "show", "parque", "museu", "trilhas", "turismo", "passeio", "boliche"], categoria: "lazer_passeios", natureza: "eventual" },
  { termos: ["latam", "gol", "azul linhas", "decolar", "booking", "airbnb", "hotel", "pousada", "hostel", "123milhas", "maxmilhas", "rodoviaria", "buser", "clickbus", "hospedagem"], categoria: "viagem", natureza: "eventual" },

  { termos: ["assai", "atacadao", "atacadista", "supermercado", "supermercados", "mercado", "mercadinho", "mercantil", "hipermercado", "carrefour", "extra", "pao de acucar", "big", "bretas", "super", "distribuidora de carne", "hortifruti", "sacolao", "acougue", "emporio", "quitanda", "sams club", "makro", "natural da terra"], categoria: "alimentacao_supermercado", natureza: "recorrente_variavel" },
  { termos: ["restaurante", "lanchonete", "pizzaria", "pizza", "burger", "hamburgueria", "padaria", "panificadora", "cafe", "cafeteria", "bacio di latte", "sorveteria", "sorvete", "doceria", "doces", "confeitaria", "almoco", "jantar", "lanche", "churrascaria", "espetinho", "sushi", "temakeria", "pastelaria", "acai", "mcdonalds", "burger king", "bobs", "subway", "outback", "giraffas", "habibs", "spoleto", "starbucks", "cacau show", "kopenhagen", "expresso"], categoria: "alimentacao_restaurante", natureza: "eventual" },
  { termos: ["bar", "botequim", "botequins", "choppana", "choperia", "cervejaria", "pub", "boteco", "adega"], categoria: "lazer_bar", natureza: "eventual" },

  { termos: ["posto", "auto posto", "combustivel", "combustiveis", "gasolina", "etanol", "shell", "ipiranga", "petrobras", "br mania", "raizen"], categoria: "transporte_combustivel", natureza: "recorrente_variavel" },
  { termos: ["uber", "uberrides", "99 pop", "99app", "99 tecnologia", "taxi", "cabify", "estacionamento", "estapar", "pedagio", "sem parar", "conectcar", "veloe", "metro", "cptm"], categoria: "transporte_aplicativo_pedagio", natureza: "eventual" },
  { termos: ["oficina", "mecanica", "mecanico", "auto pecas", "autopecas", "pneu", "pneus", "borracharia", "lava jato", "lavagem", "funilaria"], categoria: "transporte_manutencao", natureza: "eventual" },

  { termos: ["aluguel", "condominio", "iptu", "imobiliaria"], categoria: "moradia", natureza: "fixo" },
  { termos: ["energia", "enel", "equatorial", "neoenergia", "cemig", "copel", "celg", "saneago", "sabesp", "agua", "esgoto", "comgas", "gas natural", "consigaz", "ultragaz", "liquigas"], categoria: "moradia_contas", natureza: "recorrente_variavel" },
  { termos: ["internet", "claro", "vivo", "tim", "oi fibra", "telefone", "algar", "net virtua"], categoria: "moradia_contas", natureza: "fixo" },
  { termos: ["ferragista", "materiais hidraulicos", "materiais eletricos", "materiais de construcao", "ferragens", "ferragem", "leroy", "construcao", "tintas", "madeireira", "telhanorte", "eletrica", "marcenaria", "vidracaria"], categoria: "moradia_manutencao", natureza: "eventual" },

  { termos: ["escola", "faculdade", "curso", "mensalidade", "colegio", "udemy", "alura", "livraria", "papelaria", "universidade"], categoria: "educacao", natureza: "fixo" },
  { termos: ["petz", "cobasi", "pet love", "petlove", "petshop", "pet shop", "veterinaria", "veterinario"], categoria: "pets", natureza: "eventual" },
  { termos: ["renner", "riachuelo", "c a", "zara", "marisa", "hering", "inditex", "arezzo", "centauro", "netshoes", "calcados", "moda", "boutique", "vestuario"], categoria: "vestuario", natureza: "eventual" },
  { termos: ["floricultura", "flores", "presente", "doacao", "igreja", "arquidiocese", "paroquia", "dizimo"], categoria: "presentes_doacoes", natureza: "eventual" },
  { termos: ["amazon", "mercado livre", "mercadolivre", "amazonmktplc", "shopee", "aliexpress", "magalu", "magazine luiza", "americanas", "casas bahia", "shein", "kabum"], categoria: "compras_diversas", natureza: "eventual" },
];
