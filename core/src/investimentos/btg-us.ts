import { acharSequencia, centavosUS, colapsar, dataIso, numeroUS, sa, textoDasLinhas, tokens, ultimos4 } from "./texto";
import type { ClasseAtivo, Conferencia, ConferenciaItem, DetalhePosicao, ExtratoLido, LinhaTexto, MovimentoLido, PosicaoLida, ResultadoLeitura, TipoMovimento } from "./tipos";

/**
 * Leitor do "Account Statement" da BTG Pactual US Capital (custodia DriveWealth), em dolares.
 * Valores em centavos de dolar. Numeros no formato americano (1,234.56; negativos entre parenteses).
 */

const MESES: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const NUM = String.raw`\(?-?\$?[\d,]*\.?\d+\)?`;
const RE_POSICAO = new RegExp(String.raw`^(.*?)\s*(\S+)\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+([A-Z]{1,2})$`);
const RE_DATA_US = /^\d{2}\/\d{2}\/\d{4}$/;

const ehDinheiro = (t: string): boolean => /^\(?-?\$?\d[\d,]*\.\d+\)?$/.test(t) && centavosUS(t) !== null;

const MARCAS_US: [string, RegExp][] = [
  ["BTG Pactual US", /btg\s*pactual\s*us/],
  ["Account Statement", /account\s*statement/],
  ["Ending Account Value", /ending\s*account\s*value/],
];

export function marcasBtgUS(linhas: LinhaTexto[]): [string, boolean][] {
  const t = sa(textoDasLinhas(linhas).join(" "));
  return MARCAS_US.map(([nome, re]) => [nome, re.test(t)]);
}

export function ehExtratoBtgUS(linhas: LinhaTexto[]): boolean {
  return marcasBtgUS(linhas).every(([, ok]) => ok);
}

/**
 * Cabecalho e rodape repetidos em cada pagina. Tolerante a linhas mescladas pela posicao (ex.: "Account Statement 601 LEXINGTON AVENUE"):
 * as marcas do cabecalho valem em qualquer ponto da linha, pois nenhuma linha de posicao ou de atividade as contem.
 */
function ehRuido(l: string): boolean {
  return (
    /^Page \d+ of \d+/i.test(l) ||
    /^Clearing and execution services/i.test(l) ||
    /^Custodial services provided/i.test(l) ||
    /^All DriveWealth trademarks/i.test(l) ||
    /^third party and are the property/i.test(l) ||
    /BTG Pactual US Capital/i.test(l) ||
    /^Account Statement\b/i.test(l) ||
    /\b\d+(st|nd|rd|th) FLOOR\b/i.test(l) ||
    /\bNew York NY\b/i.test(l) ||
    /\bAccount Number:/i.test(l) ||
    /[A-Za-z]+ \d{1,2}, \d{4}\s*-\s*[A-Za-z]+ \d{1,2}, \d{4}/.test(l)
  );
}

const PALAVRAS_CABECALHO = new Set(["description", "symbol", "quantity", "unit", "cost", "total", "market", "price", "value", "gain/", "(loss)", "gain/(loss)", "loss)", "a/c", "type", "gain"]);
const ehCabecalhoColunas = (l: string): boolean => {
  const p = sa(l).split(" ");
  return p.length >= 1 && p.every((w) => PALAVRAS_CABECALHO.has(w)) && p.some((w) => ["description", "symbol", "quantity", "market"].includes(w));
};

function classeDoCabecalho(l: string): ClasseAtivo | null {
  // so linhas de letras: "(Bonds 02/56)" continua o nome de um titulo e nao e o cabecalho "Bonds"
  if (!/^[A-Za-z][A-Za-z &/]*$/.test(l.trim())) return null;
  const n = sa(l).replace(/[^a-z]/g, "");
  if (["fixedincome", "bonds", "treasuries"].includes(n)) return "renda_fixa";
  if (["moneymarketfunds", "moneymarket", "cash", "cashequivalents", "cashandcashequivalents", "sweep"].includes(n)) return "caixa";
  if (["equities", "stocks", "options", "mutualfunds", "etfs", "etf", "funds"].includes(n)) return "renda_variavel";
  if (["otherassets", "alternativeassets", "other"].includes(n)) return "outros";
  return null;
}

