import type { Db } from "../db/tipos";
import { resumoMensal } from "./consultas";

export type GravidadeFechamento = "impede" | "aviso" | "info";
export type AcaoFechamento = "revisar" | "sem_categoria" | "transferencias_recebidas" | "recorrentes_previstos" | "faturas" | "sobra";

export interface PendenciaDeFechamento {
  id: string;
  gravidade: GravidadeFechamento;
  titulo: string;
  detalhe: string;
  quantidade: number;
  valor_centavos: number;
  acao: AcaoFechamento | null;
}

export interface FechamentoDoMes {
  mes: string;
  receitas_centavos: number;
  resgates_centavos: number;
  despesas_centavos: number;
  aportes_centavos: number;
  /** Receitas + resgates - despesas - aportes. */
  sobra_centavos: number;
  /** O que o usuário costuma deixar na conta (por exemplo, R$ 200 a 300), definido por ele. */
  sobra_esperada_centavos: number;
  /** Sobra menos a esperada: o que NÃO está explicado. Perto de zero, o mês fecha. */
  diferenca_centavos: number;
  /** Diferença aceita para dar o mês como fechado (arredondamentos, centavos de rendimento). */
  tolerancia_centavos: number;
  fecha: boolean;
  pendencias: PendenciaDeFechamento[];
}

export const ITEM_SOBRA_ESPERADA = "__sobra_esperada";
export const TOLERANCIA_FECHAMENTO_CENTAVOS = 10000;

/**
 * Conferência de fim de mês: a conta de fechamento (receitas + resgates - despesas - aportes) comparada com a sobra que o usuário
 * espera deixar na conta, e a lista do que impede o mês de fechar: lançamentos pendentes ou sem categoria, transferências de contas
 * do próprio usuário fora das receitas, cartões sem fatura no mês, compromissos previstos que ainda não aconteceram e faturas
 * cuja soma não confere. A diferença que sobrar é mostrada como diferença, nunca absorvida por uma classe de gasto.
 */
