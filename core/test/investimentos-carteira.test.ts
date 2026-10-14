import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { abrirBancoTeste } from "./helpers";
import { itensParaLinhas } from "../../app/src/lib/extrato-pdf-linhas";
import {
  adicionarPosicaoManual, conciliarSetores, definirCambio, detectarExtrato, evolucaoPatrimonio, exportarDados, lerExtratoInvestimento, listarCadastroAtivos, listarExtratos,
  montarCarteira, novoDiagnostico, ocultarDadosPessoais, patrimonio, pizzasDaCarteira, prepararBanco, registrarLinhas, removerCadastroAtivo, removerExtrato, restaurarDados, salvarCadastroAtivo, salvarExtrato,
  textoDiagnostico,
  type Db, type ExtratoLido, type LinhaTexto,
} from "../src/index";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ler = (nome: string) => readFileSync(join(AQUI, "fixtures-investimentos", nome), "utf8").split("\n");
const comoLinhas = (ls: string[]): LinhaTexto[] => ls.filter((l) => l.trim() !== "").map((texto) => ({ texto }));
const U = "u";

function lerOk(linhas: LinhaTexto[]): ExtratoLido {
  const r = lerExtratoInvestimento(linhas);
  assert.ok(r.ok, r.ok ? "" : r.erro);
  return r.extrato;
}

// ---------------------------------------------------------------------------------------------
// Detalhe por ativo (BTG Brasil): previdencia, setor, preco medio
// ---------------------------------------------------------------------------------------------

test("BTG Brasil: previdencia traz CNPJ, cotacao, rentabilidade, aliquota, IR e valor liquido; conferida pelo saldo", () => {
  const e = lerOk(comoLinhas(ler("btg-brasil-sintetico.txt")));
  const p = e.posicoes.find((x) => x.classe_ativo === "previdencia")!;
  assert.equal(p.cnpj, "11.111.111/0001-11");
  assert.equal(p.especie, "PGBL");
  assert.equal(p.preco_fechamento, 2.5);
  assert.equal(p.preco_medio, null);
  assert.deepEqual(p.detalhe!.rentabilidade, { benchmark: "CDI", fundo_mes: 1, benchmark_mes: 1.05, fundo_ano: 9.5, benchmark_ano: 9.6, fundo_12m: 13, benchmark_12m: 13.5 });
  assert.equal(p.detalhe!.regime, "regressivo");
  assert.equal(p.detalhe!.data_referencia, "2026-09-30");
  assert.deepEqual(p.detalhe!.aliquotas, [{ aliquota: 35, cotas: 1000, liquido_centavos: 162500, ir_centavos: 87500, bruto_centavos: 250000 }]);
  assert.equal(p.detalhe!.valor_liquido_centavos, 162500);
  assert.equal(p.detalhe!.ir_centavos, 87500);
  const parcial = e.conferencia.parciais.find((x) => x.rotulo.includes("posições por alíquota"));
  assert.ok(parcial && parcial.confere);
  // o movimento da previdencia fica ligado ao fundo pelo CNPJ e traz cotas e valor da cota
  const mov = e.movimentos.find((m) => m.descricao.startsWith("Previdência:"))!;
  assert.deepEqual([mov.codigo, mov.quantidade, mov.preco], ["11.111.111/0001-11", 200, 2.4]);
});

test("BTG Brasil: preco medio '-' fica nao informado (nunca zero); ETF com preco medio e preco de fechamento", () => {
  const e = lerOk(comoLinhas(ler("btg-brasil-sintetico.txt")));
  const rv = new Map(e.posicoes.filter((x) => x.classe_ativo === "renda_variavel").map((x) => [x.codigo, x]));
  assert.equal(rv.get("ABCD3")!.preco_medio, null);
  assert.equal(rv.get("MNOP11")!.preco_medio, null);
  assert.equal(rv.get("IJKL11")!.preco_medio, 99);
  assert.equal(rv.get("IJKL11")!.preco_fechamento, 100);
  assert.equal(rv.get("MNOP11")!.preco_fechamento, 50.25);
  assert.ok(e.posicoes.every((x) => x.preco_medio === null || x.preco_medio === undefined || x.preco_medio > 0));
  // movimentos por ativo trazem quantidade e preco
  const dep = e.movimentos.find((m) => m.codigo === "ABCD3" && m.tipo === "custodia")!;
  assert.deepEqual([dep.quantidade, dep.preco], [10, 19.5]);
});

