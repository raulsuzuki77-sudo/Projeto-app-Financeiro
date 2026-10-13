import { View } from "react-native";
import { Botao, Texto } from "./ui";
import { mudarMes, nomeMes } from "../lib/format";

export function SeletorMes({ mes, onChange }: { mes: string; onChange: (m: string) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <View style={{ width: 96 }}><Botao rotulo="Anterior" onPress={() => onChange(mudarMes(mes, -1))} secundario /></View>
      <Texto forte>{nomeMes(mes)}</Texto>
      <View style={{ width: 96 }}><Botao rotulo="Proximo" onPress={() => onChange(mudarMes(mes, 1))} secundario /></View>
    </View>
  );
}
