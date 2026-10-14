import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Icone } from "./icone";
import { useTema } from "./tema";

/**
 * Botão circular flutuante da revisão. Discreto quando não há nada a fazer; em laranja, com anel pulsante e contador,
 * quando há lançamentos aguardando a decisão do usuário.
 */
export function BotaoRevisao({ pendentes, aoTocar }: { pendentes: number; aoTocar: () => void }) {
  const t = useTema();
  const pulso = useRef(new Animated.Value(0)).current;
  const ativo = pendentes > 0;

  useEffect(() => {
    if (!ativo) {
      pulso.setValue(0);
      return;
    }
    const anim = Animated.loop(Animated.timing(pulso, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" }));
    anim.start();
    return () => anim.stop();
  }, [ativo, pulso]);

  const rotulo = ativo ? `Revisar lançamentos: ${pendentes} aguardando sua decisão` : "Revisar lançamentos: nada pendente";
  return (
    <View pointerEvents="box-none" style={estilos.area}>
      {ativo ? (
        <Animated.View
          pointerEvents="none"
          style={[estilos.anel, { borderColor: t.alerta, opacity: pulso.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }), transform: [{ scale: pulso.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }] }]}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rotulo}
        onPress={aoTocar}
        style={({ pressed }) => [estilos.botao, { backgroundColor: ativo ? t.alerta : t.cartao, borderColor: ativo ? t.alerta : t.borda, opacity: pressed ? 0.85 : 1 }]}
      >
        <Icone nome="revisar" cor={ativo ? t.sobrePrimaria : t.suave} tamanho={30} />
        {ativo ? (
          <View style={[estilos.selo, { backgroundColor: t.perigo, borderColor: t.cartao }]}>
            <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "800" }}>{pendentes > 99 ? "99+" : pendentes}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const estilos = StyleSheet.create({
  area: { position: "absolute", right: 18, bottom: 18, width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  anel: { position: "absolute", width: 64, height: 64, borderRadius: 32, borderWidth: 3 },
  botao: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  selo: { position: "absolute", top: -4, right: -4, minWidth: 24, height: 24, borderRadius: 12, borderWidth: 2, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
});