test("BTG Brasil: distribuicao setorial e guardada e concilia setor com os saldos das acoes", () => {
  const e = lerOk(comoLinhas(ler("btg-brasil-sintetico.txt")));
  assert.deepEqual(e.distribuicao_setorial, [{ setor: "BANCOS", pct: 57.06 }, { setor: "ENERGIA ELÉTRICA", pct: 42.94 }]);
  const setores = Object.fromEntries(e.posicoes.filter((x) => x.especie === "Ações").map((x) => [x.codigo, x.detalhe?.setor]));
  assert.deepEqual(setores, { ABCD3: "Bancos", EFGH4: "Energia elétrica" });
});

test("conciliarSetores: so atribui o que e inequivoco; ambiguidade, soma errada e falta de solucao geram aviso", () => {
  const acoes = [{ id: "A", valor_centavos: 78862 }, { id: "B", valor_centavos: 48447 }, { id: "C", valor_centavos: 32406 }, { id: "D", valor_centavos: 26310 }];
  const ok = conciliarSetores(acoes, [{ setor: "SERVIÇOS FINANCEIROS DIVERSOS", pct: 42.39 }, { setor: "BANCOS", pct: 26.04 }, { setor: "ENERGIA ELÉTRICA", pct: 17.42 }, { setor: "AGRICULTURA", pct: 14.14 }]);
  assert.deepEqual([...ok.atribuicao.entries()], [["A", "Serviços financeiros diversos"], ["B", "Bancos"], ["C", "Energia elétrica"], ["D", "Agricultura"]]);
  assert.equal(ok.avisos.length, 0);
  // duas acoes com o mesmo saldo: nao ha como saber qual e qual
  const iguais = conciliarSetores([{ id: "A", valor_centavos: 10000 }, { id: "B", valor_centavos: 10000 }, { id: "C", valor_centavos: 20000 }], [{ setor: "X", pct: 25 }, { setor: "Y", pct: 25 }, { setor: "Z", pct: 50 }]);
  assert.deepEqual([...iguais.atribuicao.entries()], [["C", "Z"]]);
  assert.ok(iguais.avisos.some((a) => a.includes("ambiguidade")));
  // percentuais que nao somam 100
  const soma = conciliarSetores(acoes, [{ setor: "X", pct: 60 }, { setor: "Y", pct: 20 }]);
  assert.equal(soma.atribuicao.size, 0);
  assert.ok(soma.avisos[0]!.includes("não 100%"));
  // saldos que nao batem com nenhuma combinacao
  const nada = conciliarSetores(acoes, [{ setor: "X", pct: 70 }, { setor: "Y", pct: 30 }]);
  assert.equal(nada.atribuicao.size, 0);
  assert.ok(nada.avisos[0]!.includes("não pôde ser conciliada"));
});

test("BTG Brasil: secao desconhecida e avisada (nunca ignorada em silencio) e nao contamina a secao anterior", () => {
  const txt = ler("btg-brasil-sintetico.txt").join("\n").replace("Conta corrente - Posição", "Fundos de Investimento - Posição\nFundo X          1.000,00\n\nConta corrente - Posição");
  const e = lerOk(comoLinhas(txt.split("\n")));
  assert.ok(e.avisos.some((a) => a.includes("Fundos de Investimento - Posição") && a.includes("NÃO foi lida")));
  assert.equal(e.conferencia.confere, true);
});

test("BTG Brasil: renda fixa (layout generico) so e lida se a soma de uma coluna fecha com o total; senao avisa e diverge", () => {
  const base = ler("btg-brasil-sintetico.txt").join("\n");
  const rf = [
    "Renda fixa - Posição",
    "Ativo                       Vencimento      Valor Aplicado R$    Saldo Bruto R$",
    " CDB BANCO EXEMPLO 110% CDI   15/01/28        1.000,00             1.100,00",
    " LCI EMISSOR TESTE            20/06/27        2.000,00             2.050,00",
    " Total                                                              3.150,00",
    "",
  ].join("\n");
  // sumario com a linha de renda fixa e total ajustado (4.336,20 + 3.150,00 = 7.486,20)
  const comRf = base
    .replace(" Conta Corrente ", " Renda Fixa                                         -                                             -                                                   3.150,00                                     3.150,00\n\n Conta Corrente ")
    .replace(/4\.336,20(\s+)4\.336,20/, "7.486,20$17.486,20")
    .replace("Conta corrente - Posição", rf + "Conta corrente - Posição");
  const e = lerOk(comoLinhas(comRf.split("\n")));
  const fixa = e.posicoes.filter((p) => p.classe_ativo === "renda_fixa");
  assert.deepEqual(fixa.map((p) => [p.ativo, p.especie, p.valor_centavos]), [["CDB BANCO EXEMPLO 110% CDI", "CDB", 110000], ["LCI EMISSOR TESTE", "LCI", 205000]]);
  assert.equal(e.conferencia.confere, true);
  assert.ok(e.avisos.some((a) => a.includes("não validado")));
  // sem total para conferir (secao sem Total e sumario sem a linha): nao grava, avisa, e o total do extrato diverge
  const semTotal = comRf.replace(" Total                                                              3.150,00\n", "").replace(/ Renda Fixa [^\n]*\n/, "");
  const e2 = lerOk(comoLinhas(semTotal.split("\n")));
  assert.equal(e2.posicoes.filter((p) => p.classe_ativo === "renda_fixa").length, 0);
  assert.ok(e2.avisos.some((a) => a.includes("Renda fixa") && a.includes("NÃO foram lidas")));
  assert.equal(e2.conferencia.confere, false);
});

