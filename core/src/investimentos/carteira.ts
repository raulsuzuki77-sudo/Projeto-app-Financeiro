import type { Db } from "../db/tipos";
import { mapaCadastro } from "./cadastro";
import { exposicaoPadrao, setorPadrao, type Exposicao } from "./dicionario";
import { patrimonio, type Patrimonio, type PosicaoPatrimonio } from "./servico";
import { ROTULO_CLASSE, type ClasseAtivo, type DetalhePosicao, type TipoMovimento } from "./tipos";

/**
 * Carteira: o patrimonio do mes em hierarquia genero > especie > ativo, com preco medio, resultado, setor, exposicao e
 * movimentos do mes por ativo, mais tres pizzas (genero/especie, setor, nacional x estrangeira) que dizem a base que usam.
 * Os totais de cada nivel somam exatamente o patrimonio total (em reais).
 */

export type GeneroId = ClasseAtivo | "meta";

export const ROTULO_GENERO: Record<GeneroId, string> = { ...ROTULO_CLASSE, meta: "Meta (reserva e provisões)" };
/** Ordem de leitura dos generos. */
export const ORDEM_GENERO: GeneroId[] = ["previdencia", "renda_variavel", "renda_fixa", "meta", "caixa", "transito", "outros"];

const ESPECIE_PADRAO: Record<ClasseAtivo, string> = {
  previdencia: "Previdência",
  renda_variavel: "Renda variável",
  renda_fixa: "Renda fixa",
  caixa: "Caixa",
  transito: "Valores em trânsito",
  outros: "Outros",
};

export interface MovimentoDoAtivo {
  id: number;
  data_local: string;
  tipo: TipoMovimento;
  descricao: string;
  quantidade: number | null;
  preco: number | null;
  /** Na moeda do extrato (compra, venda, deposito e aporte em modulo; provento com o sinal do extrato). */
  valor_centavos: number;
  em_transito: boolean;
}

export type OrigemInfo = "extrato" | "informado" | "informada" | "padrao" | null;

export interface ItemCarteira {
  id: number;
  extrato_id: number | null;
  chave: string;
  genero: GeneroId;
  classe_ativo: ClasseAtivo;
  especie: string;
  especie_origem: "informada" | "extrato" | "padrao";
  ativo: string;
  codigo: string | null;
  cnpj: string | null;
  instituicao: string;
  conta: string;
  moeda: string;
  origem: string;
  quantidade: number | null;
  /** Preco de fechamento / cotacao na moeda do ativo (unidade). */
  preco_fechamento: number | null;
  preco_medio: number | null;
  preco_medio_origem: "extrato" | "informado" | null;
  /** valor = quantidade x preco x fator (titulos cotados por 100 de face: 0,01). */
  fator_preco: number;
  saldo_original_centavos: number;
  /** Custo total informado pelo extrato (conta estrangeira), na moeda do ativo; null = nao informado. */
  custo_total_original_centavos: number | null;
  /** Em reais; null sem taxa de cambio (fica fora dos totais). */
  saldo_centavos: number | null;
  /** Saldo bruto - quantidade x preco medio, na moeda do ativo; null sem preco medio (nunca zero por falta de dado). */
  resultado_original_centavos: number | null;
  resultado_pct: number | null;
  resultado_centavos: number | null;
  setor: string | null;
  setor_origem: "informado" | "extrato" | "padrao" | null;
  exposicao: Exposicao;
  exposicao_origem: "informada" | "padrao";
  meta: boolean;
  defasado: boolean;
  mes_snapshot: string;
  detalhe: DetalhePosicao;
  movimentos: MovimentoDoAtivo[];
}

export interface EspecieCarteira {
  especie: string;
  total_centavos: number;
  itens: ItemCarteira[];
}

export interface GeneroCarteira {
  id: GeneroId;
  rotulo: string;
  total_centavos: number;
  especies: EspecieCarteira[];
}

export interface Carteira {
  mes: string;
  total_centavos: number;
  meta_centavos: number;
  liberdade_centavos: number;
  generos: GeneroCarteira[];
  itens: ItemCarteira[];
  /** Itens em moeda estrangeira sem taxa de cambio: aparecem, mas ficam fora dos totais. */
  sem_cambio: ItemCarteira[];
  patrimonio: Patrimonio;
}

const arred = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

interface LinhaMovimento {
  id: number;
  extrato_id: number;
  data_local: string;
  tipo: TipoMovimento;
  descricao: string;
  codigo: string | null;
  valor_centavos: number;
  em_transito: number;
  quantidade: number | null;
  preco: number | null;
}

