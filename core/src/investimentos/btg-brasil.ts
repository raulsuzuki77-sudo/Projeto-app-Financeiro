import { conciliarSetores } from "./setorial";
import { acharSequencia, centavosBR, colapsar, dataDMA, ehTraco, numeroBR, sa, textoDasLinhas, tokens, ultimos4 } from "./texto";
import type {
  ClasseAtivo, Conferencia, ConferenciaItem, DetalhePosicao, ExtratoLido, LinhaTexto, LoteAliquota, MovimentoLido, PosicaoLida, RentabilidadeFundo, ResultadoLeitura, SetorPercentual, TipoMovimento,
} from "./tipos";

/**
 * Leitor do "Extrato da Conta Investimento" do BTG Pactual (Brasil).
 *
 * Cada secao e lida como uma sequencia de palavras (tokens), ancorada em marcas do proprio registro (codigo do ativo,
 * CNPJ, data), e nao por linha: assim o resultado e o mesmo quando as colunas vem na mesma linha (pdf.js, pdftotext) ou
 * quando o PDFKit do iPhone quebra a linha entre celulas.
 */

const RE_SAC = /SAC:\s*[\d-]+\s*\/\s*Ouvidoria:\s*[\d-]+/gi;
const RE_TICKER = /^(?:[A-Z]{4}|[A-Z]\d[A-Z]{2})\d{1,2}$/;
const RE_CNPJ = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
const RE_DATA = /^\d{2}\/\d{2}\/(?:\d{2}|\d{4})$/;
/** Celula numerica "forte": dinheiro com virgula e duas casas, ou o traco de "nao informado". */
const RE_DINHEIRO = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const RE_PCT_DOC = /^-?\d+(?:[.,]\d+)?%$/;

const ehCelula = (t: string): boolean => ehTraco(t) || centavosBR(t) !== null;
const ehCelulaForte = (t: string): boolean => ehTraco(t) || RE_DINHEIRO.test(t);
const ehData = (t: string): boolean => RE_DATA.test(t) && dataDMA(t) !== null;
const nm = (s: string): string => sa(colapsar(s));

/** Linhas de cabecalho e rodape que se repetem em cada pagina. */
function ehRuido(n: string): boolean {
  if (/^periodo de \d/.test(n) || /^emitido em/.test(n)) return true;
  const palavras = n.split(" ");
  return palavras.every((p) => ["extrato", "da", "conta", "investimento"].includes(p));
}

/** Marcas que identificam o extrato (aplicadas ao texto sem acentos e em minusculas). */
const MARCAS_BR: [string, RegExp][] = [
  ["BTG Pactual", /btg\s*pactual/],
  ["Sumário", /sumario/],
  ["Saldo Bruto", /saldo bruto/],
  ["Conta investimento + número", /conta investimento\s+\d/],
  ["Período de dd/mm/aa", /periodo de \d{2}\/\d{2}\/\d{2}/],
];

export function marcasBtgBrasil(linhas: LinhaTexto[]): [string, boolean][] {
  const t = sa(textoDasLinhas(linhas).join(" "));
  return MARCAS_BR.map(([nome, re]) => [nome, re.test(t)]);
}

export function ehExtratoBtgBrasil(linhas: LinhaTexto[]): boolean {
  return marcasBtgBrasil(linhas).every(([, ok]) => ok);
}

type TipoSecao =
  | "sumario" | "prev_plano" | "prev_pos" | "prev_mov" | "prev_rent" | "prev_aliq"
  | "rv_pos" | "rv_mov" | "rf_pos" | "rf_mov" | "cc_pos" | "cc_mov" | "tr_rv" | "tr_prev" | "setorial" | "ignorar";

interface Secao {
  tipo: TipoSecao;
  sub: string;
  linhas: string[];
}

function cabecalho(n: string, original: string): { tipo: TipoSecao; sub: string } | null {
  if (/^sumario\s*-\s*distribuicao/.test(n)) return { tipo: "sumario", sub: "" };
  if (/^previdencia\s+\w+\s*-\s*posicao\s*-/.test(n)) return { tipo: "prev_pos", sub: original };
  if (/^previdencia\s+\w+\s*-\s*movimentacao/.test(n)) return { tipo: "prev_mov", sub: original };
  if (/^previdencia\s+\w+\s*-\s*plano/.test(n)) return { tipo: "prev_plano", sub: original };
  if (/^previdencia\s+\w+\s*-\s*rentabilidade/.test(n)) return { tipo: "prev_rent", sub: original };
  if (/^previdencia\s+\w+\s*-\s*posicoes abertas/.test(n)) return { tipo: "prev_aliq", sub: original };
  if (/^previdencia\s+\w+\s*-\s*posicoes/.test(n)) return { tipo: "ignorar", sub: "" };
  let m = /^renda variavel\s*-\s*posicao\s*-\s*(.+)$/.exec(n);
  if (m) return { tipo: "rv_pos", sub: m[1]! };
  m = /^renda variavel\s*-\s*movimentacao\s*-\s*(.+)$/.exec(n);
  if (m) return { tipo: "rv_mov", sub: m[1]! };
  if (/^renda fixa\s*-\s*posicao/.test(n)) return { tipo: "rf_pos", sub: original };
  if (/^renda fixa\s*-\s*movimentacao/.test(n)) return { tipo: "rf_mov", sub: original };
  if (/^conta corrente\s*-\s*posicao/.test(n)) return { tipo: "cc_pos", sub: "" };
  if (/^conta corrente\s*-\s*movimentacao/.test(n)) return { tipo: "cc_mov", sub: "" };
  if (/^valores em transito\s*-\s*renda variavel/.test(n)) return { tipo: "tr_rv", sub: "" };
  if (/^valores em transito\s*-\s*previdencia/.test(n)) return { tipo: "tr_prev", sub: "" };
  if (/^distribuicao setorial/.test(n)) return { tipo: "setorial", sub: "" };
  if (/^(distribuicao da carteira|per\S{0,3}l de risco)/.test(n)) return { tipo: "ignorar", sub: "" };
  return null;
}