// ---------------------------------------------------------------------------------------------
// Cadastro, carteira hierarquica e pizzas
// ---------------------------------------------------------------------------------------------

function carteiraDoFixture() {
  const db = abrirBancoTeste();
  const e = lerOk(comoLinhas(ler("btg-brasil-sintetico.txt")));
  salvarExtrato(db, U, e, "h-br");
  return { db, e };
}

test("carteira: totais por nivel (genero, especie, ativo) somam o patrimonio", () => {
  const { db } = carteiraDoFixture();
  const c = montarCarteira(db, U, "2026-09");
  assert.equal(c.total_centavos, 433620);
  assert.deepEqual(c.generos.map((g) => [g.id, g.total_centavos]), [["previdencia", 250000], ["renda_variavel", 75150], ["caixa", 100150], ["transito", 8320]]);
  assert.equal(c.generos.reduce((s, g) => s + g.total_centavos, 0), c.total_centavos);
  for (const g of c.generos) {
    assert.equal(g.especies.reduce((s, x) => s + x.total_centavos, 0), g.total_centavos);
    for (const x of g.especies) assert.equal(x.itens.reduce((s, i) => s + (i.saldo_centavos ?? 0), 0), x.total_centavos);
  }
  const rv = c.generos.find((g) => g.id === "renda_variavel")!;
  assert.deepEqual(rv.especies.map((x) => [x.especie, x.total_centavos]), [["Ações", 35050], ["Fundos listados (FII)", 20100], ["ETFs", 20000]]);
  const etf = c.itens.find((i) => i.codigo === "IJKL11")!;
  assert.deepEqual([etf.quantidade, etf.preco_medio, etf.preco_medio_origem, etf.preco_fechamento, etf.saldo_centavos], [2, 99, "extrato", 100, 20000]);
  // resultado = saldo bruto - quantidade x preco medio (200,00 - 2 x 99,00 = 2,00)
  assert.equal(etf.resultado_original_centavos, 200);
  assert.ok(Math.abs(etf.resultado_pct! - 200 / 19800) < 1e-12);
  // sem preco medio no extrato: resultado nao informado (nunca zero)
  const acao = c.itens.find((i) => i.codigo === "ABCD3")!;
  assert.deepEqual([acao.preco_medio, acao.preco_medio_origem, acao.resultado_original_centavos, acao.resultado_pct], [null, null, null, null]);
  // caixa e transito nao tem resultado
  assert.ok(c.itens.filter((i) => i.classe_ativo === "caixa" || i.classe_ativo === "transito").every((i) => i.resultado_original_centavos === null));
  // movimentos do mes por ativo
  // (inclui o dividendo ainda em transito, marcado como tal)
  assert.deepEqual(acao.movimentos.map((m) => [m.tipo, m.quantidade, m.preco, m.valor_centavos, m.em_transito]), [["custodia", 10, 19.5, 19500, false], ["provento", null, null, 320, true]]);
  assert.equal(c.itens.find((i) => i.codigo === "MNOP11")!.movimentos[0]!.tipo, "provento");
});

