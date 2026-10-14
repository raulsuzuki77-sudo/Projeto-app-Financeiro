import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { pizzasDaCarteira, type BaseSetor, type PizzaCarteira } from "../../../core/src/index";
import { Pizza } from "./pizza";
import { useTema } from "./tema";
import { Cartao, Segmentado, Texto } from "./ui";
import type { DadosLiberdade } from "../lib/api";
import { formatarBRL } from "../lib/format";

function CartaoPizza({ p }: { p: PizzaCarteira }) {
  const t = useTema();
  const pct = p.fracao_do_patrimonio === null ? null : `${(p.fracao_do_patrimonio * 100).toFixed(1).replace(".", ",")}% do patrimônio`;
  return (
    <Cartao titulo={p.titulo}>
      <View accessible accessibilityLabel={`Base do gráfico: ${p.base}. Total ${formatarBRL(p.base_centavos)}`} style={{ gap: 2 }}>
        <Text style={{ color: t.suave, fontSize: 13 }}>{`Base: ${p.base}`}</Text>
        <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>{`${formatarBRL(p.base_centavos)}${pct ? ` (${pct})` : ""}`}</Text>
      </View>
      {p.fatias.length === 0 ? (
        <Texto suave>Sem valores positivos para desenhar nesta base.</Texto>
      ) : (
        <Pizza dados={p.fatias} tamanho={200} max={8} legenda={8} />
      )}
      <View accessible accessibilityLabel={`Soma das fatias ${formatarBRL(p.soma_fatias_centavos)}; base ${formatarBRL(p.base_centavos)}`} style={{ borderTopWidth: 1, borderTopColor: t.borda, paddingTop: 8, gap: 2 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: t.texto, fontSize: 14, fontWeight: "700" }}>Soma das fatias</Text>
          <Text style={{ color: t.texto, fontSize: 14, fontWeight: "700" }}>{formatarBRL(p.soma_fatias_centavos)}</Text>
        </View>
        {p.nao_representado_centavos !== 0 ? (
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: t.alerta, fontSize: 13, flex: 1 }}>Valor negativo, que uma pizza não desenha</Text>
            <Text style={{ color: t.alerta, fontSize: 13, fontWeight: "700" }}>{formatarBRL(p.nao_representado_centavos)}</Text>
          </View>
        ) : null}
        <Texto suave pequeno>{p.nao_representado_centavos === 0 ? "A soma das fatias é igual à base." : `Soma das fatias ${formatarBRL(p.soma_fatias_centavos)} ${p.nao_representado_centavos < 0 ? "+" : "−"} ${formatarBRL(Math.abs(p.nao_representado_centavos))} de ajuste = base ${formatarBRL(p.base_centavos)}.`}</Texto>
      </View>
      {p.nota ? <Texto suave pequeno>{p.nota}</Texto> : null}
    </Cartao>
  );
}

/**
 * Três pizzas da carteira (gênero e espécie, setor, nacional x estrangeira), no estilo da aba Início. Cada uma diz a base que usa e
 * soma o total dessa base; a escolha de incluir ou não a Meta vale para todas.
 */
export function LiberdadePizzas({ carteira }: { carteira: DadosLiberdade["carteira"] }) {
  const [incluirMeta, setIncluirMeta] = useState(true);
  const [baseSetor, setBaseSetor] = useState<BaseSetor>("acoes");
  const temMeta = carteira.meta_centavos !== 0;
  const pizzas = useMemo(() => pizzasDaCarteira(carteira.itens, { incluirMeta: incluirMeta || !temMeta, baseSetor }), [carteira.itens, incluirMeta, temMeta, baseSetor]);
  return (
    <View style={{ gap: 16 }}>
      <Cartao titulo="Gráficos da carteira">
        {temMeta ? (
          <Segmentado
            rotulo="Patrimônio considerado"
            valor={incluirMeta ? "total" : "liberdade"}
            onChange={(v) => setIncluirMeta(v === "total")}
            opcoes={[{ id: "total", rotulo: "Total (com Meta)" }, { id: "liberdade", rotulo: "Sem Meta" }]}
          />
        ) : (
          <Texto suave pequeno>Nenhum ativo marcado como Meta: a base é o patrimônio total.</Texto>
        )}
        <Texto suave pequeno>Cada gráfico informa a base que usa. Valores em dólar entram convertidos pelo câmbio do mês.</Texto>
      </Cartao>
      <CartaoPizza p={pizzas.genero} />
      <View style={{ gap: 12 }}>
        <Segmentado
          rotulo="Base da distribuição setorial"
          valor={baseSetor}
          onChange={setBaseSetor}
          opcoes={[{ id: "acoes", rotulo: "Ações" }, { id: "renda_variavel", rotulo: "Renda variável" }, { id: "tudo", rotulo: "Tudo" }]}
        />
        <CartaoPizza p={pizzas.setor} />
      </View>
      <CartaoPizza p={pizzas.origem} />
    </View>
  );
}
