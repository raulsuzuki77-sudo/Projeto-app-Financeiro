import { useState } from "react";
import { Text, View } from "react-native";
import { useTema } from "./tema";
import { Cartao, Segmentado, Texto } from "./ui";
import type { DadosLiberdade } from "../lib/api";
import { formatarBRL } from "../lib/format";

type Visao = "classe" | "instituicao";

/** Distribuição do patrimônio em reais por classe de ativo ou por instituição, em barras com texto. */
export function LiberdadeDistribuicao({ patrimonio: p }: { patrimonio: DadosLiberdade["patrimonio"] }) {
  const t = useTema();
  const [visao, setVisao] = useState<Visao>("classe");
  const linhas = visao === "classe" ? p.por_classe.map((c) => ({ id: c.classe, rotulo: c.rotulo, valor: c.total_centavos })) : p.por_instituicao.map((c) => ({ id: c.instituicao, rotulo: c.instituicao, valor: c.total_centavos }));
  const soma = linhas.reduce((s, l) => s + l.valor, 0);
  const maximo = Math.max(0, ...linhas.map((l) => l.valor));
  return (
    <Cartao titulo="Distribuição">
      <Segmentado rotulo="Agrupar por" valor={visao} onChange={setVisao} opcoes={[{ id: "classe", rotulo: "Por classe de ativo" }, { id: "instituicao", rotulo: "Por instituição" }]} />
      {linhas.length === 0 ? (
        <Texto suave>Sem posições para distribuir.</Texto>
      ) : (
        <View style={{ gap: 12 }}>
          {linhas.map((l) => {
            const pct = p.total_centavos !== 0 ? (l.valor / p.total_centavos) * 100 : 0;
            const pctTexto = `${pct.toFixed(1).replace(".", ",")}%`;
            return (
              <View key={l.id} style={{ gap: 4 }} accessible accessibilityLabel={`${l.rotulo}: ${formatarBRL(l.valor)}, ${pctTexto} do patrimônio`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ color: t.texto, fontSize: 15, flex: 1 }}>{l.rotulo}</Text>
                  <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>{formatarBRL(l.valor)}</Text>
                </View>
                {l.valor > 0 && maximo > 0 ? (
                  <View style={{ height: 8, borderRadius: 4, backgroundColor: t.borda }}>
                    <View style={{ height: 8, borderRadius: 4, width: `${Math.max(2, (l.valor / maximo) * 100)}%`, backgroundColor: t.barra }} />
                  </View>
                ) : null}
                <Text style={{ color: t.suave, fontSize: 12 }}>{l.valor < 0 ? `${pctTexto} do patrimônio (valor negativo: saídas ainda a liquidar)` : `${pctTexto} do patrimônio`}</Text>
              </View>
            );
          })}
          <View style={{ borderTopWidth: 1, borderTopColor: t.borda, paddingTop: 8, flexDirection: "row", justifyContent: "space-between" }} accessible accessibilityLabel={`Total ${formatarBRL(soma)}`}>
            <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>Total</Text>
            <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>{formatarBRL(soma)}</Text>
          </View>
          <Texto suave pequeno>{soma === p.total_centavos ? "O total é o mesmo nas duas visões e igual ao patrimônio." : `Atenção: a soma (${formatarBRL(soma)}) difere do patrimônio (${formatarBRL(p.total_centavos)}).`}</Texto>
        </View>
      )}
    </Cartao>
  );
}