test("cadastro do ativo: preco medio informado persiste entre extratos e nao sobrepoe o do extrato", () => {
  const { db, e } = carteiraDoFixture();
  salvarCadastroAtivo(db, U, "ABCD3", { preco_medio: 18.5, nome: "Empresa Alfa" });
  salvarCadastroAtivo(db, U, "IJKL11", { preco_medio: 50 });
  let c = montarCarteira(db, U, "2026-09");
  const acao = c.itens.find((i) => i.codigo === "ABCD3")!;
  // 200,00 - 10 x 18,50 = 15,00
  assert.deepEqual([acao.preco_medio, acao.preco_medio_origem, acao.resultado_original_centavos], [18.5, "informado", 1500]);
  assert.equal(c.itens.find((i) => i.codigo === "IJKL11")!.preco_medio_origem, "extrato");
  // novo extrato (outro mes) reaproveita o cadastro; remover o extrato nao apaga o cadastro
  const outro: ExtratoLido = { ...e, periodo_inicio: "2026-10-01", periodo_fim: "2026-10-31" };
  salvarExtrato(db, U, outro, "h-br-2");
  c = montarCarteira(db, U, "2026-10");
  assert.equal(c.itens.find((i) => i.codigo === "ABCD3")!.preco_medio, 18.5);
  for (const x of listarExtratos(db, U)) removerExtrato(db, U, x.id);
  assert.equal(listarCadastroAtivos(db, U).length, 2);
  // validacao e limpeza
  assert.throws(() => salvarCadastroAtivo(db, U, "ABCD3", { preco_medio: 0 }));
  assert.throws(() => salvarCadastroAtivo(db, U, "ABCD3", { preco_medio: -1 }));
  assert.throws(() => salvarCadastroAtivo(db, U, "ABCD3", { exposicao: "marte" as never }));
  assert.throws(() => salvarCadastroAtivo(db, U, " ", { setor: "X" }));
  assert.equal(salvarCadastroAtivo(db, U, "ABCD3", { preco_medio: null }), null);
  assert.equal(removerCadastroAtivo(db, U, "IJKL11"), true);
  assert.equal(listarCadastroAtivos(db, U).length, 0);
});

test("cadastro do ativo: especie, setor e exposicao editaveis; a origem aparece", () => {
  const { db } = carteiraDoFixture();
  let c = montarCarteira(db, U, "2026-09");
  const abcd = () => c.itens.find((i) => i.codigo === "ABCD3")!;
  assert.deepEqual([abcd().especie, abcd().especie_origem, abcd().setor, abcd().setor_origem, abcd().exposicao, abcd().exposicao_origem], ["Ações", "extrato", "Bancos", "extrato", "nacional", "padrao"]);
  salvarCadastroAtivo(db, U, "ABCD3", { especie: "Ações de dividendos", setor: "Tecnologia", exposicao: "estrangeira" });
  c = montarCarteira(db, U, "2026-09");
  assert.deepEqual([abcd().especie, abcd().especie_origem, abcd().setor, abcd().setor_origem, abcd().exposicao, abcd().exposicao_origem], ["Ações de dividendos", "informada", "Tecnologia", "informado", "estrangeira", "informada"]);
  assert.equal(c.total_centavos, 433620);
});