const ehCabecalhoSecao = (l: string): boolean => /^[A-Z][A-Z &/]{6,}$/.test(l);

function parenAbertos(s: string): number {
  return (s.match(/\(/g)?.length ?? 0) - (s.match(/\)/g)?.length ?? 0);
}

/** Especie padrao pelo cabecalho da secao (a descricao do titulo refina a renda fixa). */
function especieDoCabecalho(l: string): string | null {
  const n = sa(l).replace(/[^a-z]/g, "");
  if (["fixedincome", "bonds", "treasuries"].includes(n)) return "Renda fixa (EUA)";
  if (["moneymarketfunds", "moneymarket", "cash", "cashequivalents", "cashandcashequivalents", "sweep"].includes(n)) return "Cash";
  if (["equities", "stocks"].includes(n)) return "Ações (EUA)";
  if (["etfs", "etf"].includes(n)) return "ETFs (EUA)";
  if (["mutualfunds", "funds"].includes(n)) return "Fundos (EUA)";
  if (n === "options") return "Opções (EUA)";
  if (["otherassets", "alternativeassets", "other"].includes(n)) return "Outros";
  return null;
}

const RE_SWEEP = /bank sweep|sweep program|\bDWBDS\b/i;

/** Especie, vencimento e cupom de um titulo do Tesouro americano a partir da descricao do extrato. */
function detalharTitulo(descricao: string): { especie: string | null; vencimento?: string; cupom?: number } {
  const t = /treasury\s+(bills?|notes?|bonds?)/i.exec(descricao);
  const especie = t ? `Treasury ${t[1]!.charAt(0).toUpperCase()}${t[1]!.slice(1).toLowerCase().replace(/s?$/, "s")}` : null;
  const v = /(\d+(?:\.\d+)?)%\s+(?:BILL|NTS|BDS)\s+(\d{2})\/(\d{2})\/(\d{4})/i.exec(descricao);
  const out: { especie: string | null; vencimento?: string; cupom?: number } = { especie };
  if (v) {
    const iso = dataIso(Number(v[4]), Number(v[3]), Number(v[2]));
    if (iso) out.vencimento = iso;
    out.cupom = Number(v[1]);
  }
  return out;
}

