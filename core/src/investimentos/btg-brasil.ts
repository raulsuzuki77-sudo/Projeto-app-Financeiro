import { acharSequencia, centavosBR, colapsar, dataDMA, ehTraco, numeroBR, sa, textoDasLinhas, tokens, ultimos4 } from "./texto";
import type { ClasseAtivo, Conferencia, ConferenciaItem, ExtratoLido, LinhaTexto, MovimentoLido, PosicaoLida, ResultadoLeitura, TipoMovimento } from "./tipos";

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

const ehCelula = (t: string): boolean => ehTraco(t) || centavosBR(t) !== null;
const ehData = (t: string): boolean => RE_DATA.test(t) && dataDMA(t) !== null;

/** Linhas de cabecalho e rodape que se repetem em cada pagina. */
function ehRuido(n: string): boolean {
  if (/^periodo de \d/.test(n) || /^emitido em/.test(n)) return true;
  const palavras = n.split(" ");
  return palavras.every((p) => ["extrato", "da", "conta", "investimento"].includes(p));
}

export function ehExtratoBtgBrasil(linhas: LinhaTexto[]): boolean {
  const t = sa(textoDasLinhas(linhas).join(" "));
  return /btg\s*pactual/.test(t) && /sumario/.test(t) && /saldo bruto/.test(t) && /conta investimento\s+\d/.test(t) && /periodo de \d{2}\/\d{2}\/\d{2}/.test(t);
}

interface Secao {
  tipo: "sumario" | "prev_pos" | "prev_mov" | "rv_pos" | "rv_mov" | "cc_pos" | "cc_mov" | "tr_rv" | "tr_prev" | "ignorar";
  sub: string;
  linhas: string[];
}

function cabecalho(n: string, original: string): { tipo: Secao["tipo"]; sub: string } | null {
  if (/^sumario\s*-\s*distribuicao/.test(n)) return { tipo: "sumario", sub: "" };
  if (/^previdencia\s+\w+\s*-\s*posicao\s*-/.test(n)) return { tipo: "prev_pos", sub: original };
  if (/^previdencia\s+\w+\s*-\s*movimentacao/.test(n)) return { tipo: "prev_mov", sub: original };
  if (/^previdencia\s+\w+\s*-\s*(plano|rentabilidade|posicoes)/.test(n)) return { tipo: "ignorar", sub: "" };
  let m = /^renda variavel\s*-\s*posicao\s*-\s*(.+)$/.exec(n);
  if (m) return { tipo: "rv_pos", sub: m[1]! };
  m = /^renda variavel\s*-\s*movimentacao\s*-\s*(.+)$/.exec(n);
  if (m) return { tipo: "rv_mov", sub: m[1]! };
  if (/^conta corrente\s*-\s*posicao/.test(n)) return { tipo: "cc_pos", sub: "" };
  if (/^conta corrente\s*-\s*movimentacao/.test(n)) return { tipo: "cc_mov", sub: "" };
  if (/^valores em transito\s*-\s*renda variavel/.test(n)) return { tipo: "tr_rv", sub: "" };
  if (/^valores em transito\s*-\s*previdencia/.test(n)) return { tipo: "tr_prev", sub: "" };
  if (/^(distribuicao (setorial|da carteira)|perfil de risco)/.test(n)) return { tipo: "ignorar", sub: "" };
  return null;
}

