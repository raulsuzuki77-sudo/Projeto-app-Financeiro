import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBancoTeste } from "./helpers";
import { conciliarCompromissos, criarCompromisso, criarRecorrencia, excluirDocumento, gerarCompromissosDoMes, importarTexto, lancarValorReal, listarCompromissos, marcarPago, pagamentosProximos, registrarDocumento, concluirDocumento, removerCompromisso, resumoDePagamentos } from "../src/index";

const U = "u";
const EXTRATO = `Data,Valor,Identificador,Descrição
05/09/2026,-2237.48,i1,Pagamento de boleto efetuado - IMOBILIARIA CENTRAL LTDA
10/09/2026,-687.71,i2,Pagamento de boleto efetuado - CONDOMINIO DO RESIDENCIAL ACACIAS
12/09/2026,-899.60,i3,Pagamento de boleto efetuado - MUTUA PLANO DE SAUDE
`;

test("compromissos do mes saem das recorrencias, de forma idempotente, e podem ser criados a mao", () => {
  const db = abrirBancoTeste();
  criarRecorrencia(db, U, { descricao: "Aluguel", tipo: "despesa", valor_centavos: 223748, categoria: "moradia", dia_mes: 5, inicio_mes: "2026-08" }, "2026-10-01");
  assert.equal(gerarCompromissosDoMes(db, U, "2026-09"), 1);
  assert.equal(gerarCompromissosDoMes(db, U, "2026-09"), 0);
  assert.equal(gerarCompromissosDoMes(db, U, "2026-07"), 0, "antes do inicio da recorrencia nao gera");
  criarCompromisso(db, U, { mes: "2026-09", descricao: "Condomínio", valor_planejado_centavos: 60000, vencimento: "2026-09-10" });
  const l = listarCompromissos(db, U, "2026-09");
  assert.deepEqual(l.map((c) => [c.descricao, c.estado, c.vencimento]), [["Aluguel", "planejado", "2026-09-05"], ["Condomínio", "planejado", "2026-09-10"]]);
  assert.throws(() => criarCompromisso(db, U, { mes: "2026-13", descricao: "x", valor_planejado_centavos: 1 }));
});

test("fluxo a mao: informar o valor do boleto e marcar pago; resumo e avisos", () => {
  const db = abrirBancoTeste();
  const c = criarCompromisso(db, U, { mes: "2026-09", descricao: "Condomínio", valor_planejado_centavos: 60000, vencimento: "2026-09-10" });
  const d = criarCompromisso(db, U, { mes: "2026-09", descricao: "Energia", valor_planejado_centavos: 45000, vencimento: "2026-09-20" });
  const x = lancarValorReal(db, U, c, { valor_real_centavos: 68771 });
  assert.equal(x.estado, "lancado");
  let r = resumoDePagamentos(db, U, "2026-09", "2026-09-15");
  assert.deepEqual([r.previsto_centavos, r.a_pagar_centavos, r.em_atraso, r.em_atraso_centavos, r.pago_centavos], [68771 + 45000, 68771 + 45000, 1, 68771, 0]);
  assert.deepEqual(pagamentosProximos(db, U, "2026-09-15", 7), { atrasados: 1, proximos: 1 });
  const p = marcarPago(db, U, c, true, "2026-09-11");
  assert.deepEqual([p.estado, p.pago_manual, p.pago_em], ["pago", true, "2026-09-11"]);
  r = resumoDePagamentos(db, U, "2026-09", "2026-09-15");
  assert.deepEqual([r.pago_centavos, r.a_pagar_centavos, r.em_atraso, r.pagos], [68771, 45000, 0, 1]);
  assert.equal(marcarPago(db, U, c, false, "").estado, "lancado", "desmarcar volta ao estado anterior");
  assert.throws(() => lancarValorReal(db, U, d, { valor_real_centavos: 0 }));
  removerCompromisso(db, U, d);
  assert.equal(listarCompromissos(db, U, "2026-09").length, 1);
});

test("conferencia pelo extrato: paga sozinho o que nao foi marcado, confirma o marcado a mao e aponta divergencia", () => {
  const db = abrirBancoTeste();
  criarCompromisso(db, U, { mes: "2026-09", descricao: "Aluguel imobiliaria", valor_planejado_centavos: 223748, vencimento: "2026-09-05" });
  const cond = criarCompromisso(db, U, { mes: "2026-09", descricao: "Condomínio", valor_planejado_centavos: 60000, vencimento: "2026-09-10" });
  lancarValorReal(db, U, cond, { valor_real_centavos: 68771 });
  marcarPago(db, U, cond, true, "2026-09-10");
  const plano = criarCompromisso(db, U, { mes: "2026-09", descricao: "Mutua plano de saude", valor_planejado_centavos: 85000, vencimento: "2026-09-12" });
  marcarPago(db, U, plano, true, "2026-09-12");
  const doc = registrarDocumento(db, { usuario_id: U, tipo: "extrato_conta", formato: "csv", nome: "set.csv", hash_arquivo: "h" });
  const r = importarTexto(db, "csv", EXTRATO, { usuario_id: U, documento_id: doc });
  assert.ok(r.ok);
  concluirDocumento(db, doc, { ...r.relatorio, periodo: r.relatorio.periodo });
  const res = conciliarCompromissos(db, U, "2026-09");
  assert.deepEqual(res, { pagos: 1, confirmados: 1, divergentes: 1 });
  const [aluguel, condo, saude] = ["Aluguel imobiliaria", "Condomínio", "Mutua plano de saude"].map((n) => listarCompromissos(db, U, "2026-09").find((c) => c.descricao === n)!);
  assert.deepEqual([aluguel!.estado, aluguel!.pago_manual, aluguel!.pago_em, aluguel!.valor_real_centavos], ["pago", false, "2026-09-05", 223748]);
  assert.equal(condo!.lancamento_id !== null && condo!.divergencia_centavos === null, true);
  assert.equal(saude!.divergencia_centavos, 89960 - 85000);
  assert.deepEqual(conciliarCompromissos(db, U, "2026-09"), { pagos: 0, confirmados: 0, divergentes: 0 }, "idempotente");
  // excluir o documento desfaz o que o extrato comprovou, mas preserva o que o usuario marcou
  excluirDocumento(db, U, { fonte: "documento", id: doc });
  const depois = listarCompromissos(db, U, "2026-09");
  const a2 = depois.find((c) => c.descricao === "Aluguel imobiliaria")!;
  assert.deepEqual([a2.estado, a2.lancamento_id], ["lancado", null]);
  assert.equal(depois.find((c) => c.descricao === "Condomínio")!.estado, "pago");
});