/** Monta a carteira do mes a partir do patrimonio, do cadastro dos ativos e dos movimentos dos extratos. */
export function montarCarteira(db: Db, usuarioId: string, mes: string): Carteira {
  const pat = patrimonio(db, usuarioId, mes);
  const cadastro = mapaCadastro(db, usuarioId);
  const taxaDaConta = new Map<string, number>();
  for (const c of pat.contas) taxaDaConta.set(`${c.instituicao}\u0000${c.conta}\u0000${c.moeda}`, c.moeda === "BRL" ? 10000 : (c.taxa_x10000 ?? 0));

  const extratos = [...new Set(pat.posicoes.map((p) => p.extrato_id).filter((x): x is number => x !== null))];
  const porExtratoCodigo = new Map<string, MovimentoDoAtivo[]>();
  if (extratos.length > 0) {
    const lm = db
      .prepare(`SELECT id, extrato_id, data_local, tipo, descricao, codigo, valor_centavos, em_transito, quantidade, preco FROM movimento_investimento WHERE usuario_id = ? AND extrato_id IN (${extratos.map(() => "?").join(",")}) AND codigo IS NOT NULL ORDER BY data_local, id`)
      .all(usuarioId, ...extratos) as LinhaMovimento[];
    for (const m of lm) {
      const k = `${m.extrato_id}\u0000${m.codigo}`;
      const l = porExtratoCodigo.get(k) ?? [];
      l.push({ id: m.id, data_local: m.data_local, tipo: m.tipo, descricao: m.descricao, quantidade: m.quantidade, preco: m.preco, valor_centavos: m.valor_centavos, em_transito: m.em_transito === 1 });
      porExtratoCodigo.set(k, l);
    }
  }

  const itens: ItemCarteira[] = pat.posicoes.map((p) => itemDe(p, cadastro, taxaDaConta, porExtratoCodigo));

  const generos: GeneroCarteira[] = [];
  for (const id of ORDEM_GENERO) {
    const doGenero = itens.filter((i) => i.genero === id);
    if (doGenero.length === 0) continue;
    const porEspecie = new Map<string, ItemCarteira[]>();
    for (const i of doGenero) porEspecie.set(i.especie, [...(porEspecie.get(i.especie) ?? []), i]);
    const especies: EspecieCarteira[] = [...porEspecie.entries()]
      .map(([especie, lista]) => ({
        especie,
        total_centavos: lista.reduce((s, i) => s + (i.saldo_centavos ?? 0), 0),
        itens: [...lista].sort((a, b) => (b.saldo_centavos ?? -Infinity) - (a.saldo_centavos ?? -Infinity) || a.ativo.localeCompare(b.ativo, "pt-BR")),
      }))
      .sort((a, b) => Math.abs(b.total_centavos) - Math.abs(a.total_centavos) || a.especie.localeCompare(b.especie, "pt-BR"));
    generos.push({ id, rotulo: ROTULO_GENERO[id], total_centavos: especies.reduce((s, e) => s + e.total_centavos, 0), especies });
  }
  return {
    mes,
    total_centavos: pat.total_centavos,
    meta_centavos: pat.meta_centavos,
    liberdade_centavos: pat.liberdade_centavos,
    generos,
    itens,
    sem_cambio: itens.filter((i) => i.saldo_centavos === null),
    patrimonio: pat,
  };
}

