import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useTema } from "./tema";

export function Cartao({ children, titulo }: { children: ReactNode; titulo?: string }) {
  const t = useTema();
  return (
    <View style={[estilos.cartao, { backgroundColor: t.cartao, borderColor: t.borda }]}>
      {titulo ? <Text style={[estilos.tituloCartao, { color: t.suave }]}>{titulo}</Text> : null}
      {children}
    </View>
  );
}

export function Botao({ rotulo, onPress, desabilitado, carregando, secundario }: { rotulo: string; onPress: () => void; desabilitado?: boolean; carregando?: boolean; secundario?: boolean }) {
  const t = useTema();
  const inativo = desabilitado || carregando;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ disabled: !!inativo }}
      onPress={inativo ? undefined : onPress}
      style={({ pressed }) => [
        estilos.botao,
        secundario ? { borderColor: t.primaria, borderWidth: 1 } : { backgroundColor: t.primaria },
        { opacity: inativo ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {carregando ? <ActivityIndicator color={secundario ? t.primaria : t.sobrePrimaria} /> : <Text style={{ color: secundario ? t.primaria : t.sobrePrimaria, fontWeight: "600", fontSize: 16 }}>{rotulo}</Text>}
    </Pressable>
  );
}

export function Campo(props: TextInputProps & { rotulo: string }) {
  const t = useTema();
  const { rotulo, style, ...resto } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.suave, fontSize: 13 }}>{rotulo}</Text>
      <TextInput accessibilityLabel={rotulo} placeholderTextColor={t.suave} style={[estilos.campo, { color: t.texto, borderColor: t.borda, backgroundColor: t.cartao }, style]} {...resto} />
    </View>
  );
}

export function Texto({ children, suave, forte, cor }: { children: ReactNode; suave?: boolean; forte?: boolean; cor?: string }) {
  const t = useTema();
  return <Text style={{ color: cor ?? (suave ? t.suave : t.texto), fontWeight: forte ? "700" : "400", fontSize: 15 }}>{children}</Text>;
}

export function Aviso({ tipo, children }: { tipo: "erro" | "info"; children: ReactNode }) {
  const t = useTema();
  const cor = tipo === "erro" ? t.perigo : t.alerta;
  return (
    <View accessibilityRole="alert" style={[estilos.aviso, { borderColor: cor }]}>
      <Text style={{ color: cor, fontSize: 14 }}>{children}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  cartao: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 },
  tituloCartao: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  botao: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  campo: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
  aviso: { borderWidth: 1, borderRadius: 10, padding: 12 },
});
