import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBancoTeste } from "./helpers";
import {
  classificar, classeDaCategoria, coberturaDaRecorrencia, copiarOrcamento, criarEvento, criarMeta, criarRecorrencia, definirClasse, definirEventoDoLancamento, definirOrcamento, detalheEvento,
  atualizarEvento, detectarRecorrentes, coberturaPrevia, exportarDados, gerarRecorrenciasDetalhado, importarTexto, interpretarConta, lancarManual, listarEventos, listarLancamentos, orcamentoVsMetas, painelOrcamento,
  registrarLancamento, removerEvento, restaurarDados, sugerirOrcamentoPelaMedia, viagensSemEvento, ITEM_RECEITA, chaveEstabelecimento, definirTitular, resumoMensal,
} from "../src/index";
import type { Db } from "../src/db/tipos";

const U = "u";
let seq = 0;
function gasto(db: Db, data: string, valor: number, desc: string, extra: { categoria?: string; tipo?: "despesa" | "receita" | "investimento" } = {}) {
  return registrarLancamento(db, { usuario_id: U, tipo: extra.tipo ?? "despesa", valor_centavos: valor, descricao: desc, categoria: extra.categoria, data_local: data, hora_local: null, precisao_horario: "desconhecido", origem: "manual", referencia: `t${++seq}` });
}

test("regras indicadas pelo usuario e categorias novas", () => {
  const db = abrirBancoTeste();
  const c = (d: string, tipo: "despesa" | "receita" = "despesa") => classificar(db, U, d, tipo);
  assert.equal(c("Boleto: GETWAY").categoria, "investimento_apartamento");
  assert.equal(c("Itoko Tachi").categoria, "alimentacao_restaurante");
  assert.equal(c("Pty*Zero Grau Oeste").categoria, "bebidas");
  assert.equal(c("S2p*2funape").categoria, "educacao_cursos");
  assert.equal(c("Barbearia do Zé").categoria, "saude_cabelo");
  assert.equal(c("Boleto: MUTUA DE ASSISTENCIA DOS PROFISSIONAIS DA ENG").categoria, "saude_plano");
  assert.equal(c("Boleto: ICATU SEGUROS").categoria, "investimento_previdencia");
  assert.equal(c("Anthropic* Claude Sub").categoria, "conhecimento_ia");
  assert.equal(c("Clube Livelo*Clube Liv").categoria, "clube_pontos");
  assert.equal(c("IOF de \"Anthropic* Claude Sub\"").categoria, "financeiro_custos", "IOF continua sendo custo financeiro");
  // parcela de apartamento e aporte: nao e despesa
  const r = importarTexto(db, "csv", "Data,Descrição,Valor\n05/09/2026,Boleto: GETWAY,-2133.40\n", { usuario_id: U });
  assert.ok(r.ok);
  assert.equal(resumoMensal(db, U, "2026-09").despesas_centavos, 0);
  assert.equal(resumoMensal(db, U, "2026-09").investimentos_centavos, 213340);
});

test("Pix entre contas: direcao faz parte da regra; Pix a corretora e aporte", () => {
  assert.equal(chaveEstabelecimento("Pix enviado: Fulano de Tal Silva"), "enviado fulano tal silva".replace("fulano tal silva", "fulano tal silva").split(" ").slice(0, 4).join(" "));
  assert.notEqual(chaveEstabelecimento("Pix enviado: FULANO DE TAL"), chaveEstabelecimento("Pix recebido: FULANO DE TAL"));
  const a = interpretarConta("Transferência enviada pelo Pix - MARIA CLARA DE SOUZA - •••.111.222-•• - BANCO BTG PACTUAL S.A. (0208) Agência: 20 Conta: 1-1");
  assert.equal(a.descricao, "Pix enviado: Corretora BTG (MARIA CLARA DE SOUZA)");
  const b = interpretarConta("Transferência recebida pelo Pix - MARIA CLARA DE SOUZA - •••.111.222-•• - BANCO BTG PACTUAL S.A. (0208) Agência: 20 Conta: 1-1");
  assert.equal(b.descricao, "Pix recebido: MARIA CLARA DE SOUZA", "so o envio a corretora e aporte");
  const db = abrirBancoTeste();
  definirTitular(db, U, "Maria Clara de Souza");
  assert.equal(classificar(db, U, "Pix enviado: MARIA CLARA DE SOUZA", "despesa").categoria, "transferencia");
  assert.equal(classificar(db, U, a.descricao, "despesa").categoria, "investimento");
});