test("Meta: renda fixa marcada fica fora da liberdade financeira, separada no patrimonio, e as pizzas somam a base declarada", () => {
  const { db } = carteiraDoFixture();
  const id = adicionarPosicaoManual(db, U, { mes: "2026-09", instituicao: "Banco Manual", classe_ativo: "renda_fixa", ativo: "CDB reserva viagem", valor_centavos: 100000 });
  assert.ok(id > 0);
  let c = montarCarteira(db, U, "2026-09");
  assert.equal(c.total_centavos, 533620);
  assert.equal(c.meta_centavos, 0);
  const cdb = c.itens.find((i) => i.ativo === "CDB reserva viagem")!;
  salvarCadastroAtivo(db, U, cdb.chave, { meta: true });
  // so renda fixa pode ser Meta: marcar uma acao nao muda nada
  salvarCadastroAtivo(db, U, "ABCD3", { meta: true });
  c = montarCarteira(db, U, "2026-09");
  assert.deepEqual([c.total_centavos, c.meta_centavos, c.liberdade_centavos], [533620, 100000, 433620]);
  assert.equal(c.generos.find((g) => g.id === "meta")!.total_centavos, 100000);
  assert.equal(c.generos.reduce((s, g) => s + g.total_centavos, 0), c.total_centavos);
  assert.equal(patrimonio(db, U, "2026-09").liberdade_centavos, 433620);
  assert.equal(evolucaoPatrimonio(db, U, "2026-09", 1)[0]!.liberdade_centavos, 433620);

  const com = pizzasDaCarteira(c.itens, { incluirMeta: true, baseSetor: "acoes" });
  assert.equal(com.genero.base_centavos, 533620);
  assert.equal(com.genero.soma_fatias_centavos + com.genero.nao_representado_centavos, com.genero.base_centavos);
  assert.equal(com.genero.nao_representado_centavos, 0);
  assert.ok(com.genero.fatias.some((f) => f.id === "meta" && f.valor === 100000));
  assert.deepEqual(com.genero.fatias.find((f) => f.id === "caixa"), { id: "caixa", rotulo: "Caixa (líquido de valores em trânsito)", valor: 108470 });
  assert.equal(com.origem.base_centavos, 533620);
  assert.equal(com.origem.soma_fatias_centavos, 533620);

  const sem = pizzasDaCarteira(c.itens, { incluirMeta: false, baseSetor: "acoes" });
  assert.equal(sem.genero.base_centavos, 433620);
  assert.equal(sem.genero.soma_fatias_centavos, 433620);
  assert.ok(!sem.genero.fatias.some((f) => f.id === "meta"));
  assert.match(sem.genero.base, /sem Meta/);

  // setorial: acoes por setor (ABCD3 e EFGH4); a base e declarada e e parte do patrimonio
  assert.equal(com.setor.base_centavos, 35050);
  assert.deepEqual(com.setor.fatias.map((f) => [f.rotulo, f.valor]), [["Bancos", 20000], ["Energia elétrica", 15050]]);
  assert.ok(Math.abs(com.setor.fracao_do_patrimonio! - 35050 / 533620) < 1e-12);
  const rvSetor = pizzasDaCarteira(c.itens, { incluirMeta: true, baseSetor: "renda_variavel" });
  assert.equal(rvSetor.setor.base_centavos, 75150);
  assert.equal(rvSetor.setor.fatias.find((f) => f.id === "sem_setor")!.valor, 40100);
  assert.equal(rvSetor.setor.soma_fatias_centavos, 75150);
  const tudo = pizzasDaCarteira(c.itens, { incluirMeta: true, baseSetor: "tudo" });
  assert.equal(tudo.setor.base_centavos, 533620);
  assert.equal(tudo.setor.soma_fatias_centavos, 533620);
});

test("pizza nacional x estrangeira: conta em dolar converte pelo cambio do mes; ETF de indice americano e estrangeiro por padrao", () => {
  const { db } = carteiraDoFixture();
  salvarExtrato(db, U, lerOk(comoLinhas(ler("btg-us-sintetico.txt"))), "h-us");
  definirCambio(db, U, "2026-09", "USD", 5);
  let c = montarCarteira(db, U, "2026-09");
  assert.equal(c.total_centavos, 433620 + 250075 * 5);
  let p = pizzasDaCarteira(c.itens, { incluirMeta: true, baseSetor: "acoes" });
  assert.deepEqual(p.origem.fatias.map((f) => [f.id, f.valor]), [["estrangeira", 250075 * 5], ["nacional", 433620]]);
  assert.equal(p.origem.soma_fatias_centavos, c.total_centavos);
  // o caixa em dolar (Cash) entra na fatia de caixa da pizza 1
  assert.equal(p.genero.fatias.find((f) => f.id === "caixa")!.valor, 108470 + 75 * 5);
  // ETF de indice americano listado no Brasil (IVVB11) e estrangeiro por padrao; o usuario pode mudar
  const base = lerOk(comoLinhas(ler("btg-brasil-sintetico.txt")));
  const ivvb: ExtratoLido = { ...base, periodo_inicio: "2026-10-01", periodo_fim: "2026-10-31", posicoes: base.posicoes.map((x) => (x.codigo === "IJKL11" ? { ...x, codigo: "IVVB11" } : x)) };
  salvarExtrato(db, U, ivvb, "h-ivvb");
  definirCambio(db, U, "2026-10", "USD", 5);
  c = montarCarteira(db, U, "2026-10");
  const i = c.itens.find((x) => x.codigo === "IVVB11")!;
  assert.deepEqual([i.exposicao, i.exposicao_origem], ["estrangeira", "padrao"]);
  salvarCadastroAtivo(db, U, "IVVB11", { exposicao: "nacional" });
  c = montarCarteira(db, U, "2026-10");
  assert.deepEqual([c.itens.find((x) => x.codigo === "IVVB11")!.exposicao, c.itens.find((x) => x.codigo === "IVVB11")!.exposicao_origem], ["nacional", "informada"]);
  p = pizzasDaCarteira(c.itens, { incluirMeta: true, baseSetor: "acoes" });
  assert.equal(p.origem.soma_fatias_centavos, c.total_centavos);
});

