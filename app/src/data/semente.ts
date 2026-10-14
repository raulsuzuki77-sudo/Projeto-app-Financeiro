import { criarCartao, criarEvento, criarMeta, criarRecorrencia, definirOrcamento, ITEM_RECEITA, paraLocal, registrarLancamento, salvarPremissa, somarDias, type Db } from "../../../core/src/index";

/** Dados FICTÍCIOS para a prévia web: nada daqui vem de contas reais. */
export function semearDemonstracao(db: Db): void {
  const U = "local";
  const hoje = paraLocal(new Date()).data_local;
  const mes = hoje.slice(0, 7);
  criarCartao(db, U, { apelido: "nomad", ultimos4: "4321" });
  criarCartao(db, U, { apelido: "nubank", ultimos4: "9876" });
  let n = 0;
  const g = (diasAtras: number, hora: number | null, valor: number, desc: string, categoria?: string, tipo: "despesa" | "receita" = "despesa", cartao: number | null = 1) => {
    const data = somarDias(hoje, -diasAtras);
    if (data.slice(0, 7) !== mes) return;
    registrarLancamento(db, {
      usuario_id: U, tipo, valor_centavos: valor, descricao: desc, categoria, forma_pagamento: cartao ? "credito" : "pix", cartao_id: cartao,
      data_local: data, hora_local: hora, precisao_horario: hora === null ? "desconhecido" : "exato", origem: "csv", referencia: `demo-${++n}`,
    });
  };
  g(1, 19, 18740, "Assaí Atacadista", "alimentacao_supermercado");
  g(1, 13, 4290, "Restaurante Sabor da Vila", "alimentacao_restaurante");
  g(2, 20, 7742, "IFD*Mão de Vaca Burger", "alimentacao_delivery");
  g(2, 8, 12000, "Auto Posto Crimeia", "transporte_combustivel");
  g(3, 21, 22468, "Botequim Mercatto", "lazer_bar");
  g(3, 10, 21516, "Drogasil 2346", "saude");
  g(4, 18, 5590, "Netflix", "lazer_assinaturas");
  g(4, 12, 16500, "Alamoa Fitnes", "saude_academia");
  g(5, 15, 24500, "Ferragista Aliança", "moradia_manutencao");
  g(5, 9, 5190, "Bacio di Latte", "alimentacao_restaurante");
  g(6, 19, 41659, "Assaí Atacadista", "alimentacao_supermercado");
  g(7, 11, 4560, "Expresso Caipira", "alimentacao_restaurante");
  g(8, 14, 33003, "Posto Shopping", "transporte_combustivel");
  g(9, 22, 21450, "Bar do Cuscuz", "lazer_bar");
  g(10, 16, 6600, "Uber *Trip", "transporte_aplicativo_pedagio");
  g(10, null, 350000, "Salário", "receita_trabalho", "receita", null);
  // pendentes (sem categoria): demonstram a tela de revisão
  g(0, 17, 6400, "Sorveteria Era do Gelo");
  g(0, 17, 5150, "PTY*MISTURA FINA");
  g(1, null, 8000, "ZZ Comercial 118");
  g(2, null, 3700, "ZZ Comercial 204");
  g(2, null, 1600, "Trilhas da Amazônia");
  criarRecorrencia(db, U, { descricao: "Aluguel", valor_centavos: 180000, dia_mes: 5, categoria: "moradia", inicio_mes: mes }, hoje);
  criarRecorrencia(db, U, { descricao: "Spotify", valor_centavos: 2190, dia_mes: 10, inicio_mes: mes }, hoje);
  criarMeta(db, U, { nome: "Reserva de emergência", tipo: "reserva_emergencia", valor_alvo_centavos: 3000000, aporte_inicial_centavos: 500000, prazo_meses: 18, perfil: "conservador" });
  criarMeta(db, U, { nome: "Viagem", tipo: "curto_prazo", valor_alvo_centavos: 1200000, aporte_inicial_centavos: 0, prazo_meses: 12, perfil: "moderado" });
  salvarPremissa(db, U, { chave: "moderado", retorno_nominal_aa: 0.1 });

  // Dois meses anteriores (fictícios): permitem ver gastos de meses passados, recorrências detectadas, evento e orçamento.
  const mesAnterior = (n: number) => { const d = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 1 - n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const h = (n: number, dia: number, valor: number, desc: string, categoria: string, tipo: "despesa" | "receita" | "investimento" = "despesa") =>
    registrarLancamento(db, { usuario_id: U, tipo, valor_centavos: valor, descricao: desc, categoria, forma_pagamento: "pix", data_local: `${mesAnterior(n)}-${String(dia).padStart(2, "0")}`, hora_local: null, precisao_horario: "desconhecido", origem: "csv", referencia: `demo-h-${n}-${++n2}` });
  let n2 = 0;
  for (const n of [1, 2]) {
    h(n, 5, 180000, "Aluguel", "moradia");
    h(n, 8, 21900, "Spotify", "lazer_assinaturas");
    h(n, 10, 12990, "Clube Livelo", "clube_pontos");
    h(n, 12, 69800 + n * 900, "Condomínio Residencial", "moradia");
    h(n, 15, 45000 + n * 3000, "Assaí Atacadista", "alimentacao_supermercado");
    h(n, 18, 9800, "Restaurante Sabor da Vila", "alimentacao_restaurante");
    h(n, 20, 15000, "Aporte previdência", "investimento_previdencia", "investimento");
    h(n, 25, 520000, "Salário", "receita_trabalho", "receita");
  }
  // Viagem sem evento no mês atual (a tela pergunta o período) e férias no mês anterior (com evento).
  const dd = (dia: number) => `${mes}-${String(Math.min(dia, 28)).padStart(2, "0")}`;
  registrarLancamento(db, { usuario_id: U, tipo: "despesa", valor_centavos: 89000, descricao: "Passagem aérea Azul", categoria: "viagem", forma_pagamento: "credito", data_local: dd(3), hora_local: null, precisao_horario: "desconhecido", origem: "csv", referencia: "demo-viagem-atual" });
  for (const [dia, valor, desc, cat] of [[10, 76000, "Pousada Brisa", "viagem"], [11, 18500, "Restaurante Mar Azul", "alimentacao_restaurante"], [12, 9200, "Passeio de buggy", "lazer_passeios"], [14, 14300, "Bar Pôr do Sol", "lazer_bar"]] as [number, number, string, string][]) h(1, dia, valor, desc, cat);
  criarEvento(db, U, { nome: "Férias em Jericoacoara", tipo: "ferias", data_inicio: `${mesAnterior(1)}-10`, data_fim: `${mesAnterior(1)}-16`, vincular: true });
  // Orçamento (valores fictícios): padrão de todos os meses e receita
  const plano: [string, number][] = [[ITEM_RECEITA, 520000], ["moradia", 250000], ["alimentacao_supermercado", 50000], ["alimentacao_restaurante", 20000], ["lazer_assinaturas", 3000], ["clube_pontos", 13000], ["investimento_previdencia", 15000], ["transporte_combustivel", 30000], ["viagem", 40000], ["saude", 15000]];
  for (const [item, v] of plano) definirOrcamento(db, U, "*", item, v);
}