test("classe do orcamento: padrao e escolha do usuario", () => {
  const db = abrirBancoTeste();
  assert.equal(classeDaCategoria(db, U, "alimentacao_supermercado"), "custo_fixo");
  assert.equal(classeDaCategoria(db, U, "transferencia"), null);
  definirClasse(db, U, "alimentacao_supermercado", "prazeres");
  assert.equal(classeDaCategoria(db, U, "alimentacao_supermercado"), "prazeres");
  definirClasse(db, U, "alimentacao_supermercado", null);
  assert.equal(classeDaCategoria(db, U, "alimentacao_supermercado"), "custo_fixo");
  assert.throws(() => definirClasse(db, U, "bebidas", "inexistente" as never), /Classe inválida/);
});

test("eventos: periodo, vinculo automatico na importacao e dupla visao (evento e genero)", () => {
  const db = abrirBancoTeste();
  gasto(db, "2026-07-10", 30000, "Hotel Mar", { categoria: "viagem" });
  gasto(db, "2026-07-11", 8000, "Restaurante Sol", { categoria: "alimentacao_restaurante" });
  gasto(db, "2026-07-12", 120000, "Aluguel", { categoria: "moradia" });
  gasto(db, "2026-08-02", 5000, "Restaurante Sol", { categoria: "alimentacao_restaurante" });
  assert.equal(viagensSemEvento(db, U).length, 1);
  const { id, vinculados } = criarEvento(db, U, { nome: "Ferias de julho", tipo: "ferias", data_inicio: "2026-07-09", data_fim: "2026-07-15" });
  assert.equal(vinculados, 2, "aluguel (fixo) e gasto fora do periodo nao entram");
  assert.equal(viagensSemEvento(db, U).length, 0);
  // gasto importado depois, dentro do periodo, ja nasce vinculado
  gasto(db, "2026-07-14", 4000, "Padaria Praia", { categoria: "alimentacao_restaurante" });
  const d = detalheEvento(db, U, id);
  assert.equal(d.total_centavos, 42000);
  assert.deepEqual(d.por_categoria.map((c) => c.categoria), ["viagem", "alimentacao_restaurante"]);
  // a visao por categoria nao muda: o restaurante continua em Alimentacao
  assert.equal(resumoMensal(db, U, "2026-07").por_categoria.find((c) => c.categoria === "alimentacao_restaurante")!.total_centavos, 12000);
  // vinculo manual (compra antecipada) e remocao
  const antes = gasto(db, "2026-06-01", 90000, "Passagem aerea", { categoria: "viagem" });
  assert.ok(antes.resultado === "criado");
  const lid = (antes as { lancamento: { id: number } }).lancamento.id;
  definirEventoDoLancamento(db, U, lid, id);
  assert.equal(listarEventos(db, U)[0]!.total_centavos, 132000);
  assert.throws(() => criarEvento(db, U, { nome: "x", tipo: "ferias", data_inicio: "2026-07-10", data_fim: "2026-07-01" }), /anterior/);
  assert.equal(removerEvento(db, U, id), true);
  assert.equal(listarLancamentos(db, U, {}).filter((l) => (l as { evento_id: number | null }).evento_id !== null).length, 0);
});