test("carteira US: Cash e Treasury; custo 0,00 nao vira lucro; preco medio informado vale com o fator de cotacao por 100", () => {
  const db = abrirBancoTeste();
  salvarExtrato(db, U, lerOk(comoLinhas(ler("btg-us-sintetico.txt"))), "h-us");
  definirCambio(db, U, "2026-09", "USD", 5);
  let c = montarCarteira(db, U, "2026-09");
  const bill = c.itens.find((i) => i.codigo === "123456AB1")!;
  assert.deepEqual([bill.especie, bill.preco_medio, bill.resultado_original_centavos, bill.resultado_pct, bill.exposicao], ["Treasury Bills", null, null, null, "estrangeira"]);
  const nota = c.itens.find((i) => i.codigo === "123456CD2")!;
  assert.deepEqual([nota.preco_medio, nota.preco_medio_origem, nota.resultado_original_centavos, nota.resultado_centavos], [100, "extrato", 1500, 7500]);
  assert.equal(c.itens.find((i) => i.codigo === "DWBDS")!.ativo, "Cash");
  assert.equal(c.itens.find((i) => i.codigo === "DWBDS")!.resultado_original_centavos, null);
  // preco medio informado de um titulo cotado por 100: 1000 x 98,00 / 100 = 980,00 -> resultado 985,00 - 980,00 = 5,00
  salvarCadastroAtivo(db, U, "123456AB1", { preco_medio: 98 });
  c = montarCarteira(db, U, "2026-09");
  const b2 = c.itens.find((i) => i.codigo === "123456AB1")!;
  assert.deepEqual([b2.preco_medio_origem, b2.resultado_original_centavos, b2.resultado_centavos], ["informado", 500, 2500]);
  assert.equal(c.generos.reduce((s, g) => s + g.total_centavos, 0), c.total_centavos);
});

test("sem cambio: ativo em dolar aparece na carteira mas fica fora dos totais e das pizzas", () => {
  const db = abrirBancoTeste();
  salvarExtrato(db, U, lerOk(comoLinhas(ler("btg-us-sintetico.txt"))), "h-us");
  const c = montarCarteira(db, U, "2026-09");
  assert.equal(c.total_centavos, 0);
  assert.equal(c.sem_cambio.length, 3);
  const p = pizzasDaCarteira(c.itens, { incluirMeta: true, baseSetor: "acoes" });
  assert.equal(p.genero.base_centavos, 0);
  assert.equal(p.genero.fatias.length, 0);
});

test("pizza: valor negativo (caixa liquido de transito) nao e desenhado, mas a diferenca e declarada", () => {
  const db = abrirBancoTeste();
  const base = lerOk(comoLinhas(ler("btg-brasil-sintetico.txt")));
  // caixa de 1.001,50 e uma compra a liquidar de 5.000,00: caixa liquido negativo
  const e: ExtratoLido = {
    ...base,
    posicoes: base.posicoes.map((p) => (p.classe_ativo === "transito" && p.especie === "Compras a liquidar" ? { ...p, valor_centavos: -500000 } : p)),
  };
  salvarExtrato(db, U, e, "h-neg");
  const c = montarCarteira(db, U, "2026-09");
  const p = pizzasDaCarteira(c.itens, { incluirMeta: true, baseSetor: "acoes" });
  assert.equal(p.genero.base_centavos, c.total_centavos);
  assert.ok(p.genero.nao_representado_centavos < 0);
  assert.equal(p.genero.soma_fatias_centavos + p.genero.nao_representado_centavos, p.genero.base_centavos);
  assert.ok(!p.genero.fatias.some((f) => f.id === "caixa"));
});

// ---------------------------------------------------------------------------------------------
// Persistencia: schema versao 5, backup, idempotencia
// ---------------------------------------------------------------------------------------------

