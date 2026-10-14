import { useState } from "react";
import { Text, View } from "react-native";
import { useTema } from "./tema";
import { Botao, Cartao, Texto } from "./ui";
import type { DadosLiberdade } from "../lib/api";
import { dataBR, formatarBRL } from "../lib/format";
import { comSinal, formatarMoeda, ROTULO_TIPO_MOVIMENTO } from "../lib/investimentos";

const TIPOS_EXIBIDOS = ["aporte", "custodia", "resgate"];

function Linha({ data, titulo, valor, detalhe }: { data: string; titulo: string; valor: string; detalhe?: string }) {
  const t = useTema();
  return (
    <View accessible accessibilityLabel={`${dataBR(data)}, ${titulo}, ${valor}${detalhe ? `. ${detalhe}` : ""}`} style={{ flexDirection: "row", gap: 8, minHeight: 40, paddingVertical: 4 }}>
      <Text style={{ width: 78, color: t.suave, fontSize: 13 }}>{dataBR(data)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.texto, fontSize: 14 }}>{titulo}</Text>
        {detalhe ? <Text style={{ color: t.suave, fontSize: 12 }}>{detalhe}</Text> : null}
      </View>
      <Text style={{ color: t.texto, fontSize: 14, fontWeight: "600" }}>{valor}</Text>
    </View>
  );
}

/** Movimentos dos extratos e lançamentos do app do tipo investimento, lado a lado, com o total de cada fonte. */
export function LiberdadeAportes({ dados }: { dados: DadosLiberdade }) {
  const t = useTema();
  const { movimentos, lancamentos, variacao: v } = dados;
  const [todos, setTodos] = useState(false);
  const exibidos = movimentos.filter((m) => TIPOS_EXIBIDOS.includes(m.tipo));
  const LIMITE = 6;
  const outros = movimentos.length - exibidos.length;
  const diferenca = v.aportes_centavos - lancamentos.total_centavos;
  return (
    <Cartao titulo="Aportes do mês">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}>
        <View style={{ flex: 1, minWidth: 280, gap: 4 }}>
          <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>Nos extratos</Text>
          {exibidos.length === 0 ? <Texto suave>Nenhum aporte, resgate ou transferência de custódia nos extratos deste mês.</Texto> : null}
          {(todos ? exibidos : exibidos.slice(0, LIMITE)).map((m) => {
            const detalhes = [m.instituicao + (m.conta ? ` (${m.conta})` : ""), m.em_transito ? "em trânsito" : null, m.ja_contado ? "já contado como em trânsito no mês anterior" : null, m.moeda === "USD" && m.valor_brl_centavos !== null ? `${formatarBRL(m.valor_brl_centavos)} na taxa do mês` : null, m.moeda === "USD" && m.valor_brl_centavos === null ? "sem taxa de câmbio" : null].filter(Boolean).join(" · ");
            const sinal = m.tipo === "resgate" ? "-" : "";
            return <Linha key={m.id} data={m.data_local} titulo={`${ROTULO_TIPO_MOVIMENTO[m.tipo]}: ${m.descricao.replace(/^Em trânsito: /, "")}`} valor={`${sinal}${formatarMoeda(m.valor_centavos, m.moeda, formatarBRL)}`} detalhe={detalhes} />;
          })}
          {exibidos.length > LIMITE ? <Botao pequeno secundario rotulo={todos ? "Mostrar menos" : `Mostrar todos os ${exibidos.length} movimentos`} onPress={() => setTodos(!todos)} /> : null}
          <View style={{ borderTopWidth: 1, borderTopColor: t.borda, paddingTop: 6, gap: 2 }}>
            <Texto>{`Aportes (dinheiro): ${formatarBRL(v.aportes_centavos)}`}</Texto>
            {v.custodia_centavos !== 0 ? <Texto>{`Transferências de custódia: ${formatarBRL(v.custodia_centavos)}`}</Texto> : null}
            {v.resgates_centavos !== 0 ? <Texto>{`Resgates: ${formatarBRL(v.resgates_centavos)}`}</Texto> : null}
            <Texto forte>{`Aportes líquidos: ${comSinal(v.aportes_liquidos_centavos, formatarBRL)}`}</Texto>
          </View>
          {outros > 0 ? <Texto suave pequeno>{`Não listados: ${outros} movimento(s) de compra, venda ou provento, que não alteram o patrimônio por si.`}</Texto> : null}
        </View>

        <View style={{ flex: 1, minWidth: 280, gap: 4 }}>
          <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>Nos lançamentos do app</Text>
          {lancamentos.itens.length === 0 ? <Texto suave>Nenhum lançamento do tipo investimento neste mês.</Texto> : null}
          {lancamentos.itens.map((l) => <Linha key={l.id} data={l.data_local} titulo={l.descricao} valor={formatarBRL(l.valor_centavos)} detalhe={l.status === "pendente" ? "pendente de revisão" : undefined} />)}
          <View style={{ borderTopWidth: 1, borderTopColor: t.borda, paddingTop: 6 }}>
            <Texto forte>{`Total lançado: ${formatarBRL(lancamentos.total_centavos)}`}</Texto>
          </View>
        </View>
      </View>
      <Texto suave pequeno>
        {diferenca === 0
          ? "Os aportes em dinheiro dos extratos e os lançamentos do app têm o mesmo total."
          : `Diferença entre as fontes (aportes dos extratos menos lançamentos do app): ${comSinal(diferenca, formatarBRL)}. Pode vir de datas diferentes, de valores em trânsito ou de lançamentos ainda não feitos; confira os dois lados.`}
      </Texto>
    </Cartao>
  );
}