test("backup leva eventos, orcamento e classes", () => {
  const db = abrirBancoTeste();
  criarEvento(db, U, { nome: "Viagem a servico", tipo: "viagem_servico", data_inicio: "2026-07-01", data_fim: "2026-07-03" });
  gasto(db, "2026-07-02", 1000, "Taxi", { categoria: "transporte_aplicativo_pedagio" });
  definirOrcamento(db, U, "*", "bebidas", 20000);
  definirClasse(db, U, "bebidas", "eventualidade");
  const dump = JSON.parse(JSON.stringify(exportarDados(db)));
  const outro = abrirBancoTeste();
  restaurarDados(outro, dump);
  assert.equal(listarEventos(outro, U).length, 1);
  assert.equal(listarEventos(outro, U)[0]!.total_centavos, 1000);
  assert.equal(classeDaCategoria(outro, U, "bebidas"), "eventualidade");
});

test("orcamento: planejado x realizado por classe, estorno abate, aporte liquido, alertas e sugestao pela media", () => {
  const db = abrirBancoTeste();
  definirOrcamento(db, U, "*", ITEM_RECEITA, 1500000);
  definirOrcamento(db, U, "*", "moradia", 230000);
  definirOrcamento(db, U, "*", "alimentacao_restaurante", 50000);
  definirOrcamento(db, U, "*", "investimento_previdencia", 150000);
  definirOrcamento(db, U, "2026-09", "alimentacao_restaurante", 40000); // valor proprio do mes
  gasto(db, "2026-09-05", 230000, "Aluguel", { categoria: "moradia" });
  gasto(db, "2026-09-06", 38000, "Jantar", { categoria: "alimentacao_restaurante" });
  gasto(db, "2026-09-07", 6000, "Jantar 2", { categoria: "alimentacao_restaurante" });
  gasto(db, "2026-09-08", 150000, "Previdencia", { categoria: "investimento_previdencia" });
  gasto(db, "2026-09-09", 3000, "Cabelo", { categoria: "saude_cabelo" });
  gasto(db, "2026-09-10", 1000000, "Salario", { categoria: "receita_trabalho", tipo: "receita" });
  const p = painelOrcamento(db, U, "2026-09");
  const cls = (id: string) => p.classes.find((c) => c.id === id)!;
  assert.equal(cls("custo_fixo").realizado_centavos, 230000);
  assert.equal(cls("prazeres").planejado_centavos, 40000, "usa o valor do mes, nao o padrao");
  assert.equal(cls("prazeres").realizado_centavos, 44000);
  assert.equal(cls("prazeres").situacao, "estourou");
  assert.equal(cls("liberdade").realizado_centavos, 150000);
  assert.equal(cls("conforto").itens[0]!.situacao, "sem_plano");
  assert.equal(p.receita.planejada_centavos, 1500000);
  assert.equal(p.receita.realizada_centavos, 1000000);
  assert.equal(p.despesa.planejada_centavos, 230000 + 40000 + 150000);
  assert.equal(p.superavit.planejado_centavos, 1500000 - 420000);
  assert.equal(p.superavit.realizado_centavos, 1000000 - (230000 + 44000 + 150000 + 3000));
  assert.ok(p.alertas.some((a) => a.item === "alimentacao_restaurante" && a.tipo === "estourou"));
  // mes sem valor proprio usa o padrao
  assert.equal(painelOrcamento(db, U, "2026-10").classes.find((c) => c.id === "prazeres")!.planejado_centavos, 50000);
  // estorno abate o gasto da categoria; resgate abate o aporte da caixinha
  registrarLancamento(db, { usuario_id: U, tipo: "receita", valor_centavos: 6000, descricao: "Jantar 2", data_local: "2026-09-11", hora_local: null, precisao_horario: "desconhecido", origem: "manual", referencia: "est1", estorno: true, categoria: "alimentacao_restaurante", natureza: "estorno" });
  assert.equal(painelOrcamento(db, U, "2026-09").classes.find((c) => c.id === "prazeres")!.realizado_centavos, 38000);
  gasto(db, "2026-09-12", 100000, "Aplicacao RDB", { categoria: "investimento" });
  gasto(db, "2026-09-13", 30000, "Resgate RDB", { categoria: "resgate_investimento", tipo: "receita" });
  assert.equal(painelOrcamento(db, U, "2026-09").classes.find((c) => c.id === "liberdade")!.realizado_centavos, 150000 + 70000);
  // sugestao pela media dos meses anteriores a outubro que tem dados (so setembro): sem dividir por meses vazios
  const sug = sugerirOrcamentoPelaMedia(db, U, "2026-10");
  assert.equal(sug.find((s) => s.item === "moradia")!.valor_centavos, 230000);
  assert.ok(sug.some((s) => s.item === ITEM_RECEITA));
  // copiar de um mes para outro
  assert.ok(copiarOrcamento(db, U, "2026-09", "2026-11") >= 4);
  assert.equal(painelOrcamento(db, U, "2026-11").classes.find((c) => c.id === "prazeres")!.planejado_centavos, 40000);
});