function lerHoldings(linhas: string[], avisos: string[]): PosicaoLida[] {
  const posicoes: PosicaoLida[] = [];
  const rotulosCustoZero: string[] = [];
  let classe: ClasseAtivo | null = null;
  let especieSecao: string | null = null;
  let pend: string[] = [];
  let ultima: PosicaoLida | null = null;
  const dados = new Map<PosicaoLida, { unit: number; total: number; gain: number }>();
  for (const l of linhas) {
    const c = classeDoCabecalho(l);
    if (c) {
      classe = c;
      especieSecao = especieDoCabecalho(l);
      pend = [];
      ultima = null;
      continue;
    }
    if (ehCabecalhoColunas(l)) continue;
    const junto = [...pend, l].join(" ");
    const m = RE_POSICAO.exec(junto);
    const cel = m ? [m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!] : null;
    if (m && cel && cel.every((x) => centavosUS(x) !== null)) {
      const valor = centavosUS(m[7]!)!;
      if (classe === null) avisos.push(`Posição ${m[2]} fora de uma seção conhecida (renda fixa, caixa...): classe "outros".`);
      const p: PosicaoLida = {
        classe_ativo: classe ?? "outros",
        ativo: m[1]!.trim() || m[2]!,
        codigo: m[2]!,
        quantidade: numeroUS(m[3]!),
        valor_centavos: valor,
        especie: especieSecao,
        preco_fechamento: numeroUS(m[6]!),
        preco_medio: null,
        custo_total_centavos: null,
        detalhe: { tipo_conta: m[9]! },
      };
      dados.set(p, { unit: numeroUS(m[4]!) ?? 0, total: centavosUS(m[5]!) ?? 0, gain: centavosUS(m[8]!) ?? 0 });
      posicoes.push(p);
      ultima = p;
      pend = [];
      continue;
    }
    if (ultima && (parenAbertos(ultima.ativo) > 0 || l.startsWith("("))) {
      ultima.ativo = `${ultima.ativo} ${l}`;
      continue;
    }
    pend.push(l);
  }
  for (const p of posicoes) {
    const d = dados.get(p)!;
    const det: DetalhePosicao = p.detalhe ?? {};
    det.descricao_original = p.ativo;
    // saldo de caixa do programa de varredura (DWBDS): chamado de "Cash"
    if (RE_SWEEP.test(p.ativo) || RE_SWEEP.test(p.codigo ?? "")) {
      p.ativo = "Cash";
      p.especie = "Cash";
      p.classe_ativo = "caixa";
    } else if (p.classe_ativo === "renda_fixa") {
      const t = detalharTitulo(p.ativo);
      if (t.especie) p.especie = t.especie;
      if (t.vencimento) det.vencimento = t.vencimento;
      if (t.cupom !== undefined) det.cupom = t.cupom;
    }
    // titulos cotados por 100 de valor de face: valor = quantidade x preco x 0,01
    if (p.quantidade !== null && p.preco_fechamento != null && p.preco_fechamento > 0) {
      const v = p.valor_centavos;
      const erro1 = Math.abs(Math.round(p.quantidade * p.preco_fechamento * 100) - v);
      const erro2 = Math.abs(Math.round(p.quantidade * p.preco_fechamento) - v);
      const melhor = erro2 < erro1 ? 0.01 : 1;
      det.fator_preco = melhor;
      if (Math.min(erro1, erro2) > Math.max(2, Math.abs(v) * 0.005)) avisos.push(`${p.codigo}: quantidade x preço difere do valor de mercado informado em mais de 0,5%.`);
    }
    // custo: 0,00 (comum apos transferencia ACATS) NAO e custo zero, e custo nao informado; nunca vira lucro de 100%
    if (d.total > 0) {
      p.custo_total_centavos = d.total;
      if (d.unit > 0 && p.classe_ativo !== "caixa") p.preco_medio = d.unit;
      det.gain_loss_extrato_centavos = d.gain;
    } else if (p.classe_ativo !== "caixa") rotulosCustoZero.push(p.codigo ?? p.ativo);
    p.detalhe = det;
  }
  if (rotulosCustoZero.length > 0) {
    avisos.push(`Custo 0,00 no extrato (${rotulosCustoZero.join(", ")}), típico de transferência ACATS: tratado como NÃO informado, sem lucro calculado. Informe o preço médio do ativo para ver o resultado.`);
  }
  return posicoes;
}

function tipoAtividade(tp: string): { tipo: TipoMovimento; rotulo: string } {
  switch (tp.toUpperCase()) {
    case "ACATS": return { tipo: "custodia", rotulo: "Transferência de títulos recebida (ACATS)" };
    case "ACATC": return { tipo: "custodia", rotulo: "Transferência de caixa recebida (ACATC)" };
    case "BUY": return { tipo: "compra", rotulo: "Compra" };
    case "SELL": return { tipo: "venda", rotulo: "Venda" };
    case "DIV": case "DIVIDEND": return { tipo: "provento", rotulo: "Dividendo" };
    case "INT": case "INTEREST": return { tipo: "provento", rotulo: "Juros" };
    case "DEP": case "DEPOSIT": case "ACH": case "WIRE": case "CSD": return { tipo: "aporte", rotulo: "Depósito" };
    case "WDL": case "WITHDRAWAL": case "CSW": return { tipo: "resgate", rotulo: "Saque" };
    default: return { tipo: "outro", rotulo: tp };
  }
}

const CABECALHO_ATIVIDADE = ["trade", "date", "settle", "date", "currency", "activity", "type", "symbol", "/", "description", "quantity", "price", "amount"];
const RE_VALOR_ATIVIDADE = /^\(?-?\$?[\d,]+\.\d{2}\)?$/;