/** Cabecalho com cara de "Produto - Posicao/Movimentacao" que esta leitura nao conhece: nunca e ignorado em silencio. */
const RE_SECAO_DESCONHECIDA = /^[a-z][a-z' ]{2,40}\s-\s(?:posicao|movimentacao)\b/;

function dividirSecoes(linhas: string[], desconhecidas: string[]): Secao[] {
  const secoes: Secao[] = [];
  let atual: Secao | null = null;
  for (const l of linhas) {
    const n = sa(l);
    if (/^disclaimers\b/.test(n)) break;
    const c = cabecalho(n, l);
    if (c) {
      atual = { tipo: c.tipo, sub: c.sub, linhas: [] };
      secoes.push(atual);
    } else if (RE_SECAO_DESCONHECIDA.test(n) && !/\d{2}\/\d{2}\/\d{2}/.test(n)) {
      desconhecidas.push(l);
      atual = { tipo: "ignorar", sub: l, linhas: [] };
      secoes.push(atual);
    } else if (atual) atual.linhas.push(l);
  }
  return secoes;
}

/** Celulas (numero ou traco) no fim da lista e o que vem antes delas. */
function separarCelulas(toks: string[]): { cabeca: string[]; celulas: string[] } {
  let i = toks.length;
  while (i > 0 && ehCelula(toks[i - 1]!)) i--;
  return { cabeca: toks.slice(0, i), celulas: toks.slice(i) };
}

const valorCelula = (c: string | undefined): number | null => (c === undefined || ehTraco(c) ? null : centavosBR(c));
const numCelula = (c: string | undefined): number | null => (c === undefined || ehTraco(c) ? null : numeroBR(c));

/** Divide os tokens em blocos que comecam em cada indice de `ancoras`, cortando no primeiro "Total". */
function blocos(toks: string[], ancoras: number[]): string[][] {
  const out: string[][] = [];
  for (let k = 0; k < ancoras.length; k++) {
    const ini = ancoras[k]!;
    const fim = k + 1 < ancoras.length ? ancoras[k + 1]! : toks.length;
    let b = toks.slice(ini, fim);
    const t = b.findIndex((x, idx) => idx > 0 && sa(x) === "total");
    if (t >= 0) b = b.slice(0, t);
    out.push(b);
  }
  return out;
}

/** Valor da linha "Total ..." da secao: primeiro numero depois da palavra Total (palavras como "em Ações R$" ficam de lado). */
function totalDaSecao(toks: string[]): number | null {
  const i = toks.findIndex((x) => sa(x) === "total");
  if (i < 0) return null;
  for (const t of toks.slice(i + 1)) {
    if (ehTraco(t)) continue;
    const v = centavosBR(t);
    if (v !== null) return v;
    if (ehData(t) || RE_TICKER.test(t)) return null;
  }
  return null;
}

function tipoSubRV(sub: string): string {
  const n = sa(sub);
  if (n.includes("acoes") || n.includes("acao")) return "Ação";
  if (n.includes("etf")) return "ETF";
  if (n.includes("fundos") || n.includes("fii")) return "FII";
  return sub.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Especie (nivel entre o genero e o ativo) das posicoes de renda variavel. */
function especieRV(sub: string): string {
  const n = sa(sub);
  if (n.includes("acoes") || n.includes("acao")) return "Ações";
  if (n.includes("etf")) return "ETFs";
  if (n.includes("fundos") || n.includes("fii")) return "Fundos listados (FII)";
  return sub.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- sumario ----------
const MERCADOS: { rotulo: string; classe: ClasseAtivo | "total"; nome: string }[] = [
  { rotulo: "previdencia", classe: "previdencia", nome: "Previdência" },
  { rotulo: "renda variavel", classe: "renda_variavel", nome: "Renda variável" },
  { rotulo: "renda fixa", classe: "renda_fixa", nome: "Renda fixa" },
  { rotulo: "conta corrente", classe: "caixa", nome: "Conta corrente" },
  { rotulo: "valores em transito", classe: "transito", nome: "Valores em trânsito" },
  { rotulo: "total", classe: "total", nome: "Total" },
];

/** Linhas do sumario: rotulo + quatro colunas (saldo bruto e liquido do mes anterior e do mes do extrato). */
function linhasDoSumario(toks: string[]): { rotulo: string; cel: string[] }[] {
  const out: { rotulo: string; cel: string[] }[] = [];
  let rot: string[] = [];
  let i = 0;
  while (i < toks.length) {
    if (ehCelulaForte(toks[i]!)) {
      const cel: string[] = [];
      let j = i;
      while (j < toks.length && ehCelulaForte(toks[j]!) && cel.length < 4) cel.push(toks[j++]!);
      if (cel.length === 4) {
        // o rotulo e o que vem depois do ultimo marcador de cabecalho (R$, data, nota de rodape)
        let corte = 0;
        rot.forEach((t, k) => { if (t === "R$" || ehData(t) || /^\d+$/.test(t) || t === "%") corte = k + 1; });
        out.push({ rotulo: rot.slice(corte).join(" "), cel });
        rot = [];
      } else rot.push(...cel);
      i = j;
    } else rot.push(toks[i++]!);
  }
  return out;
}

function lerSumario(sec: Secao | undefined, avisos: string[]): Map<string, number> {
  const saida = new Map<string, number>();
  if (!sec) return saida;
  for (const l of linhasDoSumario(tokens(sec.linhas))) {
    const m = MERCADOS.find((x) => x.rotulo === nm(l.rotulo));
    const valor = valorCelula(l.cel[2]) ?? 0;
    if (m) saida.set(m.classe, valor);
    else avisos.push(`Sumário traz "${l.rotulo}" (saldo bruto ${l.cel[2]}), mercado que esta leitura não reconhece: confira se o total do extrato confere.`);
  }
  if (!saida.has("total")) avisos.push('Sumário: não foi possível ler a linha "Total".');
  return saida;
}

// ---------- previdencia ----------
function produtoDaPrevidencia(titulo: string): string | null {
  const m = /\/\s*([A-Za-z]+)\s*$/.exec(titulo.trim());
  return m ? m[1]!.toUpperCase() : null;
}

function lerPrevidenciaPosicoes(sec: Secao, avisos: string[]): { posicoes: PosicaoLida[]; totalSecao: number | null } {
  const toks = tokens(sec.linhas);
  const produto = produtoDaPrevidencia(sec.sub);
  const posicoes: PosicaoLida[] = [];
  const idxCnpj = toks.map((t, i) => (RE_CNPJ.test(t) ? i : -1)).filter((i) => i >= 0);
  const cab = acharSequencia(toks, ["saldo", "bruto", "r$"]);
  let inicioNome = cab >= 0 && cab < (idxCnpj[0] ?? Infinity) ? cab + 3 : 0;
  for (const i of idxCnpj) {
    const nome = toks.slice(inicioNome, i).filter((x) => sa(x) !== "total");
    const resto = toks.slice(i + 1);
    const iniCel = resto.findIndex((x) => ehData(x));
    const cel: string[] = [];
    for (const t of resto.slice(iniCel + 1)) {
      if (!ehCelula(t) || cel.length === 3) break;
      cel.push(t);
    }
    const valor = valorCelula(cel[2]);
    if (iniCel < 0 || cel.length < 3 || valor === null) {
      avisos.push(`Previdência: registro do fundo ${nome.join(" ") || toks[i]} não foi lido por completo.`);
      continue;
    }
    const dataRef = dataDMA(resto[iniCel]!);
    const detalhe: DetalhePosicao = {};
    if (produto) detalhe.produto = produto;
    if (dataRef) detalhe.data_referencia = dataRef;
    posicoes.push({
      classe_ativo: "previdencia",
      ativo: nome.join(" ") || "Fundo de previdência",
      codigo: toks[i]!,
      quantidade: numeroBR(cel[0]!),
      valor_centavos: valor,
      especie: produto ?? "Previdência",
      cnpj: toks[i]!,
      preco_fechamento: numCelula(cel[1]),
      preco_medio: null,
      detalhe,
    });
    inicioNome = i + 1 + iniCel + 1 + cel.length;
  }
  return { posicoes, totalSecao: totalDaSecao(toks.slice(inicioNome)) };
}

function regimeDoPlano(sec: Secao): string | null {
  const n = sa(sec.linhas.join(" "));
  if (/\bregressivo\b/.test(n)) return "regressivo";
  if (/\bprogressivo\b/.test(n)) return "progressivo";
  return null;
}

/** Rentabilidade por fundo: benchmark e seis percentuais (fundo e benchmark, mes, ano, 12 meses). */
function lerRentabilidade(sec: Secao, avisos: string[]): Map<string, RentabilidadeFundo> {
  const saida = new Map<string, RentabilidadeFundo>();
  let toks = tokens(sec.linhas);
  const cab = acharSequencia(toks, ["benchmark", "12", "meses", "%"]);
  if (cab >= 0) toks = toks.slice(cab + 4);
  const isNum = (t: string): boolean => ehTraco(t) || (centavosBR(t) !== null && /,/.test(t));
  let inicio = 0;
  let i = 0;
  while (i < toks.length) {
    if (isNum(toks[i]!)) {
      let j = i;
      while (j < toks.length && isNum(toks[j]!) && j - i < 6) j++;
      if (j - i === 6 && i - inicio >= 2) {
        const bench = toks[i - 1]!;
        const nome = nm(toks.slice(inicio, i - 1).join(" "));
        const c = toks.slice(i, j);
        saida.set(nome, { benchmark: bench, fundo_mes: numCelula(c[0]), benchmark_mes: numCelula(c[1]), fundo_ano: numCelula(c[2]), benchmark_ano: numCelula(c[3]), fundo_12m: numCelula(c[4]), benchmark_12m: numCelula(c[5]) });
        inicio = j;
        i = j;
        continue;
      }
    }
    i++;
  }
  if (saida.size === 0) avisos.push("Previdência: tabela de rentabilidade presente, mas nenhum fundo foi lido nela.");
  return saida;
}

/** "Posicoes abertas por aliquota": cada lote traz aliquota, cotas, valor liquido, IR e valor bruto. */
function lerAliquotas(sec: Secao, avisos: string[]): Map<string, LoteAliquota[]> {
  const saida = new Map<string, LoteAliquota[]>();
  const toks = tokens(sec.linhas);
  const isNum = (t: string): boolean => centavosBR(t) !== null && /,/.test(t);
  let nome: string | null = null;
  let acumulado: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i]!;
    if (/^\d+\/[A-Za-z]+$/.test(t) && toks[i + 1] === "-") {
      // "290386/PGBL - NOME DO FUNDO": comeca o nome
      acumulado = [];
      nome = "";
      i += 2;
      while (i < toks.length && !isNum(toks[i]!)) acumulado.push(toks[i++]!);
      nome = nm(acumulado.join(" "));
      continue;
    }
    if (isNum(t) && nome !== null) {
      const c = toks.slice(i, i + 5);
      if (c.length === 5 && c.every(isNum)) {
        const lote: LoteAliquota = { aliquota: numeroBR(c[0]!)!, cotas: numeroBR(c[1]!)!, liquido_centavos: centavosBR(c[2]!)!, ir_centavos: centavosBR(c[3]!)!, bruto_centavos: centavosBR(c[4]!)! };
        saida.set(nome, [...(saida.get(nome) ?? []), lote]);
        i += 5;
        continue;
      }
    }
    i++;
  }
  if (saida.size === 0) avisos.push("Previdência: posições por alíquota presentes, mas nenhum lote foi lido.");
  return saida;
}

function tipoPrevidencia(trans: string): TipoMovimento {
  const n = sa(trans);
  if (/contribu|aporte|portabilidade.*entrada/.test(n)) return "aporte";
  if (/resgate|retirada|saque|renda/.test(n)) return "resgate";
  return "outro";
}

function lerPrevidenciaMov(sec: Secao, avisos: string[], previdencias: PosicaoLida[]): MovimentoLido[] {
  const toks = tokens(sec.linhas);
  const ancoras = toks.map((t, i) => (ehData(t) ? i : -1)).filter((i) => i >= 0);
  // "Previdencia Individual - Movimentacao - 290386/NOME DO FUNDO": o nome liga o movimento ao fundo (e ao seu CNPJ)
  const tituloFundo = nm(sec.sub.replace(/^.*?movimenta[cç][aã]o\s*-\s*\S*?\//i, ""));
  const fundo = previdencias.find((p) => nm(p.ativo) === tituloFundo) ?? (previdencias.length === 1 ? previdencias[0] : undefined);
  const out: MovimentoLido[] = [];
  for (const b of blocos(toks, ancoras)) {
    const data = dataDMA(b[0]!)!;
    const { cabeca, celulas } = separarCelulas(b.slice(1));
    // cotas, valor da cota, valor bruto, IR, valor liquido
    const bruto = valorCelula(celulas[celulas.length - 3]);
    const liq = valorCelula(celulas[celulas.length - 1]);
    const v = bruto ?? liq;
    if (celulas.length < 3 || v === null) {
      avisos.push(`Previdência: movimentação de ${data} sem valor legível (${cabeca.join(" ")}).`);
      continue;
    }
    const trans = cabeca.join(" ");
    const tipo = tipoPrevidencia(trans);
    out.push({
      data_local: data,
      tipo,
      descricao: `Previdência: ${trans}`,
      codigo: fundo?.codigo ?? null,
      valor_centavos: tipo === "outro" ? v : Math.abs(v),
      em_transito: false,
      quantidade: celulas.length >= 5 ? numCelula(celulas[celulas.length - 5]) : null,
      preco: celulas.length >= 5 ? numCelula(celulas[celulas.length - 4]) : null,
    });
  }
  return out;
}

// ---------- renda variavel ----------
function lerRvPosicoes(sec: Secao, avisos: string[]): { posicoes: PosicaoLida[]; totalSecao: number | null } {
  const toks = tokens(sec.linhas);
  const especie = especieRV(sec.sub);
  const ancoras = toks.map((t, i) => (RE_TICKER.test(t) ? i : -1)).filter((i) => i >= 0);
  const posicoes: PosicaoLida[] = [];
  for (const b of blocos(toks, ancoras)) {
    const codigo = b[0]!;
    const sep = separarCelulas(b.slice(1));
    const cabeca = sep.cabeca;
    let celulas = sep.celulas;
    // colunas: quantidade, preco de fechamento, preco medio, saldo bruto; numeros a mais pertencem ao nome
    if (celulas.length > 4) {
      cabeca.push(...celulas.slice(0, celulas.length - 4));
      celulas = celulas.slice(-4);
    }
    const valor = valorCelula(celulas[celulas.length - 1]);
    if (celulas.length < 3 || valor === null) {
      avisos.push(`Renda variável: ${codigo} não foi lido por completo.`);
      continue;
    }
    // coluna "Tipo" dos fundos listados repete a sigla (FII) no fim do nome
    let tipoFundo: string | undefined;
    if (cabeca.length > 1 && /^FI[A-Z]*$/.test(cabeca[cabeca.length - 1]!) && sa(sec.sub).includes("fundos")) tipoFundo = cabeca.pop();
    const qtd = numeroBR(celulas[0]!);
    const preco = numCelula(celulas[1]);
    // "-" no preco medio: o extrato nao informa (ativo depositado). Fica nulo, nunca zero.
    const medio = celulas.length === 4 ? numCelula(celulas[2]) : null;
    if (qtd !== null && preco !== null && Math.abs(Math.round(qtd * preco * 100) - valor) > 2) {
      avisos.push(`${codigo}: quantidade x preço (${Math.round(qtd * preco * 100)}) difere do saldo bruto informado (${valor}) em centavos.`);
    }
    const detalhe: DetalhePosicao = {};
    if (tipoFundo) detalhe.tipo = tipoFundo;
    posicoes.push({
      classe_ativo: "renda_variavel",
      ativo: cabeca.join(" ") || codigo,
      codigo,
      quantidade: qtd,
      valor_centavos: valor,
      especie,
      preco_fechamento: preco,
      preco_medio: medio !== null && medio > 0 ? medio : null,
      detalhe: Object.keys(detalhe).length ? detalhe : null,
    });
  }
  return { posicoes, totalSecao: totalDaSecao(toks) };
}

function tipoTransacao(trans: string): TipoMovimento {
  const n = sa(trans);
  if (/\bdeposito\b|\bentrada\b/.test(n)) return "custodia";
  if (/\bretirada\b/.test(n)) return "custodia";
  if (/\bcompra\b/.test(n)) return "compra";
  if (/\bvenda\b/.test(n)) return "venda";
  if (/rendimento|dividendo|juros|provento|jcp|amortizacao|restituicao/.test(n)) return "provento";
  return "outro";
}

function ajustarSinal(tipo: TipoMovimento, v: number, trans: string): number {
  if (tipo === "aporte" || tipo === "resgate" || tipo === "compra" || tipo === "venda") return Math.abs(v);
  if (tipo === "custodia" && /retirada/.test(sa(trans))) return -Math.abs(v);
  return v;
}

function lerRvMov(sec: Secao, avisos: string[]): MovimentoLido[] {
  const toks = tokens(sec.linhas);
  const ancoras = toks.map((t, i) => (ehData(t) ? i : -1)).filter((i) => i >= 0);
  const out: MovimentoLido[] = [];
  for (const b of blocos(toks, ancoras)) {
    const data = dataDMA(b[0]!)!;
    const { cabeca, celulas } = separarCelulas(b.slice(1));
    const iCod = cabeca.findIndex((x) => RE_TICKER.test(x));
    const trans = (iCod >= 0 ? cabeca.slice(0, iCod) : cabeca).join(" ");
    const codigo = iCod >= 0 ? cabeca[iCod]! : null;
    // [qtde, preco, bruto, corretagem, liquido]
    const liq = valorCelula(celulas[celulas.length - 1]);
    const bruto = valorCelula(celulas[celulas.length - 3]);
    if (celulas.length < 3 || trans === "") {
      avisos.push(`Renda variável: movimentação de ${data} não foi lida por completo (${cabeca.join(" ")}).`);
      continue;
    }
    const v = liq ?? bruto ?? 0;
    const tipo = tipoTransacao(trans);
    out.push({
      data_local: data,
      tipo,
      descricao: codigo ? `${trans} ${codigo}` : trans,
      codigo,
      valor_centavos: ajustarSinal(tipo, v, trans),
      em_transito: false,
      quantidade: celulas.length === 5 ? numCelula(celulas[0]) : null,
      preco: celulas.length === 5 ? numCelula(celulas[1]) : null,
    });
  }
  return out;
}

// ---------- renda fixa (layout NAO validado com amostra real: leitura generica e conferida) ----------
const RE_CELULA_RF = /^(?:-|-?\d{1,3}(?:\.\d{3})*,\d{2}|\d{2}\/\d{2}\/(?:\d{2}|\d{4})|-?\d+(?:,\d+)?%)$/;

function especieRF(nome: string): string {
  const m = /\b(CDB|RDB|LCI|LCA|LC|CRI|CRA|COE|DEB[ÊE]NTURE|TESOURO|NTN-?[A-Z]|LTN|LFT)\b/i.exec(nome);
  return m ? m[1]!.toUpperCase().replace("DEBENTURE", "Debênture").replace("DEBÊNTURE", "Debênture") : "Renda fixa";
}

/**
 * Leitura generica da posicao em renda fixa: cada linha com pelo menos duas colunas numericas ou de data no fim e um nome antes.
 * A coluna do saldo bruto e escolhida SOMENTE se a soma dela fecha com o total declarado (da secao ou do sumario); com
 * mais de uma coluna possivel, ou nenhuma, as posicoes nao sao gravadas e o aviso explica (o total do extrato aparece como divergente).
 */
function lerRendaFixa(secoes: Secao[], declarado: number | undefined, avisos: string[]): { posicoes: PosicaoLida[]; totalSecao: number | null } {
  const posicoes: PosicaoLida[] = [];
  let totalSecao: number | null = null;
  const linhas = secoes.flatMap((s) => s.linhas);
  const registros: { nome: string; cel: string[] }[] = [];
  for (const l of linhas) {
    const t = l.split(" ").filter((x) => x);
    if (t.length === 0) continue;
    if (sa(t[0]!) === "total") {
      for (const x of t.slice(1)) if (RE_DINHEIRO.test(x)) { totalSecao = centavosBR(x); break; }
      continue;
    }
    let i = t.length;
    while (i > 0 && RE_CELULA_RF.test(t[i - 1]!)) i--;
    const cel = t.slice(i);
    const nome = t.slice(0, i).join(" ");
    if (cel.length >= 2 && nome !== "") registros.push({ nome, cel });
    else if (cel.length === 0 && registros.length > 0 && !/saldo bruto|vencimento|emissor|aplica/i.test(sa(l))) registros[registros.length - 1]!.nome += ` ${l}`;
  }
  const alvo = totalSecao ?? declarado ?? null;
  if (registros.length === 0) {
    avisos.push("Renda fixa: seção encontrada, mas nenhuma linha de posição foi reconhecida. As posições NÃO foram lidas; use a posição manual.");
    return { posicoes, totalSecao };
  }
  const k = Math.min(...registros.map((r) => r.cel.length));
  const candidatas: number[] = [];
  for (let j = 1; j <= k; j++) {
    const valores = registros.map((r) => r.cel[r.cel.length - j]!);
    if (!valores.every((v) => RE_DINHEIRO.test(v))) continue;
    if (alvo !== null && registros.reduce((a, r) => a + centavosBR(r.cel[r.cel.length - j]!)!, 0) === alvo) candidatas.push(j);
  }
  if (alvo === null || candidatas.length !== 1) {
    avisos.push(
      alvo === null
        ? "Renda fixa: o extrato não traz total para conferir a coluna do saldo bruto. As posições NÃO foram lidas; use a posição manual."
        : candidatas.length === 0
          ? "Renda fixa: nenhuma coluna das linhas lidas soma o total declarado. As posições NÃO foram lidas; use a posição manual."
          : "Renda fixa: mais de uma coluna soma o total declarado (ambíguo). As posições NÃO foram lidas; use a posição manual.",
    );
    return { posicoes, totalSecao };
  }
  const j = candidatas[0]!;
  avisos.push("Renda fixa: layout lido de forma genérica (não validado com um extrato real); a coluna do saldo bruto foi escolhida porque a soma fecha com o total declarado. Confira cada linha.");
  for (const r of registros) {
    posicoes.push({ classe_ativo: "renda_fixa", ativo: r.nome, codigo: null, quantidade: null, valor_centavos: centavosBR(r.cel[r.cel.length - j]!)!, especie: especieRF(r.nome), preco_medio: null });
  }
  return { posicoes, totalSecao };
}

// ---------- conta corrente ----------
function lerCcPosicao(sec: Secao | undefined, avisos: string[]): PosicaoLida | null {
  if (!sec) return null;
  const toks = tokens(sec.linhas);
  let valor: number | null = null;
  for (let i = 0; i + 1 < toks.length; i++) {
    if (ehData(toks[i]!) && ehCelula(toks[i + 1]!)) valor = valorCelula(toks[i + 1]);
  }
  if (valor === null) {
    avisos.push("Conta corrente: saldo não localizado.");
    return null;
  }
  return { classe_ativo: "caixa", ativo: "Conta corrente", codigo: null, quantidade: null, valor_centavos: valor, especie: "Conta corrente", preco_medio: null };
}

function tipoCc(desc: string, v: number): TipoMovimento {
  const n = sa(desc);
  if (/rendimento|juros|dividendo|jcp|provento/.test(n)) return "provento";
  if (/\bcompra\b/.test(n)) return "compra";
  if (/\bvenda\b/.test(n)) return "venda";
  if (v > 0 && /recebimento|recebida|\bted\b|\bpix\b|\bdoc\b|deposito|credito/.test(n)) return "aporte";
  if (v < 0 && /envio|enviad|saque|transferencia|\bted\b|\bpix\b|\bdoc\b|pagamento|debito/.test(n)) return "resgate";
  return "outro";
}

/** Mantem so o tipo da operacao; o nome da contraparte (pode ser dado pessoal) nao e guardado. */
function descricaoCc(desc: string): string {
  if (/transfer[eê]ncia/i.test(desc)) return desc.split(" - ")[0]!.trim();
  return desc;
}

function lerCcMov(sec: Secao, avisos: string[]): MovimentoLido[] {
  const toks = tokens(sec.linhas);
  const ancoras = toks.map((t, i) => (ehData(t) ? i : -1)).filter((i) => i >= 0);
  const out: MovimentoLido[] = [];
  for (const b of blocos(toks, ancoras)) {
    const data = dataDMA(b[0]!)!;
    const { cabeca, celulas } = separarCelulas(b.slice(1));
    const desc = cabeca.join(" ");
    if (/^saldo\b/i.test(sa(desc))) continue;
    // [movimentacao, saldo]; com uma unica celula, ela e a movimentacao
    const mov = valorCelula(celulas.length >= 2 ? celulas[celulas.length - 2] : celulas[0]);
    if (desc === "" || mov === null) {
      if (desc !== "" && celulas.length > 0 && valorCelula(celulas[0]) === null) continue; // linha sem movimento
      avisos.push(`Conta corrente: movimentação de ${data} não foi lida por completo (${desc}).`);
      continue;
    }
    const tipo = tipoCc(desc, mov);
    const codigo = cabeca.find((x) => RE_TICKER.test(x)) ?? null;
    out.push({ data_local: data, tipo, descricao: descricaoCc(desc), codigo, valor_centavos: ajustarSinal(tipo, mov, desc), em_transito: false });
  }
  return out;
}

// ---------- valores em transito ----------
interface ItemTransito {
  data: string | null;
  descricao: string;
  valor: number;
  tipo: TipoMovimento;
  codigo: string | null;
}

function lerTransito(sec: Secao, avisos: string[]): { itens: ItemTransito[]; soma: number; totalSecao: number | null } {
  const toks = tokens(sec.linhas);
  const ancoras = toks.map((t, i) => (ehData(t) || sa(t) === "n/d" ? i : -1)).filter((i) => i >= 0);
  const itens: ItemTransito[] = [];
  let soma = 0;
  for (const b of blocos(toks, ancoras)) {
    const data = ehData(b[0]!) ? dataDMA(b[0]!) : null;
    const { cabeca, celulas } = separarCelulas(b.slice(1));
    const v = valorCelula(celulas[celulas.length - 1]);
    const desc = cabeca.join(" ");
    if (v === null || desc === "") {
      avisos.push(`Valores em trânsito: item de ${b[0]} não foi lido por completo (${desc}).`);
      continue;
    }
    soma += v;
    const n = sa(desc);
    let tipo: TipoMovimento = "outro";
    if (/contribu|aporte/.test(n)) tipo = "aporte";
    else if (/resgate|retirada|saque/.test(n)) tipo = "resgate";
    else if (/^compra\b/.test(n)) tipo = "compra";
    else if (/^venda\b/.test(n)) tipo = "venda";
    else if (/rendimento|dividendo|juros|jcp|provento|amortizacao/.test(n)) tipo = "provento";
    itens.push({ data, descricao: desc, valor: v, tipo, codigo: cabeca.find((x) => RE_TICKER.test(x)) ?? null });
  }
  return { itens, soma, totalSecao: totalDaSecao(toks) };
}

function especieTransito(tipo: TipoMovimento, origem: "tr_rv" | "tr_prev"): string {
  switch (tipo) {
    case "compra": return "Compras a liquidar";
    case "venda": return "Vendas a liquidar";
    case "provento": return "Proventos a receber";
    case "aporte": return origem === "tr_prev" ? "Contribuição de previdência a creditar" : "Aportes a creditar";
    case "resgate": return origem === "tr_prev" ? "Resgates de previdência a receber" : "Resgates a receber";
    default: return "Outros valores em trânsito";
  }
}

/** Liga um item de transito ao ativo pelo nome ("JUROS S/ CAPITAL - B3 ON EJ NM" -> B3SA3). */
function codigoPorNome(desc: string, rv: PosicaoLida[]): string | null {
  const d = nm(desc);
  let melhor: PosicaoLida | null = null;
  for (const p of rv) {
    const n = nm(p.ativo);
    if (n.length >= 4 && d.includes(n) && (melhor === null || n.length > nm(melhor.ativo).length)) melhor = p;
  }
  return melhor?.codigo ?? null;
}

// ---------- distribuicao setorial ----------
/** "SERVICOS FINANCEIROS DIVERSOS 42.39%" repetido: nome + percentual. */
function lerSetorial(sec: Secao, avisos: string[]): SetorPercentual[] {
  const out: SetorPercentual[] = [];
  let nome: string[] = [];
  for (const t of tokens(sec.linhas)) {
    if (RE_PCT_DOC.test(t)) {
      const pct = Number(t.replace("%", "").replace(",", "."));
      if (nome.length > 0 && Number.isFinite(pct)) out.push({ setor: nome.join(" "), pct });
      else avisos.push(`Distribuição setorial: percentual ${t} sem nome de setor.`);
      nome = [];
    } else nome.push(t);
  }
  if (nome.length > 0) avisos.push(`Distribuição setorial: texto sem percentual no fim (${nome.join(" ")}).`);
  return out;
}

function item(rotulo: string, declarado: number, lido: number): ConferenciaItem {
  return { rotulo, declarado_centavos: declarado, lido_centavos: lido, diferenca_centavos: lido - declarado, confere: lido === declarado };
}

export function lerExtratoBtgBrasil(linhasBrutas: LinhaTexto[]): ResultadoLeitura {
  const avisos: string[] = [];
  const brutas = textoDasLinhas(linhasBrutas).map((l) => colapsar(l.replace(RE_SAC, " ")));
  const todas = brutas.filter((l) => l !== "");
  const mPer = /per[ií]odo de (\d{2}\/\d{2}\/\d{2,4}) a (\d{2}\/\d{2}\/\d{2,4})/i.exec(todas.join(" "));
  const ini = mPer ? dataDMA(mPer[1]!) : null;
  const fim = mPer ? dataDMA(mPer[2]!) : null;
  if (!ini || !fim) return { ok: false, erro: "Extrato BTG Pactual reconhecido, mas o período (\"Período de dd/mm/aa a dd/mm/aa\") não foi localizado." };
  const mConta = /conta\s+investimento\s+(\d[\d.\-]*)/i.exec(todas.join(" "));
  if (!mConta) avisos.push("Número da conta não localizado; a conta ficará sem identificação.");
  const conta = mConta ? ultimos4(mConta[1]!) : "";

  const limpas = todas.filter((l) => !ehRuido(sa(l)));
  const desconhecidas: string[] = [];
  const secoes = dividirSecoes(limpas, desconhecidas);
  const por = (tipo: TipoSecao) => secoes.filter((s) => s.tipo === tipo);
  for (const d of desconhecidas) avisos.push(`Seção "${d}" não é reconhecida por esta leitura e NÃO foi lida.`);

  const posicoes: PosicaoLida[] = [];
  const movimentos: MovimentoLido[] = [];
  const parciais: ConferenciaItem[] = [];

  const sum = lerSumario(por("sumario")[0], avisos);

  // previdencia: posicao + rentabilidade + aliquotas + plano
  const prevPos: PosicaoLida[] = [];
  for (const s of por("prev_pos")) {
    const r = lerPrevidenciaPosicoes(s, avisos);
    prevPos.push(...r.posicoes);
    if (r.totalSecao !== null) parciais.push(item("Previdência (total da seção)", r.totalSecao, r.posicoes.reduce((a, p) => a + p.valor_centavos, 0)));
  }
  const regime = por("prev_plano").map(regimeDoPlano).find((x) => x !== null) ?? null;
  const rentab = new Map<string, RentabilidadeFundo>();
  for (const s of por("prev_rent")) for (const [k, v] of lerRentabilidade(s, avisos)) rentab.set(k, v);
  const aliq = new Map<string, LoteAliquota[]>();
  for (const s of por("prev_aliq")) for (const [k, v] of lerAliquotas(s, avisos)) aliq.set(k, [...(aliq.get(k) ?? []), ...v]);
  for (const p of prevPos) {
    const chave = nm(p.ativo);
    const d: DetalhePosicao = p.detalhe ?? {};
    if (regime) d.regime = regime;
    const r = rentab.get(chave);
    if (r) d.rentabilidade = r;
    const lotes = aliq.get(chave);
    if (lotes && lotes.length > 0) {
      d.aliquotas = lotes;
      d.valor_liquido_centavos = lotes.reduce((a, l) => a + l.liquido_centavos, 0);
      d.ir_centavos = lotes.reduce((a, l) => a + l.ir_centavos, 0);
      parciais.push(item(`Previdência, posições por alíquota (saldo bruto de ${p.ativo})`, p.valor_centavos, lotes.reduce((a, l) => a + l.bruto_centavos, 0)));
    } else if (por("prev_aliq").length > 0) avisos.push(`Previdência: sem posições por alíquota para ${p.ativo} (valor líquido e IR não informados).`);
    p.detalhe = d;
  }
  posicoes.push(...prevPos);
  for (const s of por("prev_mov")) movimentos.push(...lerPrevidenciaMov(s, avisos, prevPos));

  // renda variavel
  const rvPos: PosicaoLida[] = [];
  for (const s of por("rv_pos")) {
    const r = lerRvPosicoes(s, avisos);
    rvPos.push(...r.posicoes);
    if (r.totalSecao !== null) parciais.push(item(`Renda variável, ${tipoSubRV(s.sub)} (total da seção)`, r.totalSecao, r.posicoes.reduce((a, p) => a + p.valor_centavos, 0)));
    else if (r.posicoes.length > 0) avisos.push(`Renda variável (${tipoSubRV(s.sub)}): total da seção não localizado.`);
  }
  // setor das acoes: distribuicao setorial do extrato conciliada com os saldos
  const setorial: SetorPercentual[] = [];
  for (const s of por("setorial")) setorial.push(...lerSetorial(s, avisos));
  const acoes = rvPos.filter((p) => p.especie === "Ações" && p.codigo);
  if (setorial.length > 0) {
    if (acoes.length === 0) avisos.push("Distribuição setorial presente, mas nenhuma ação foi lida.");
    else {
      const r = conciliarSetores(acoes.map((a) => ({ id: a.codigo!, valor_centavos: a.valor_centavos })), setorial);
      avisos.push(...r.avisos);
      for (const a of acoes) {
        const setor = r.atribuicao.get(a.codigo!);
        if (setor) a.detalhe = { ...(a.detalhe ?? {}), setor, setor_origem: "extrato" };
      }
    }
  }
  posicoes.push(...rvPos);
  for (const s of por("rv_mov")) movimentos.push(...lerRvMov(s, avisos));

  // renda fixa nacional (leitura generica e conferida)
  const rfSecoes = por("rf_pos");
  if (rfSecoes.length > 0) {
    const r = lerRendaFixa(rfSecoes, sum.get("renda_fixa"), avisos);
    posicoes.push(...r.posicoes);
    if (r.totalSecao !== null) parciais.push(item("Renda fixa (total da seção)", r.totalSecao, r.posicoes.reduce((a, p) => a + p.valor_centavos, 0)));
  }
  if (por("rf_mov").length > 0) avisos.push("Renda fixa: a movimentação do mês não é lida por esta versão (layout desconhecido); os aportes e resgates dessa carteira não entram nos aportes do mês.");

  // conta corrente
  const cc = lerCcPosicao(por("cc_pos")[0], avisos);
  if (cc) posicoes.push(cc);
  const ccMov: MovimentoLido[] = [];
  for (const s of por("cc_mov")) ccMov.push(...lerCcMov(s, avisos));

  // Rendimento creditado na conta corrente que repete o provento da renda variavel (mesmo dia, valor e codigo) conta uma vez so.
  let repetidos = 0;
  for (const m of ccMov) {
    const dup = m.tipo === "provento" && m.codigo !== null && movimentos.some((x) => x.tipo === "provento" && x.codigo === m.codigo && x.data_local === m.data_local && x.valor_centavos === m.valor_centavos);
    if (dup) repetidos++;
    else movimentos.push(m);
  }
  if (repetidos > 0) avisos.push(`${repetidos} rendimento(s) da conta corrente repetiam proventos da renda variável (mesmo dia, valor e ativo) e foram contados uma só vez.`);

  // valores em transito: cada item vira uma posicao (compra liquidando, provento a receber, contribuicao a creditar)
  for (const [tipo, rotulo] of [["tr_rv", "renda variável"], ["tr_prev", "previdência"]] as const) {
    for (const s of por(tipo)) {
      const r = lerTransito(s, avisos);
      for (const it of r.itens) {
        const codigo = it.codigo ?? (tipo === "tr_rv" ? codigoPorNome(it.descricao, rvPos) : null);
        const nome = tipo === "tr_prev" ? `${it.descricao} (previdência)` : it.descricao;
        movimentos.push({
          data_local: it.data ?? fim,
          tipo: it.tipo,
          descricao: `Em trânsito: ${it.descricao}`,
          codigo,
          valor_centavos: it.tipo === "outro" || it.tipo === "provento" ? it.valor : Math.abs(it.valor),
          em_transito: true,
        });
        posicoes.push({
          classe_ativo: "transito",
          ativo: nome,
          codigo,
          quantidade: null,
          valor_centavos: it.valor,
          especie: especieTransito(it.tipo, tipo),
          preco_medio: null,
          detalhe: { data_liquidacao: it.data },
        });
      }
      if (r.totalSecao !== null) parciais.push(item(`Valores em trânsito, ${rotulo} (total da seção)`, r.totalSecao, r.soma));
    }
  }

  const somaPosicoes = posicoes.reduce((a, p) => a + p.valor_centavos, 0);
  for (const m of MERCADOS) {
    if (m.classe === "total") continue;
    const decl = sum.get(m.classe);
    const lido = posicoes.filter((p) => p.classe_ativo === m.classe).reduce((a, p) => a + p.valor_centavos, 0);
    if (decl !== undefined) parciais.push(item(`Sumário, ${m.nome}`, decl, lido));
    else if (lido !== 0) avisos.push(`Sumário sem linha de "${m.nome}", mas há posições lidas dessa classe.`);
  }
  const total = sum.get("total") ?? null;
  if (total === null) avisos.push("Total do sumário não localizado: a soma das posições não pôde ser conferida.");
  if (posicoes.length === 0) return { ok: false, erro: "Extrato BTG Pactual reconhecido, mas nenhuma posição foi lida. Se o PDF foi lido por OCR, tente a versão com camada de texto." };

  const conferencia: Conferencia = {
    soma_posicoes_centavos: somaPosicoes,
    total_declarado_centavos: total,
    diferenca_centavos: total === null ? null : somaPosicoes - total,
    confere: total === null ? null : somaPosicoes === total,
    parciais,
  };
  const extrato: ExtratoLido = {
    leitor: "btg_brasil", instituicao: "BTG Pactual", conta, moeda: "BRL", periodo_inicio: ini, periodo_fim: fim, posicoes, movimentos, total_declarado_centavos: total, conferencia, avisos,
    ...(setorial.length > 0 ? { distribuicao_setorial: setorial } : {}),
  };
  return { ok: true, extrato };
}
