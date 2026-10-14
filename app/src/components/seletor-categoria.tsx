import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CATEGORIAS } from "../../../core/src/index";
import { BotaoIcone } from "./ui";
import { useTema } from "./tema";

/** Folha com todas as categorias, agrupadas e com busca. Devolve o identificador escolhido. */
export function SeletorCategoria({ visivel, selecionada, onEscolher, onFechar }: { visivel: boolean; selecionada?: string | null; onEscolher: (id: string) => void; onFechar: () => void }) {
  const t = useTema();
  const [busca, setBusca] = useState("");
  const itens = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = CATEGORIAS.filter((c) => c.id !== "nao_classificado" && (!q || c.rotulo.toLowerCase().includes(q) || c.grupo.toLowerCase().includes(q)));
    const out: ({ tipo: "grupo"; grupo: string } | { tipo: "cat"; id: string; rotulo: string })[] = [];
    let atual = "";
    for (const c of lista) {
      if (c.grupo !== atual) {
        atual = c.grupo;
        out.push({ tipo: "grupo", grupo: atual });
      }
      out.push({ tipo: "cat", id: c.id, rotulo: c.rotulo });
    }
    return out;
  }, [busca]);

  return (
    <Modal visible={visivel} animationType="slide" presentationStyle="pageSheet" onRequestClose={onFechar}>
      <View style={[estilos.raiz, { backgroundColor: t.fundo }]}>
        <View style={estilos.topo}>
          <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 20, fontWeight: "700", flex: 1 }}>Escolher categoria</Text>
          <BotaoIcone icone="fechar" rotulo="Fechar" onPress={onFechar} />
        </View>
        <TextInput
          accessibilityLabel="Buscar categoria"
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar categoria"
          placeholderTextColor={t.suave}
          autoCorrect={false}
          style={[estilos.busca, { color: t.texto, borderColor: t.borda, backgroundColor: t.suave2 }]}
        />
        <FlatList
          data={itens}
          keyExtractor={(i) => (i.tipo === "grupo" ? `g-${i.grupo}` : i.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) =>
            item.tipo === "grupo" ? (
              <Text style={{ color: t.suave, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 }}>{item.grupo}</Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === selecionada }}
                onPress={() => {
                  setBusca("");
                  onEscolher(item.id);
                }}
                style={({ pressed }) => [estilos.linha, { backgroundColor: item.id === selecionada ? t.suave2 : pressed ? t.suave2 : "transparent" }]}
              >
                <Text style={{ color: t.texto, fontSize: 16, flex: 1 }}>{item.rotulo}</Text>
                {item.id === selecionada ? <Text style={{ color: t.primaria, fontWeight: "700" }}>Atual</Text> : null}
              </Pressable>
            )
          }
          ListEmptyComponent={<Text style={{ color: t.suave, padding: 20 }}>Nenhuma categoria encontrada.</Text>}
        />
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, paddingTop: 12 },
  topo: { flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 8 },
  busca: { marginHorizontal: 20, marginTop: 8, minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
  linha: { minHeight: 52, paddingHorizontal: 20, flexDirection: "row", alignItems: "center" },
});