/** Atividade lida por tokens: cada registro comeca em "data de negociacao, data de liquidacao, moeda" e vai ate o proximo. */
function lerAtividade(linhas: string[], avisos: string[]): MovimentoLido[] {
  let toks = tokens(linhas);
  for (let i = acharSequencia(toks, CABECALHO_ATIVIDADE); i >= 0; i = acharSequencia(toks, CABECALHO_ATIVIDADE)) toks = [...toks.slice(0, i), ...toks.slice(i + CABECALHO_ATIVIDADE.length)];
  const ancoras: number[] = [];
  for (let i = 0; i + 3 < toks.length; i++) {
    if (RE_DATA_US.test(toks[i]!) && RE_DATA_US.test(toks[i + 1]!) && /^[A-Z]{3}$/.test(toks[i + 2]!)) ancoras.push(i);
  }
  const out: MovimentoLido[] = [];
  let semValor = 0;
  for (let k = 0; k < ancoras.length; k++) {
    const b = toks.slice(ancoras[k]!, k + 1 < ancoras.length ? ancoras[k + 1]! : toks.length);
    const [mm, dd, aaaa] = b[0]!.split("/").map(Number) as [number, number, number];
    const data = dataIso(aaaa, mm, dd);
    if (!data) {
      avisos.push(`Atividade com data inválida (${b[0]}).`);
      continue;
    }
    const tp = b[3]!;
    const resto = b.slice(4);
    // valor: ultimo numero com duas casas decimais do registro; antes dele, preco e quantidade
    let iv = -1;
    for (let i = resto.length - 1; i >= 0; i--) if (RE_VALOR_ATIVIDADE.test(resto[i]!)) { iv = i; break; }
    let valor: number | null = null;
    let corpo = resto;
    let qtd: number | null = null;
    let preco: number | null = null;
    if (iv >= 0) {
      valor = centavosUS(resto[iv]!);
      corpo = resto.slice(0, iv);
      const n = corpo.length;
      if (n >= 2 && numeroUS(corpo[n - 1]!) !== null && numeroUS(corpo[n - 2]!) !== null) {
        qtd = numeroUS(corpo[n - 2]!);
        preco = numeroUS(corpo[n - 1]!);
        corpo = corpo.slice(0, n - 2);
      }
    }
    const { tipo, rotulo } = tipoAtividade(tp);
    const simbolo = /^[A-Z0-9.]{1,12}$/.test(corpo[0] ?? "") && corpo[1] === "-" ? corpo[0]! : null;
    const detalhe = corpo.join(" ").replace(/\s*-?\s*\d+:ACAT\S*.*$/i, "").replace(/:\s*$/, "").trim();
    if (valor === null) {
      avisos.push(`Atividade ${tp} de ${data} sem valor legível.`);
      valor = 0;
    }
    if (tipo === "custodia" && valor === 0) semValor++;
    const v = tipo === "aporte" || tipo === "resgate" || tipo === "compra" || tipo === "venda" ? Math.abs(valor) : valor;
    out.push({ data_local: data, tipo, descricao: detalhe ? `${rotulo}: ${detalhe}`.slice(0, 140) : rotulo, codigo: simbolo, valor_centavos: v, em_transito: false, quantidade: qtd, preco: preco !== null && preco > 0 ? preco : null });
  }
  if (semValor > 0) avisos.push(`${semValor} transferência(s) de títulos (ACATS) sem valor informado no extrato: os títulos entram nas posições, mas o valor não entra nos aportes.`);
  return out;
}

function valorRotulo(toks: string[], palavras: string[], posicao: 1 | 2): number | null {
  for (let i = acharSequencia(toks, palavras); i >= 0; i = acharSequencia(toks, palavras, i + 1)) {
    const seg = toks.slice(i + palavras.length, i + palavras.length + 3);
    const d = seg.filter((t) => t.startsWith("$") || ehDinheiro(t));
    if (d.length >= posicao) return centavosUS(d[posicao - 1]!);
  }
  return null;
}

