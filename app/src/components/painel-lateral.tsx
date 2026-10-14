import { useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icone, type NomeIcone } from "./icone";
import { useTema } from "./tema";

interface Ctx {
  abrir: () => void;
}
const PainelCtx = createContext<Ctx>({ abrir: () => undefined });
export const usePainelLateral = () => useContext(PainelCtx);

const ITENS: { rota: string; rotulo: string; descricao: string; icone: NomeIcone }[] = [
  { rota: "/importar", rotulo: "Importar documento", descricao: "Fatura, extrato ou comprovante", icone: "importar" },
  { rota: "/eventos", rotulo: "Viagens e eventos", descricao: "Férias, viagens a serviço, gastos do período", icone: "calendario" },
  { rota: "/recorrentes", rotulo: "Gastos recorrentes", descricao: "Aluguel, assinaturas, salário", icone: "recorrente" },
  { rota: "/metas", rotulo: "Metas e cenários", descricao: "Reserva, investimentos, perfil de risco", icone: "meta" },
  { rota: "/cartoes", rotulo: "Cartões", descricao: "Apelidos e senha dos PDFs", icone: "cartao" },
  { rota: "/seguranca", rotulo: "Backup e segurança", descricao: "Face ID, backup cifrado", icone: "seguranca" },
];

const LARGURA = 300;

/** Painel lateral ocultável com as opções menos usadas. Abre pelo botão de menu do cabeçalho. */
export function PainelLateralProvider({ children }: { children: ReactNode }) {
  const t = useTema();
  const router = useRouter();
  const [visivel, setVisivel] = useState(false);
  const x = useRef(new Animated.Value(-LARGURA)).current;
  const fundo = useRef(new Animated.Value(0)).current;

  const abrir = useCallback(() => setVisivel(true), []);
  const fechar = useCallback(
    (depois?: () => void) => {
      Animated.parallel([Animated.timing(x, { toValue: -LARGURA, duration: 180, useNativeDriver: false }), Animated.timing(fundo, { toValue: 0, duration: 180, useNativeDriver: false })]).start(() => {
        setVisivel(false);
        depois?.();
      });
    },
    [x, fundo],
  );

  useEffect(() => {
    if (visivel) Animated.parallel([Animated.timing(x, { toValue: 0, duration: 220, useNativeDriver: false }), Animated.timing(fundo, { toValue: 1, duration: 220, useNativeDriver: false })]).start();
  }, [visivel, x, fundo]);

  return (
    <PainelCtx.Provider value={{ abrir }}>
      {children}
      <Modal visible={visivel} transparent animationType="none" onRequestClose={() => fechar()} supportedOrientations={["portrait", "landscape"]}>
        <View style={estilos.raiz}>
          <Animated.View style={[estilos.sombra, { opacity: fundo.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }) }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar menu" style={StyleSheet.absoluteFill} onPress={() => fechar()} />
          </Animated.View>
          <Animated.View style={[estilos.painel, { width: LARGURA, backgroundColor: t.cartao, borderRightColor: t.borda, transform: [{ translateX: x }] }]}>
            <ScrollView contentContainerStyle={{ paddingTop: 64, paddingBottom: 32 }}>
              <Text accessibilityRole="header" style={[estilos.titulo, { color: t.texto }]}>Mais opções</Text>
              {ITENS.map((i) => (
                <Pressable key={i.rota} accessibilityRole="button" accessibilityLabel={i.rotulo} onPress={() => fechar(() => router.push(i.rota as never))} style={({ pressed }) => [estilos.item, { backgroundColor: pressed ? t.suave2 : "transparent" }]}>
                  <Icone nome={i.icone} cor={t.primaria} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.texto, fontSize: 16, fontWeight: "600" }}>{i.rotulo}</Text>
                    <Text style={{ color: t.suave, fontSize: 13 }}>{i.descricao}</Text>
                  </View>
                  <Icone nome="seta" cor={t.suave} tamanho={18} />
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </PainelCtx.Provider>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, flexDirection: "row" },
  sombra: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#000" },
  painel: { height: "100%", borderRightWidth: 1 },
  titulo: { fontSize: 22, fontWeight: "700", paddingHorizontal: 20, paddingBottom: 12 },
  item: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 14, minHeight: 64 },
});
