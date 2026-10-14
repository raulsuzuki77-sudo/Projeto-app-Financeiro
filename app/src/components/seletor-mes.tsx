import { Pressable, View } from "react-native";
import { Icone } from "./icone";
import { useTema } from "./tema";
import { Texto } from "./ui";
import { mudarMes, nomeMes } from "../lib/format";

/** Navegação compacta entre meses: setas nas pontas e o mês no centro. */
export function SeletorMes({ mes, onChange }: { mes: string; onChange: (m: string) => void }) {
  const t = useTema();
  const botao = (delta: number, nome: "esquerda" | "seta", rotulo: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={rotulo} onPress={() => onChange(mudarMes(mes, delta))} hitSlop={6} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: t.borda, backgroundColor: t.cartao, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <Icone nome={nome} cor={t.primaria} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      {botao(-1, "esquerda", "Mês anterior")}
      <Texto forte>{nomeMes(mes)}</Texto>
      {botao(1, "seta", "Próximo mês")}
    </View>
  );
}