test("orcamento x metas: compara o planejado em Liberdade financeira com o aporte que as metas pedem", () => {
  const db = abrirBancoTeste();
  definirOrcamento(db, U, "*", "investimento_previdencia", 100000);
  definirOrcamento(db, U, "*", ITEM_RECEITA, 1000000);
  definirOrcamento(db, U, "*", "moradia", 300000);
  criarMeta(db, U, { nome: "Reserva", tipo: "reserva_emergencia", valor_alvo_centavos: 12000000, aporte_inicial_centavos: 0, prazo_meses: 24, perfil: "moderado" });
  const r = orcamentoVsMetas(db, U, "2026-09");
  assert.equal(r.planejado_liberdade_centavos, 100000);
  assert.equal(r.metas.length, 1);
  assert.ok(r.aporte_necessario_metas_centavos > 0);
  assert.equal(r.lacuna_liberdade_centavos, r.aporte_necessario_metas_centavos - 100000);
  assert.equal(r.lacuna_com_superavit_centavos, r.lacuna_liberdade_centavos - (1000000 - 400000));
});

test("recorrentes: deteccao mes a mes, cobertura pelos extratos e contagem unica", () => {
  const db = abrirBancoTeste();
  for (const m of ["2026-07", "2026-08", "2026-09"]) {
    gasto(db, `${m}-10`, 12990, "Clube Livelo*Clube Liv", { categoria: "clube_pontos" });
    gasto(db, `${m}-05`, 69238 + Number(m.slice(5)) * 1000, "Boleto: CONDOMINIO DO RESIDENCIAL ACACIAS", { categoria: "moradia" });
    gasto(db, `${m}-0${Number(m.slice(5)) - 5}`, 900 + (Number(m.slice(5)) - 7) * 700, "Corrida Uber");
  }
  gasto(db, "2026-09-20", 4500, "Compra unica de loja");
  const det = detectarRecorrentes(db, U, "2026-10-14");
  const livelo = det.find((d) => d.chave.includes("livelo"))!;
  assert.equal(livelo.meses.length, 3);
  assert.equal(livelo.variavel, false);
  assert.equal(livelo.cadastrada, false);
  const cond = det.find((d) => d.chave.includes("condominio"))!;
  assert.equal(cond.variavel, true, "valor oscila entre meses");
  assert.ok(!det.some((d) => d.chave.includes("loja")), "gasto unico nao e recorrente");
  assert.ok(!det.some((d) => d.chave.includes("uber")), "corrida de valor pequeno e oscilante nao e compromisso");
  // cadastrar a recorrencia que ja esta nos extratos: contemplada em 3 meses, nada duplicado
  const rid = criarRecorrencia(db, U, { descricao: "Livelo", valor_centavos: 12990, dia_mes: 10, inicio_mes: "2026-07" }, "2026-10-14");
  const cob = coberturaDaRecorrencia(db, U, rid, "2026-10-14");
  assert.deepEqual(cob.map((c) => c.mes), ["2026-07", "2026-08", "2026-09"]);
  const g = gerarRecorrenciasDetalhado(db, U, "2026-10-14");
  assert.equal(g.contemplados, 3);
  assert.equal(g.criados, 1, "so outubro, ainda sem lancamento importado");
  assert.equal(resumoMensal(db, U, "2026-09").por_categoria.find((c) => c.categoria === "clube_pontos")!.total_centavos, 12990);
  // idempotente
  assert.deepEqual(gerarRecorrenciasDetalhado(db, U, "2026-10-14"), { criados: 0, contemplados: 0 });
  assert.equal(detectarRecorrentes(db, U, "2026-10-14").find((d) => d.chave.includes("livelo"))!.cadastrada, true);
  // o extrato de outubro chega depois: substitui a previsao, contando uma vez so
  const antes = resumoMensal(db, U, "2026-10").despesas_centavos;
  assert.equal(antes, 12990);
  gasto(db, "2026-10-11", 12990, "Clube Livelo*Clube Liv");
  assert.equal(resumoMensal(db, U, "2026-10").despesas_centavos, 12990);
  // conta variavel: o valor real substitui o estimado
  criarRecorrencia(db, U, { descricao: "Condominio", valor_centavos: 70000, dia_mes: 5, inicio_mes: "2026-10", categoria: "moradia" }, "2026-10-14");
  gerarRecorrenciasDetalhado(db, U, "2026-10-14");
  assert.equal(resumoMensal(db, U, "2026-10").despesas_centavos, 12990 + 70000);
  gasto(db, "2026-10-06", 69800, "Boleto: CONDOMINIO DO RESIDENCIAL ACACIAS");
  assert.equal(resumoMensal(db, U, "2026-10").despesas_centavos, 12990 + 69800);
});

