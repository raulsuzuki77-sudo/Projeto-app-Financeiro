import { Pressable, View } from "react-native";
import { useTema } from "./tema";
import { Texto } from "./ui";
import { rotuloCategoria } from "../../../core/src/index";
import { formatarBRL, intensidade } from "../lib/format";

/** Barras horizontais; com `aoTocar`, cada linha abre os lançamentos que a compõem. `nomear` traduz o rótulo (por padrão, o nome da categoria). */
export function Barras({ dados, aoTocar, nomear = rotuloCategoria }: { dados: { rotulo: string; valor: number }[]; aoTocar?: (rotulo: string) => void; nomear?: (r: string) => string }) {
  const t = useTema();
  const max = Math.max(0, ...dados.map((d) => d.valor));
  return (
    <View style={{ gap: 10 }}>
      {dados.map((d) => (
        <Pressable key={d.rotulo} disabled={!aoTocar} onPress={() => aoTocar?.(d.rotulo)} style={({ pressed }) => ({ gap: 4, opacity: pressed ? 0.7 : 1 })} accessibilityRole={aoTocar ? "button" : undefined} accessibilityLabel={`${nomear(d.rotulo)}: ${formatarBRL(d.valor)}${aoTocar ? ". Toque para ver os lançamentos." : ""}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Texto>{nomear(d.rotulo)}</Texto>
            <Texto forte>{formatarBRL(d.valor)}</Texto>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.borda }}>
            <View style={{ height: 8, borderRadius: 4, width: `${Math.max(2, intensidade(d.valor, max) * 100)}%`, backgroundColor: t.barra }} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}