export function lerExtratoBtgUS(linhasBrutas: LinhaTexto[]): ResultadoLeitura {
  const avisos: string[] = [];
  const todas = textoDasLinhas(linhasBrutas);
  const texto = todas.join(" ");
  const re = /([A-Za-z]+) (\d{1,2}), (\d{4})\s*-\s*([A-Za-z]+) (\d{1,2}), (\d{4})/g;
  let ini: string | null = null;
  let fim: string | null = null;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const m1 = MESES[m[1]!.toLowerCase()];
    const m2 = MESES[m[4]!.toLowerCase()];
    if (m1 && m2) {
      ini = dataIso(Number(m[3]), m1, Number(m[2]));
      fim = dataIso(Number(m[6]), m2, Number(m[5]));
      if (ini && fim) break;
    }
  }
  if (!ini || !fim) return { ok: false, erro: "Extrato BTG Pactual US reconhecido, mas o período (\"Month dd, yyyy - Month dd, yyyy\") não foi localizado." };
  const mConta = /Account Number:\s*([A-Za-z0-9-]+)/i.exec(texto);
  if (!mConta) avisos.push("Número da conta não localizado; a conta ficará sem identificação.");
  const conta = mConta ? ultimos4(mConta[1]!) : "";

  // Resumo (primeira pagina): valor final da conta e alocacao por classe
  const resumoToks = tokens(todas.slice(0, todas.findIndex((l) => /^Page 1 of/i.test(l)) >= 0 ? todas.findIndex((l) => /^Page 1 of/i.test(l)) : todas.length));
  const total = valorRotulo(resumoToks, ["ending", "account", "value"], 1);
  if (total === null) avisos.push("\"Ending Account Value\" não localizado: a soma das posições não pôde ser conferida.");

  const limpas = todas.filter((l) => !ehRuido(l));
  let secao: "holdings" | "activity" | null = null;
  const lHold: string[] = [];
  const lAtiv: string[] = [];
  for (const l of limpas) {
    if (/^HOLDINGS$/i.test(l) && l === l.toUpperCase()) { secao = "holdings"; continue; }
    if (/^ACTIVITY$/i.test(l) && l === l.toUpperCase()) { secao = "activity"; continue; }
    if (ehCabecalhoSecao(l) && !classeDoCabecalho(l)) { secao = null; continue; }
    if (secao === "holdings") lHold.push(l);
    else if (secao === "activity") lAtiv.push(l);
  }
  const posicoes = lerHoldings(lHold, avisos);
  const movimentos = lerAtividade(lAtiv, avisos);
  if (posicoes.length === 0) return { ok: false, erro: "Extrato BTG Pactual US reconhecido, mas nenhuma posição (HOLDINGS) foi lida." };

  const soma = posicoes.reduce((a, p) => a + p.valor_centavos, 0);
  const parciais: ConferenciaItem[] = [];
  const alocacao: [string[], ClasseAtivo[], string][] = [
    [["cash", "&", "cash", "equivalents"], ["caixa"], "Cash & Cash Equivalents"],
    [["fixed", "income"], ["renda_fixa"], "Fixed Income"],
    [["equities"], ["renda_variavel"], "Equities"],
    [["mutual", "funds"], ["renda_variavel"], "Mutual Funds"],
    [["options"], ["renda_variavel"], "Options"],
    [["other", "assets"], ["outros"], "Other Assets"],
  ];
  // Equities, Mutual Funds e Options compartilham a classe renda_variavel: compara o conjunto
  let declRV = 0;
  let achouRV = false;
  for (const [pal, classes, nome] of alocacao) {
    const d = valorRotulo(resumoToks, pal, 2);
    if (d === null) continue;
    if (classes[0] === "renda_variavel") { declRV += d; achouRV = true; continue; }
    const lido = posicoes.filter((p) => classes.includes(p.classe_ativo)).reduce((a, p) => a + p.valor_centavos, 0);
    parciais.push({ rotulo: `Asset Allocation, ${nome}`, declarado_centavos: d, lido_centavos: lido, diferenca_centavos: lido - d, confere: lido === d });
  }
  if (achouRV) {
    const lido = posicoes.filter((p) => p.classe_ativo === "renda_variavel").reduce((a, p) => a + p.valor_centavos, 0);
    parciais.push({ rotulo: "Asset Allocation, Equities/Mutual Funds/Options", declarado_centavos: declRV, lido_centavos: lido, diferenca_centavos: lido - declRV, confere: lido === declRV });
  }
  const conferencia: Conferencia = { soma_posicoes_centavos: soma, total_declarado_centavos: total, diferenca_centavos: total === null ? null : soma - total, confere: total === null ? null : soma === total, parciais };
  const extrato: ExtratoLido = { leitor: "btg_us", instituicao: "BTG Pactual US", conta, moeda: "USD", periodo_inicio: ini, periodo_fim: fim, posicoes, movimentos, total_declarado_centavos: total, conferencia, avisos };
  return { ok: true, extrato };
}