export function fechamentoDoMes(db: Db, usuarioId: string, mes: string, hoje: string): FechamentoDoMes {
  const r = resumoMensal(db, usuarioId, mes);
  const esperada = (db.prepare("SELECT valor_centavos v FROM orcamento WHERE usuario_id = ? AND mes = '*' AND item = ?").get(usuarioId, ITEM_SOBRA_ESPERADA) as { v: number } | undefined)?.v ?? 0;
  const base = "usuario_id = ? AND status != 'cancelado' AND substr(data_local,1,7) = ?";
  const conta = (sql: string, ...a: unknown[]) => db.prepare(sql).get(usuarioId, mes, ...a) as { n: number; v: number };
  const pendencias: PendenciaDeFechamento[] = [];
  const add = (p: PendenciaDeFechamento) => { if (p.quantidade > 0 || p.valor_centavos !== 0) pendencias.push(p); };

  const semCat = conta(`SELECT COUNT(*) n, COALESCE(SUM(valor_centavos),0) v FROM lancamento WHERE ${base} AND categoria = 'nao_classificado'`);
  add({ id: "sem_categoria", gravidade: "impede", titulo: "Lançamentos sem categoria", detalhe: "Contam nos totais, mas sem classe: os percentuais e o fechamento ficam imprecisos.", quantidade: semCat.n, valor_centavos: semCat.v, acao: "sem_categoria" });

  const pend = conta(`SELECT COUNT(*) n, COALESCE(SUM(valor_centavos),0) v FROM lancamento WHERE ${base} AND status = 'pendente' AND categoria != 'nao_classificado' AND data_local <= ?`, hoje);
  add({ id: "pendentes", gravidade: "impede", titulo: "Lançamentos pendentes de revisão", detalhe: "Possível duplicidade, leitura duvidosa ou categoria sugerida que você ainda não confirmou.", quantidade: pend.n, valor_centavos: pend.v, acao: "revisar" });

  add({ id: "transferencias_recebidas", gravidade: "impede", titulo: "Pix recebido de contas suas, fora das receitas", detalhe: "Estão como transferência. Se for o seu custo de vida mensal (como o C6), reclassifique um deles como \"Custo de vida\": passa a contar como entrada e o mês fecha.", quantidade: (db.prepare(`SELECT COUNT(*) n FROM lancamento WHERE ${base} AND tipo = 'transferencia' AND categoria = 'transferencia' AND descricao LIKE 'Pix recebido%'`).get(usuarioId, mes) as { n: number }).n, valor_centavos: r.transferencias_recebidas_centavos, acao: "transferencias_recebidas" });

  const divergentes = conta(`SELECT COUNT(*) n, COALESCE(SUM(valor_centavos),0) v FROM lancamento WHERE ${base} AND status = 'pendente' AND motivo_revisao LIKE '%soma dos itens%'`);
  add({ id: "faturas_divergentes", gravidade: "impede", titulo: "Fatura cuja soma não confere com o total", detalhe: "Todos os itens dessa fatura ficaram em revisão. Confira o total e o PDF antes de dar o mês como fechado.", quantidade: divergentes.n, valor_centavos: divergentes.v, acao: "faturas" });

  // cartao com fatura em outros meses, mas nenhum lancamento neste (mes ja encerrado): fatura provavelmente nao importada
  if (mes < hoje.slice(0, 7)) {
    const cartoes = db
      .prepare(
        `SELECT c.apelido FROM cartao c WHERE c.usuario_id = ?
           AND NOT EXISTS (SELECT 1 FROM lancamento l WHERE l.cartao_id = c.id AND l.status != 'cancelado' AND substr(l.data_local,1,7) = ?)
           AND EXISTS (SELECT 1 FROM lancamento l WHERE l.cartao_id = c.id AND l.status != 'cancelado' AND substr(l.data_local,1,7) != ?)`,
      )
      .all(usuarioId, mes, mes) as { apelido: string }[];
    for (const c of cartoes) add({ id: `cartao_${c.apelido}`, gravidade: "aviso", titulo: `Cartão ${c.apelido} sem lançamentos no mês`, detalhe: "Há lançamentos desse cartão em outros meses, mas nenhum neste: a fatura pode não ter sido importada.", quantidade: 1, valor_centavos: 0, acao: "faturas" });
  }

  const previstos = conta(
    `SELECT COUNT(*) n, COALESCE(SUM(valor_centavos),0) v FROM lancamento l WHERE ${base} AND l.data_local <= ? AND l.tipo = 'despesa'
       AND EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = l.id AND o.origem = 'recorrente')
       AND NOT EXISTS (SELECT 1 FROM lancamento_origem o2 WHERE o2.lancamento_id = l.id AND o2.origem != 'recorrente')`,
    hoje,
  );
  add({ id: "recorrentes_previstos", gravidade: "aviso", titulo: "Compromissos previstos sem lançamento real", detalhe: "Entraram por recorrência e nenhum extrato ou fatura os confirmou ainda: podem não ter sido pagos neste valor.", quantidade: previstos.n, valor_centavos: previstos.v, acao: "recorrentes_previstos" });

  const sobra = r.saldo_centavos;
  const diferenca = sobra - esperada;
  const fecha = Math.abs(diferenca) <= TOLERANCIA_FECHAMENTO_CENTAVOS && !pendencias.some((p) => p.gravidade === "impede");
  if (Math.abs(diferenca) > TOLERANCIA_FECHAMENTO_CENTAVOS) {
    add({ id: "diferenca", gravidade: "impede", titulo: "Diferença não explicada na conta", detalhe: `A sobra do mês (${(sobra / 100).toFixed(2).replace(".", ",")}) é diferente da que você espera deixar na conta. Resolva as pendências acima; o que restar é entrada ou saída que não foi lançada.`, quantidade: 1, valor_centavos: diferenca, acao: "sobra" });
  }
  return {
    mes, receitas_centavos: r.receitas_centavos, resgates_centavos: r.resgates_centavos, despesas_centavos: r.despesas_centavos, aportes_centavos: r.investimentos_centavos,
    sobra_centavos: sobra, sobra_esperada_centavos: esperada, diferenca_centavos: diferenca, tolerancia_centavos: TOLERANCIA_FECHAMENTO_CENTAVOS, fecha, pendencias,
  };
}