function dividirSecoes(linhas: string[]): Secao[] {
  const secoes: Secao[] = [];
  let atual: Secao | null = null;
  for (const l of linhas) {
    const n = sa(l);
    if (/^disclaimers\b/.test(n)) break;
    const c = cabecalho(n, l);
    if (c) {
      atual = { tipo: c.tipo, sub: c.sub, linhas: [] };
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

/** Valor da linha "Total ..." da secao (ultima celula numerica depois da palavra Total), ou null. */
function totalDaSecao(toks: string[]): number | null {
  const i = toks.findIndex((x) => sa(x) === "total");
  if (i < 0) return null;
  const resto = toks.slice(i + 1);
  const { celulas } = separarCelulas(resto);
  for (let j = celulas.length - 1; j >= 0; j--) {
    const v = valorCelula(celulas[j]);
    if (v !== null) return v;
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

// ---------- sumario ----------
const MERCADOS: { chave: string[]; classe: ClasseAtivo | "total"; rotulo: string }[] = [
  { chave: ["previdencia"], classe: "previdencia", rotulo: "Previdência" },
  { chave: ["renda", "variavel"], classe: "renda_variavel", rotulo: "Renda variável" },
  { chave: ["conta", "corrente"], classe: "caixa", rotulo: "Conta corrente" },
  { chave: ["valores", "em", "transito"], classe: "transito", rotulo: "Valores em trânsito" },
  { chave: ["total"], classe: "total", rotulo: "Total" },
];

function lerSumario(sec: Secao | undefined, avisos: string[]): Map<string, number> {
  const saida = new Map<string, number>();
  if (!sec) return saida;
  const toks = tokens(sec.linhas);
  for (const m of MERCADOS) {
    const i = acharSequencia(toks, m.chave);
    if (i < 0) continue;
    const depois = toks.slice(i + m.chave.length);
    const cel: string[] = [];
    for (const t of depois) {
      if (!ehCelula(t) || cel.length === 4) break;
      cel.push(t);
    }
    if (cel.length !== 4) {
      avisos.push(`Sumário: não foi possível ler as quatro colunas de "${m.rotulo}".`);
      continue;
    }
    // Saldo Bruto na data do extrato (terceira coluna)
    saida.set(m.classe, valorCelula(cel[2]) ?? 0);
  }
  return saida;
}

// ---------- previdencia ----------
function lerPrevidenciaPosicoes(sec: Secao, avisos: string[]): { posicoes: PosicaoLida[]; totalSecao: number | null } {
  const toks = tokens(sec.linhas);
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
    posicoes.push({ classe_ativo: "previdencia", ativo: nome.join(" ") || "Fundo de previdência", codigo: toks[i]!, quantidade: numeroBR(cel[0]!), valor_centavos: valor });
    inicioNome = i + 1 + iniCel + 1 + cel.length;
  }
  return { posicoes, totalSecao: totalDaSecao(toks.slice(inicioNome)) };
}

function tipoPrevidencia(trans: string): TipoMovimento {
  const n = sa(trans);
  if (/contribu|aporte|portabilidade.*entrada/.test(n)) return "aporte";
  if (/resgate|retirada|saque|renda/.test(n)) return "resgate";
  return "outro";
}

function lerPrevidenciaMov(sec: Secao, avisos: string[]): MovimentoLido[] {
  const toks = tokens(sec.linhas);
  const ancoras = toks.map((t, i) => (ehData(t) ? i : -1)).filter((i) => i >= 0);
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
    out.push({ data_local: data, tipo, descricao: `Previdência: ${trans}`, codigo: null, valor_centavos: tipo === "outro" ? v : Math.abs(v), em_transito: false });
  }
  return out;
}

// ---------- renda variavel ----------
function lerRvPosicoes(sec: Secao, avisos: string[]): { posicoes: PosicaoLida[]; totalSecao: number | null } {
  const toks = tokens(sec.linhas);
  const tipo = tipoSubRV(sec.sub);
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
    if (cabeca.length > 1 && /^FI[A-Z]*$/.test(cabeca[cabeca.length - 1]!) && sa(sec.sub).includes("fundos")) cabeca.pop();
    const qtd = numeroBR(celulas[0]!);
    const preco = valorCelula(celulas[1]);
    if (qtd !== null && preco !== null && Math.abs(Math.round(qtd * preco) - valor) > 2) {
      avisos.push(`${codigo}: quantidade x preço (${Math.round(qtd * preco)}) difere do saldo bruto informado (${valor}) em centavos.`);
    }
    posicoes.push({ classe_ativo: "renda_variavel", ativo: `${cabeca.join(" ") || codigo} (${tipo})`, codigo, quantidade: qtd, valor_centavos: valor });
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
    out.push({ data_local: data, tipo, descricao: codigo ? `${trans} ${codigo}` : trans, codigo, valor_centavos: ajustarSinal(tipo, v, trans), em_transito: false });
  }
  return out;
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
  return { classe_ativo: "caixa", ativo: "Conta corrente", codigo: null, quantidade: null, valor_centavos: valor };
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
function lerTransito(sec: Secao, periodoFim: string, avisos: string[]): { movimentos: MovimentoLido[]; soma: number; totalSecao: number | null; itens: number } {
  const toks = tokens(sec.linhas);
  const ancoras = toks.map((t, i) => (ehData(t) || sa(t) === "n/d" ? i : -1)).filter((i) => i >= 0);
  const movimentos: MovimentoLido[] = [];
  let soma = 0;
  let itens = 0;
  for (const b of blocos(toks, ancoras)) {
    const data = ehData(b[0]!) ? dataDMA(b[0]!)! : periodoFim;
    const { cabeca, celulas } = separarCelulas(b.slice(1));
    const v = valorCelula(celulas[celulas.length - 1]);
    const desc = cabeca.join(" ");
    if (v === null || desc === "") {
      avisos.push(`Valores em trânsito: item de ${b[0]} não foi lido por completo (${desc}).`);
      continue;
    }
    soma += v;
    itens++;
    const n = sa(desc);
    let tipo: TipoMovimento = "outro";
    if (/contribu|aporte/.test(n)) tipo = "aporte";
    else if (/resgate|retirada|saque/.test(n)) tipo = "resgate";
    else if (/^compra\b/.test(n)) tipo = "compra";
    else if (/^venda\b/.test(n)) tipo = "venda";
    else if (/rendimento|dividendo|juros|jcp|provento|amortizacao/.test(n)) tipo = "provento";
    const codigo = cabeca.find((x) => RE_TICKER.test(x)) ?? null;
    movimentos.push({ data_local: data, tipo, descricao: `Em trânsito: ${desc}`, codigo, valor_centavos: tipo === "outro" || tipo === "provento" ? v : Math.abs(v), em_transito: true });
  }
  return { movimentos, soma, totalSecao: totalDaSecao(toks), itens };
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
  const secoes = dividirSecoes(limpas);
  const por = (tipo: Secao["tipo"]) => secoes.filter((s) => s.tipo === tipo);

  const posicoes: PosicaoLida[] = [];
  const movimentos: MovimentoLido[] = [];
  const parciais: ConferenciaItem[] = [];

  for (const s of por("prev_pos")) {
    const r = lerPrevidenciaPosicoes(s, avisos);
    posicoes.push(...r.posicoes);
    if (r.totalSecao !== null) parciais.push(item("Previdência (total da seção)", r.totalSecao, r.posicoes.reduce((a, p) => a + p.valor_centavos, 0)));
  }
  for (const s of por("prev_mov")) movimentos.push(...lerPrevidenciaMov(s, avisos));

  for (const s of por("rv_pos")) {
    const r = lerRvPosicoes(s, avisos);
    posicoes.push(...r.posicoes);
    if (r.totalSecao !== null) parciais.push(item(`Renda variável, ${tipoSubRV(s.sub)} (total da seção)`, r.totalSecao, r.posicoes.reduce((a, p) => a + p.valor_centavos, 0)));
    else if (r.posicoes.length > 0) avisos.push(`Renda variável (${tipoSubRV(s.sub)}): total da seção não localizado.`);
  }
  for (const s of por("rv_mov")) movimentos.push(...lerRvMov(s, avisos));

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

  for (const [tipo, rotulo] of [["tr_rv", "renda variável"], ["tr_prev", "previdência"]] as const) {
    for (const s of por(tipo)) {
      const r = lerTransito(s, fim, avisos);
      movimentos.push(...r.movimentos);
      if (r.itens > 0 || r.totalSecao !== null) {
        posicoes.push({ classe_ativo: "transito", ativo: `Valores em trânsito (${rotulo})`, codigo: null, quantidade: null, valor_centavos: r.soma });
        if (r.totalSecao !== null) parciais.push(item(`Valores em trânsito, ${rotulo} (total da seção)`, r.totalSecao, r.soma));
      }
    }
  }

  const sum = lerSumario(por("sumario")[0], avisos);
  const somaPosicoes = posicoes.reduce((a, p) => a + p.valor_centavos, 0);
  for (const m of MERCADOS) {
    if (m.classe === "total") continue;
    const decl = sum.get(m.classe);
    const lido = posicoes.filter((p) => p.classe_ativo === m.classe).reduce((a, p) => a + p.valor_centavos, 0);
    if (decl !== undefined) parciais.push(item(`Sumário, ${m.rotulo}`, decl, lido));
    else if (lido !== 0) avisos.push(`Sumário sem linha de "${m.rotulo}", mas há posições lidas dessa classe.`);
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
  const extrato: ExtratoLido = { leitor: "btg_brasil", instituicao: "BTG Pactual", conta, moeda: "BRL", periodo_inicio: ini, periodo_fim: fim, posicoes, movimentos, total_declarado_centavos: total, conferencia, avisos };
  return { ok: true, extrato };
}