test("schema v5: migracao incremental e idempotente sobre banco anterior", () => {
  const d = new Database(":memory:");
  const db = d as unknown as Db;
  db.exec(`CREATE TABLE extrato_investimento (id INTEGER PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'local', instituicao TEXT NOT NULL, conta TEXT NOT NULL DEFAULT '', moeda TEXT NOT NULL DEFAULT 'BRL', periodo_inicio TEXT NOT NULL, periodo_fim TEXT NOT NULL, hash_arquivo TEXT NOT NULL, total_declarado_centavos INTEGER, importado_em TEXT NOT NULL, UNIQUE (usuario_id, hash_arquivo));
    CREATE TABLE posicao_investimento (id INTEGER PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'local', extrato_id INTEGER, mes TEXT NOT NULL, instituicao TEXT NOT NULL, conta TEXT NOT NULL DEFAULT '', classe_ativo TEXT NOT NULL, ativo TEXT NOT NULL, codigo TEXT, quantidade REAL, moeda TEXT NOT NULL DEFAULT 'BRL', valor_centavos INTEGER NOT NULL, origem TEXT NOT NULL DEFAULT 'manual', criada_em TEXT NOT NULL);
    INSERT INTO posicao_investimento (mes, instituicao, classe_ativo, ativo, valor_centavos, criada_em) VALUES ('2026-08', 'Banco Antigo', 'caixa', 'Conta', 1234, '2026-08-31');`);
  prepararBanco(db);
  prepararBanco(db);
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  for (const c of ["especie", "cnpj", "preco_fechamento", "preco_medio", "custo_total_centavos", "detalhe_json"]) assert.ok(cols("posicao_investimento").includes(c), c);
  assert.ok(cols("movimento_investimento").includes("quantidade") && cols("movimento_investimento").includes("preco"));
  assert.ok(cols("extrato_investimento").includes("distribuicao_setorial_json"));
  assert.ok(cols("ativo_cadastro").includes("preco_medio"));
  // a posicao antiga continua valendo, sem detalhe
  const p = patrimonio(db, "local", "2026-08");
  assert.equal(p.total_centavos, 1234);
  assert.equal(p.posicoes[0]!.especie, null);
  assert.equal(montarCarteira(db, "local", "2026-08").generos[0]!.especies[0]!.especie, "Caixa");
});

test("backup: cadastro dos ativos e detalhes das posicoes vao e voltam; hash continua idempotente", () => {
  const { db, e } = carteiraDoFixture();
  salvarCadastroAtivo(db, U, "ABCD3", { preco_medio: 18.5, setor: "Tecnologia" });
  const dump = exportarDados(db);
  assert.equal(dump.versao_schema, 5);
  const db2 = abrirBancoTeste();
  restaurarDados(db2, JSON.parse(JSON.stringify(dump)));
  assert.equal(listarCadastroAtivos(db2, U).length, 1);
  const c = montarCarteira(db2, U, "2026-09");
  assert.equal(c.total_centavos, 433620);
  assert.equal(c.itens.find((i) => i.codigo === "ABCD3")!.setor, "Tecnologia");
  assert.equal(c.itens.find((i) => i.cnpj !== null)!.detalhe.rentabilidade?.benchmark, "CDI");
  assert.equal(salvarExtrato(db2, U, e, "h-br").status, "ja_importado");
  // distribuicao setorial guardada por extrato
  const j = (db2.prepare("SELECT distribuicao_setorial_json j FROM extrato_investimento").get() as { j: string }).j;
  assert.deepEqual(JSON.parse(j), e.distribuicao_setorial);
});

// ---------------------------------------------------------------------------------------------
// Diagnostico
// ---------------------------------------------------------------------------------------------

test("diagnostico: oculta dados pessoais e mostra caminho, contagens e primeiras linhas", () => {
  const linhas = [
    "Extrato da", "Conta Investimento", "MARIA EXEMPLO DA SILVA", "Conta investimento 000123456", "CPF 123.456.789-09", "RUA EXEMPLO 100 APTO 1 - CENTRO - CIDADE - UF - 12345678",
    "Período de 01/09/26 a 30/09/26", "Account Number:EXEM-001-ZZZZ009876 Account Name: MARIA EXEMPLO DA SILVA", "contato maria@exemplo.com ou (62) 99999-1234",
    "FUNDO EXEMPLO 11.111.111/0001-11 30/09/26 1.000,00000000 2,5000000 2.500,00",
  ];
  const { linhas: ocultas, alteradas } = ocultarDadosPessoais(linhas);
  const junto = ocultas.join("\n");
  assert.ok(!/MARIA|123\.456|000123456|ZZZZ009876|exemplo\.com|99999-1234|RUA EXEMPLO/.test(junto), junto);
  assert.ok(junto.includes("***3456") && junto.includes("***9876"));
  // CNPJ, datas, quantidades e valores permanecem
  assert.ok(junto.includes("11.111.111/0001-11") && junto.includes("1.000,00000000") && junto.includes("2.500,00") && junto.includes("Período de 01/09/26 a 30/09/26"));
  assert.ok(alteradas >= 6);

  const d = novoDiagnostico();
  d.tentativas.push("pdfkit-posicional: 0 itens; seguiu para o caminho antigo");
  d.itens = 0;
  registrarLinhas(d, Array.from({ length: 120 }, (_, i) => ({ texto: `linha ${i + 1}` })), "pdfkit-antigo");
  const t = textoDiagnostico(d, { plataforma: "ios", leitor: null, erroLeitura: "Formato de extrato não reconhecido.", avisos: [], agora: new Date("2026-10-14T12:00:00Z") });
  assert.match(t, /Caminho usado: pdfkit-antigo/);
  assert.match(t, /Linhas lidas: 120 \(mostradas: 80\)/);
  assert.match(t, /Itens posicionados: 0/);
  assert.match(t, /Leitor que reconheceu o PDF: nenhum/);
  assert.match(t, /80\| linha 80/);
  assert.ok(!t.includes("linha 81"));
});

