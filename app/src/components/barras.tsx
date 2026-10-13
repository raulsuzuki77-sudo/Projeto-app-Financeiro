import { View } from "react-native";
import { useTema } from "./tema";
import { Texto } from "./ui";
import { formatarBRL, intensidade, rotuloCategoria } from "../lib/format";

export function Barras({ dados }: { dados: { rotulo: string; valor: number }[] }) {
  const t = useTema();
  const max = Math.max(0, ...dados.map((d) => d.valor));
  return (
    <View style={{ gap: 10 }}>
      {dados.map((d) => (
        <View key={d.rotulo} style={{ gap: 4 }} accessible accessibilityLabel={`${rotuloCategoria(d.rotulo)}: ${formatarBRL(d.valor)}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Texto>{rotuloCategoria(d.rotulo)}</Texto>
            <Texto forte>{formatarBRL(d.valor)}</Texto>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.borda }}>
            <View style={{ height: 8, borderRadius: 4, width: `${Math.max(2, intensidade(d.valor, max) * 100)}%`, backgroundColor: t.barra }} />
          </View>
        </View>
      ))}
    </View>
  );
}