test("lancamento criado a mao dentro do periodo de um evento ja nasce vinculado", () => {
  const db = abrirBancoTeste();
  const { id } = criarEvento(db, U, { nome: "Curso em Brasilia", tipo: "viagem_servico", data_inicio: "2026-09-01", data_fim: "2026-09-05" });
  lancarManual(db, U, { tipo: "despesa", valor_centavos: 2500, descricao: "Almoco", categoria: "alimentacao_restaurante", data_local: "2026-09-02" }, "m");
  assert.equal(detalheEvento(db, U, id).total_centavos, 2500);
});

test("cobertura previa: avisa antes de cadastrar que o compromisso ja esta nos extratos", () => {
  const db = abrirBancoTeste();
  gasto(db, "2026-08-10", 12990, "Clube Livelo*Clube Liv", { categoria: "clube_pontos" });
  gasto(db, "2026-09-10", 12990, "Clube Livelo*Clube Liv", { categoria: "clube_pontos" });
  const c = coberturaPrevia(db, U, { descricao: "Livelo", tipo: "despesa", valor_centavos: 12990 }, "2026-10-14");
  assert.deepEqual(c.map((x) => x.mes), ["2026-08", "2026-09"]);
  assert.deepEqual(coberturaPrevia(db, U, { descricao: "Livelo", tipo: "despesa", valor_centavos: 50000 }, "2026-10-14"), []);
  assert.deepEqual(coberturaPrevia(db, U, { descricao: "", tipo: "despesa", valor_centavos: 0 }, "2026-10-14"), []);
});

test("renomear o evento nao religa gasto removido a mao; ampliar o periodo vincula os novos", () => {
  const db = abrirBancoTeste();
  const g1 = gasto(db, "2026-09-02", 1000, "Almoco", { categoria: "alimentacao_restaurante" });
  const { id } = criarEvento(db, U, { nome: "Curso", tipo: "viagem_servico", data_inicio: "2026-09-01", data_fim: "2026-09-03" });
  definirEventoDoLancamento(db, U, (g1 as { lancamento: { id: number } }).lancamento.id, null);
  assert.equal(atualizarEvento(db, U, id, { nome: "Curso em Goiania" }).vinculados, 0);
  assert.equal(detalheEvento(db, U, id).total_centavos, 0);
  gasto(db, "2026-09-05", 2000, "Jantar", { categoria: "alimentacao_restaurante" });
  assert.equal(atualizarEvento(db, U, id, { data_fim: "2026-09-06" }).vinculados, 2);
});
