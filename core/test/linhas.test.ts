import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparEmLinhas, lerFaturaLinhas, type ObservacaoTexto } from "../src/index";

const o = (texto: string, x: number, y: number, largura = 0.1, altura = 0.012, conf = 0.95, pagina = 1): ObservacaoTexto => ({ texto, confianca: conf, x, y, largura, altura, pagina });

test("linha de tabela dividida em tres blocos vira uma linha, na ordem horizontal, mesmo com blocos fora de ordem", () => {
  const linhas = agruparEmLinhas([
    o("R$ 435,26", 0.8, 0.5),
    o("24/08/2026", 0.05, 0.501),
    o("DROGASIL 1473 GOIANIA (02/02)", 0.2, 0.499, 0.4),
  ]);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]!.texto, "24/08/2026 DROGASIL 1473 GOIANIA (02/02) R$ 435,26");
});

test("linhas diferentes ficam separadas, de cima para baixo; paginas separadas", () => {
  const linhas = agruparEmLinhas([
    o("segunda", 0.1, 0.4),
    o("primeira", 0.1, 0.6),
    o("outra pagina", 0.1, 0.9, 0.1, 0.012, 0.9, 2),
  ]);
  assert.deepEqual(linhas.map((l) => [l.texto, l.pagina]), [["primeira", 1], ["segunda", 1], ["outra pagina", 2]]);
});

test("confianca da linha: media ponderada pelo tamanho do texto, em 0 a 100", () => {
  const l = agruparEmLinhas([o("aaaaaaaaaa", 0.1, 0.5, 0.1, 0.012, 1.0), o("b", 0.3, 0.5, 0.01, 0.012, 0.0)]);
  assert.equal(l.length, 1);
  assert.ok(Math.abs(l[0]!.confianca - (10 / 11) * 100) < 1e-9);
});

test("texto nativo de PDF (camada de texto) passa direto, sem agrupar", () => {
  const l = agruparEmLinhas([{ texto: " 05/09/2026 LOJA R$ 10,00 ", confianca: 1, x: 0, y: 0, largura: 0, altura: 0, pagina: 1, nativo: true }]);
  assert.deepEqual(l, [{ texto: "05/09/2026 LOJA R$ 10,00", confianca: 100, pagina: 1 }]);
});

test("observacao vazia e ignorada", () => {
  assert.deepEqual(agruparEmLinhas([o("   ", 0.1, 0.5)]), []);
});

test("fatura: area tarjada sem texto ainda gera o item (valor lido) e vai para revisao; soma fecha", () => {
  const r = lerFaturaLinhas([
    { texto: "Despesas e créditos do mês R$ 100,00" },
    { texto: "03/09/2026 LOJA CENTRAL GOIANIA BR R$ 60,00", confianca: 95 },
    { texto: "04/09/2026 R$ 40,00", confianca: 90 },
  ]);
  assert.equal(r.itens.length, 2);
  assert.equal(r.nao_lidas.length, 0);
  assert.equal(r.conciliacao?.fecha, true);
  assert.equal(r.itens[1]!.descricao, "(descricao ilegivel)");
  assert.match(r.itens[1]!.alerta ?? "", /descricao ilegivel/);
});