// ---------------------------------------------------------------------------------------------
// Dados reais do usuario: lidos SO em tempo de execucao (nunca copiados para o repositorio); o teste e pulado sem eles.
// As verificacoes sao estruturais (conferencia, formatos); nenhum valor real aparece aqui.
// ---------------------------------------------------------------------------------------------

const REAIS = { br: "/tmp/claude-0/work/br.json", us: "/tmp/claude-0/work/us.json" };

test("itens reais do BTG Brasil (se existirem em /tmp): le, confere o total e traz o detalhe por ativo", { skip: !existsSync(REAIS.br) }, () => {
  const linhas = itensParaLinhas(JSON.parse(readFileSync(REAIS.br, "utf8")));
  assert.equal(detectarExtrato(linhas), "btg_brasil");
  const e = lerOk(linhas);
  assert.equal(e.conferencia.confere, true);
  assert.equal(e.conferencia.diferenca_centavos, 0);
  assert.ok(e.conferencia.parciais.length > 0 && e.conferencia.parciais.every((p) => p.confere));
  const rv = e.posicoes.filter((p) => p.classe_ativo === "renda_variavel");
  assert.ok(rv.length > 0 && rv.every((p) => p.codigo && p.quantidade !== null && p.preco_fechamento !== null && p.especie));
  assert.ok(rv.every((p) => p.preco_medio == null || p.preco_medio > 0));
  const prev = e.posicoes.find((p) => p.classe_ativo === "previdencia")!;
  assert.ok(prev.cnpj && prev.preco_fechamento && prev.detalhe?.rentabilidade && prev.detalhe.aliquotas && prev.detalhe.valor_liquido_centavos);
  assert.ok(e.posicoes.filter((p) => p.classe_ativo === "transito").length > 0);
  assert.ok(!JSON.stringify(e).match(/\d{3}\.\d{3}\.\d{3}-\d{2}/));
  // o extrato salvo gera uma carteira cujos niveis somam o patrimonio
  const db = abrirBancoTeste();
  salvarExtrato(db, U, e, "real-br");
  const c = montarCarteira(db, U, e.periodo_fim.slice(0, 7));
  assert.equal(c.total_centavos, e.conferencia.soma_posicoes_centavos);
  assert.equal(c.generos.reduce((s, g) => s + g.total_centavos, 0), c.total_centavos);
});

test("itens reais do BTG US (se existirem em /tmp): detecta, le, conferido, caixa chama-se Cash e custo zero e nao informado", { skip: !existsSync(REAIS.us) }, () => {
  const linhas = itensParaLinhas(JSON.parse(readFileSync(REAIS.us, "utf8")));
  assert.equal(detectarExtrato(linhas), "btg_us");
  const e = lerOk(linhas);
  assert.equal(e.conferencia.confere, true);
  assert.ok(e.conferencia.parciais.every((p) => p.confere));
  assert.ok(e.posicoes.some((p) => p.classe_ativo === "caixa" && p.ativo === "Cash"));
  assert.ok(!e.posicoes.some((p) => /bank sweep/i.test(p.ativo)));
  assert.ok(e.posicoes.filter((p) => p.classe_ativo === "renda_fixa").every((p) => p.especie?.startsWith("Treasury")));
  assert.ok(e.posicoes.every((p) => (p.custo_total_centavos ?? 1) > 0 && (p.preco_medio ?? 1) > 0));
  assert.ok(!JSON.stringify(e).match(/BPZY|BTGP-001/));
});