function itemDe(p: PosicaoPatrimonio, cadastro: ReturnType<typeof mapaCadastro>, taxas: Map<string, number>, movs: Map<string, MovimentoDoAtivo[]>): ItemCarteira {
  const cad = cadastro.get(p.chave);
  const transito = p.classe_ativo === "transito";
  const especie = cad?.especie ?? p.especie ?? ESPECIE_PADRAO[p.classe_ativo];
  const especie_origem = cad?.especie ? "informada" : p.especie ? "extrato" : "padrao";

  let setor: string | null = null;
  let setor_origem: ItemCarteira["setor_origem"] = null;
  if (!transito) {
    if (cad?.setor) { setor = cad.setor; setor_origem = "informado"; }
    else if (p.detalhe.setor) { setor = p.detalhe.setor; setor_origem = "extrato"; }
    else if (p.classe_ativo === "renda_variavel" && setorPadrao(p.codigo)) { setor = setorPadrao(p.codigo); setor_origem = "padrao"; }
  }

  // valores em transito e caixa seguem a moeda da conta (uma compra pendente de ETF estrangeiro ainda e dinheiro em reais)
  const exposicao: Exposicao = cad?.exposicao ?? exposicaoPadrao(transito || p.classe_ativo === "caixa" ? null : p.codigo, p.moeda);
  const exposicao_origem = cad?.exposicao ? "informada" : "padrao";

  const fator = p.detalhe.fator_preco && p.detalhe.fator_preco > 0 ? p.detalhe.fator_preco : 1;
  const preco_medio = p.preco_medio !== null && p.preco_medio > 0 ? p.preco_medio : (cad?.preco_medio ?? null);
  const preco_medio_origem: ItemCarteira["preco_medio_origem"] = p.preco_medio !== null && p.preco_medio > 0 ? "extrato" : cad?.preco_medio != null ? "informado" : null;

  let resultado_original: number | null = null;
  let resultado_pct: number | null = null;
  const comResultado = p.classe_ativo !== "caixa" && p.classe_ativo !== "transito" && p.quantidade !== null && p.quantidade > 0 && preco_medio !== null;
  if (comResultado) {
    // custo informado pelo extrato (conta estrangeira) tem precedencia; senao, quantidade x preco medio
    const custo = preco_medio_origem === "extrato" && p.custo_total_centavos !== null && p.custo_total_centavos > 0 ? p.custo_total_centavos : Math.round(p.quantidade! * preco_medio! * fator * 100);
    if (custo > 0) {
      resultado_original = p.valor_original_centavos - custo;
      resultado_pct = resultado_original / custo;
    }
  }
  const taxa = taxas.get(`${p.instituicao}\u0000${p.conta}\u0000${p.moeda}`);
  const resultado_brl = resultado_original === null ? null : p.moeda === "BRL" ? resultado_original : taxa ? arred((resultado_original * taxa) / 10000) : null;

  const genero: GeneroId = p.meta ? "meta" : p.classe_ativo;
  return {
    id: p.id,
    extrato_id: p.extrato_id,
    chave: p.chave,
    genero,
    classe_ativo: p.classe_ativo,
    especie,
    especie_origem,
    ativo: p.ativo,
    codigo: p.codigo,
    cnpj: p.cnpj,
    instituicao: p.instituicao,
    conta: p.conta,
    moeda: p.moeda,
    origem: p.origem,
    quantidade: p.quantidade,
    preco_fechamento: p.preco_fechamento,
    preco_medio,
    preco_medio_origem,
    fator_preco: fator,
    saldo_original_centavos: p.valor_original_centavos,
    custo_total_original_centavos: p.custo_total_centavos,
    saldo_centavos: p.valor_centavos,
    resultado_original_centavos: resultado_original,
    resultado_pct,
    resultado_centavos: resultado_brl,
    setor,
    setor_origem,
    exposicao,
    exposicao_origem,
    meta: p.meta,
    defasado: p.defasado,
    mes_snapshot: p.mes_snapshot,
    detalhe: p.detalhe,
    movimentos: p.extrato_id !== null && p.codigo && !transito ? (movs.get(`${p.extrato_id}\u0000${p.codigo}`) ?? []) : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Pizzas
// ---------------------------------------------------------------------------------------------

export interface FatiaPizza {
  id: string;
  rotulo: string;
  valor: number;
}

export interface PizzaCarteira {
  id: "genero" | "setor" | "origem";
  titulo: string;
  /** Texto que diz qual base a pizza usa. */
  base: string;
  /** Total que a pizza deve somar (reais). */
  base_centavos: number;
  /** So fatias positivas (uma pizza nao representa valor negativo). */
  fatias: FatiaPizza[];
  soma_fatias_centavos: number;
  /** base - soma das fatias: valores negativos que uma pizza nao desenha (por exemplo, caixa liquido negativo). */
  nao_representado_centavos: number;
  /** Fracao do patrimonio total que a base representa (1 quando a base e o patrimonio inteiro). */
  fracao_do_patrimonio: number | null;
  nota: string | null;
}

export type BaseSetor = "acoes" | "renda_variavel" | "tudo";

export interface OpcoesPizza {
  /** Inclui o que esta marcado como Meta (patrimonio total) ou o exclui (base da liberdade financeira). */
  incluirMeta: boolean;
  baseSetor: BaseSetor;
}

const ehAcao = (i: ItemCarteira): boolean => i.classe_ativo === "renda_variavel" && i.especie.startsWith("Ações");

function agrupar(itens: ItemCarteira[], chave: (i: ItemCarteira) => { id: string; rotulo: string }): { fatias: FatiaPizza[]; soma: number } {
  const m = new Map<string, FatiaPizza>();
  for (const i of itens) {
    if (i.saldo_centavos === null) continue;
    const c = chave(i);
    const f = m.get(c.id) ?? { id: c.id, rotulo: c.rotulo, valor: 0 };
    f.valor += i.saldo_centavos;
    m.set(c.id, f);
  }
  const todas = [...m.values()];
  const fatias = todas.filter((f) => f.valor > 0).sort((a, b) => b.valor - a.valor);
  return { fatias, soma: fatias.reduce((s, f) => s + f.valor, 0) };
}

function pizza(id: PizzaCarteira["id"], titulo: string, base: string, itens: ItemCarteira[], totalPatrimonio: number, chave: (i: ItemCarteira) => { id: string; rotulo: string }, nota: string | null): PizzaCarteira {
  const baseCent = itens.reduce((s, i) => s + (i.saldo_centavos ?? 0), 0);
  const { fatias, soma } = agrupar(itens, chave);
  return {
    id, titulo, base, base_centavos: baseCent, fatias, soma_fatias_centavos: soma, nao_representado_centavos: baseCent - soma,
    fracao_do_patrimonio: totalPatrimonio > 0 ? baseCent / totalPatrimonio : null, nota,
  };
}

/** Genero/especie para a pizza 1: caixa e valores em transito entram juntos (liquidar uma compra consome o caixa). */
function fatiaGenero(i: ItemCarteira, temTransito: boolean): { id: string; rotulo: string } {
  if (i.genero === "meta") return { id: "meta", rotulo: "Meta" };
  if (i.genero === "caixa" || i.genero === "transito") return { id: "caixa", rotulo: temTransito ? "Caixa (líquido de valores em trânsito)" : "Caixa" };
  if (i.genero === "renda_variavel") return { id: `rv:${i.especie}`, rotulo: i.especie };
  if (i.genero === "previdencia") return { id: "previdencia", rotulo: "Previdência" };
  if (i.genero === "renda_fixa") return { id: "renda_fixa", rotulo: "Renda fixa" };
  return { id: "outros", rotulo: ROTULO_CLASSE.outros };
}

export function pizzasDaCarteira(itensTodos: ItemCarteira[], opc: OpcoesPizza): { genero: PizzaCarteira; setor: PizzaCarteira; origem: PizzaCarteira } {
  const totalPatrimonio = itensTodos.reduce((s, i) => s + (i.saldo_centavos ?? 0), 0);
  const considerados = opc.incluirMeta ? itensTodos : itensTodos.filter((i) => !i.meta);
  const baseTexto = opc.incluirMeta ? "Patrimônio total (inclui Meta)" : "Patrimônio sem Meta (base da liberdade financeira)";
  const temTransito = considerados.some((i) => i.genero === "transito" && i.saldo_centavos !== 0);

  const genero = pizza(
    "genero", "Carteira por gênero e espécie", baseTexto, considerados, totalPatrimonio, (i) => fatiaGenero(i, temTransito),
    temTransito ? "Caixa e valores em trânsito aparecem somados: uma compra a liquidar consome o caixa." : null,
  );

  let itensSetor: ItemCarteira[];
  let baseSetorTexto: string;
  let notaSetor: string | null = null;
  if (opc.baseSetor === "acoes") {
    itensSetor = considerados.filter(ehAcao);
    baseSetorTexto = "Somente ações (renda variável, espécie Ações)";
  } else if (opc.baseSetor === "renda_variavel") {
    itensSetor = considerados.filter((i) => i.classe_ativo === "renda_variavel");
    baseSetorTexto = "Toda a renda variável (ações, ETFs e fundos listados)";
    notaSetor = "ETFs e fundos listados só têm setor se você o informar no cadastro do ativo.";
  } else {
    itensSetor = considerados;
    baseSetorTexto = `${baseTexto}: setor, ou o gênero quando o ativo não tem setor`;
    notaSetor = "Previdência, renda fixa e caixa aparecem pelo gênero; só a renda variável sem setor aparece como Sem setor.";
  }
  const setor = pizza("setor", "Distribuição setorial", baseSetorTexto, itensSetor, totalPatrimonio, (i) => {
    if (i.classe_ativo === "renda_variavel" || opc.baseSetor !== "tudo") return i.setor ? { id: `s:${i.setor}`, rotulo: i.setor } : { id: "sem_setor", rotulo: "Sem setor" };
    if (i.setor) return { id: `s:${i.setor}`, rotulo: i.setor };
    return fatiaGenero(i, itensSetor.some((x) => x.genero === "transito" && x.saldo_centavos !== 0));
  }, notaSetor);

  const origem = pizza("origem", "Nacional x estrangeira", baseTexto, considerados, totalPatrimonio, (i) => (i.exposicao === "estrangeira" ? { id: "estrangeira", rotulo: "Estrangeira" } : { id: "nacional", rotulo: "Nacional" }), "Conta em dólar e ativos com exposição externa (ETF de índice americano, BDR) contam como estrangeira; a conversão usa o câmbio do mês.");
  return { genero, setor, origem };
}
