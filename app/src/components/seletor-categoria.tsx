import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CATEGORIAS, CLASSES } from "../../../core/src/index";
import { BotaoIcone } from "./ui";
import { useTema } from "./tema";

/** Folha com todas as categorias, agrupadas e com busca. Devolve o identificador escolhido. */
export function SeletorCategoria({ visivel, selecionada, onEscolher, onFechar }: { visivel: boolean; selecionada?: string | null; onEscolher: (id: string) => void; onFechar: () => void }) {
  const t = useTema();
  const [busca, setBusca] = useState("");
  const itens = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = CATEGORIAS.filter((c) => c.id !== "nao_classificado" && (!q || c.rotulo.toLowerCase().includes(q) || c.grupo.toLowerCase().includes(q)));
    const out: ({ tipo: "grupo"; grupo: string } | { tipo: "cat"; id: string; rotulo: string; classe: string | null })[] = [];
    let atual = "";
    for (const c of lista) {
      if (c.grupo !== atual) {
        atual = c.grupo;
        out.push({ tipo: "grupo", grupo: atual });
      }
      out.push({ tipo: "cat", id: c.id, rotulo: c.rotulo, classe: CLASSES.find((x) => x.id === c.classe)?.rotulo ?? null });
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
              // O grupo (ex.: Alimentação) em destaque; as categorias abaixo ficam recuadas, para mostrar que estão contidas nele.
              <View accessibilityRole="header" style={{ backgroundColor: t.suave2, borderLeftWidth: 4, borderLeftColor: t.primaria, marginTop: 14, paddingHorizontal: 16, paddingVertical: 10 }}>
                <Text style={{ color: t.primaria, fontSize: 17, fontWeight: "800" }}>{item.grupo}</Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === selecionada }}
                onPress={() => {
                  setBusca("");
                  onEscolher(item.id);
                }}
                style={({ pressed }) => [estilos.linha, { backgroundColor: item.id === selecionada ? t.suave2 : pressed ? t.suave2 : "transparent", marginLeft: 28, borderLeftWidth: 1, borderLeftColor: t.borda }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.texto, fontSize: 16 }}>{item.rotulo}</Text>
                  {item.classe ? <Text style={{ color: t.suave, fontSize: 12 }}>Classe: {item.classe}</Text> : null}
                </View>
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
  linha: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 6, flexDirection: "row", alignItems: "center" },
});
