import type { ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { mascararValor } from "../lib/format";
import { Icone, type NomeIcone } from "./icone";
import { useTema } from "./tema";

export function Cartao({ children, titulo, acao }: { children: ReactNode; titulo?: string; acao?: ReactNode }) {
  const t = useTema();
  return (
    <View style={[estilos.cartao, { backgroundColor: t.cartao, borderColor: t.borda }]}>
      {titulo || acao ? (
        <View style={estilos.cabecalhoCartao}>
          {titulo ? <Text accessibilityRole="header" style={[estilos.tituloCartao, { color: t.suave }]}>{titulo}</Text> : <View />}
          {acao}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Botao({ rotulo, onPress, desabilitado, carregando, secundario, perigo, pequeno, icone }: { rotulo: string; onPress: () => void; desabilitado?: boolean; carregando?: boolean; secundario?: boolean; perigo?: boolean; pequeno?: boolean; icone?: NomeIcone }) {
  const t = useTema();
  const inativo = desabilitado || carregando;
  const cor = perigo ? t.perigo : t.primaria;
  const textoCor = secundario || perigo ? cor : t.sobrePrimaria;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ disabled: !!inativo }}
      onPress={inativo ? undefined : onPress}
      style={({ pressed }) => [estilos.botao, pequeno && estilos.botaoPequeno, secundario || perigo ? { borderColor: cor, borderWidth: 1 } : { backgroundColor: cor }, { opacity: inativo ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      {carregando ? (
        <ActivityIndicator color={textoCor} />
      ) : (
        <View style={estilos.linha}>
          {icone ? <Icone nome={icone} cor={textoCor} tamanho={pequeno ? 16 : 18} /> : null}
          <Text style={{ color: textoCor, fontWeight: "600", fontSize: pequeno ? 14 : 16 }}>{rotulo}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function BotaoIcone({ icone, rotulo, onPress, cor }: { icone: NomeIcone; rotulo: string; onPress: () => void; cor?: string }) {
  const t = useTema();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={rotulo} onPress={onPress} hitSlop={8} style={({ pressed }) => [estilos.botaoIcone, { opacity: pressed ? 0.6 : 1 }]}>
      <Icone nome={icone} cor={cor ?? t.texto} />
    </Pressable>
  );
}

export function Campo(props: TextInputProps & { rotulo: string; prefixo?: string }) {
  const t = useTema();
  const { rotulo, prefixo, style, ...resto } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.suave, fontSize: 13 }}>{rotulo}</Text>
      <View style={[estilos.campoCaixa, { borderColor: t.borda, backgroundColor: t.suave2 }]}>
        {prefixo ? <Text style={{ color: t.suave, fontSize: 16, marginRight: 6 }}>{prefixo}</Text> : null}
        <TextInput accessibilityLabel={rotulo} placeholderTextColor={t.suave} style={[estilos.campo, { color: t.texto }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null, style]} {...resto} />
      </View>
    </View>
  );
}

/** Campo de valor em reais: a vírgula e os pontos de milhar entram sozinhos conforme se digitam os números. */
export function CampoValor(props: Omit<TextInputProps, "keyboardType" | "onChangeText"> & { rotulo: string; prefixo?: string; onChangeText: (mascarado: string) => void }) {
  const { onChangeText, value, ...resto } = props;
  return <Campo prefixo="R$" placeholder="0,00" {...resto} value={value} keyboardType="number-pad" onChangeText={(v) => onChangeText(mascararValor(v))} />;
}

export function Texto({ children, suave, forte, cor, pequeno }: { children: ReactNode; suave?: boolean; forte?: boolean; cor?: string; pequeno?: boolean }) {
  const t = useTema();
  return <Text style={{ color: cor ?? (suave ? t.suave : t.texto), fontWeight: forte ? "700" : "400", fontSize: pequeno ? 13 : 15 }}>{children}</Text>;
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

/** Opção selecionável (forma de pagamento, cartão, filtros). */
export function Chip({ rotulo, ativo, onPress, destaque }: { rotulo: string; ativo?: boolean; onPress: () => void; destaque?: boolean }) {
  const t = useTema();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!ativo }}
      onPress={onPress}
      style={[estilos.chip, { borderColor: ativo || destaque ? t.primaria : t.borda, backgroundColor: ativo ? t.primaria : "transparent" }]}
    >
      <Text style={{ color: ativo ? t.sobrePrimaria : destaque ? t.primaria : t.texto, fontWeight: ativo || destaque ? "700" : "400", fontSize: 14 }}>{rotulo}</Text>
    </Pressable>
  );
}

export function GrupoChips({ children }: { children: ReactNode }) {
  return <View style={estilos.grupoChips}>{children}</View>;
}

/** Alternância entre 2 a 4 opções exclusivas, em uma barra única. */
export function Segmentado<T extends string>({ opcoes, valor, onChange, rotulo }: { opcoes: { id: T; rotulo: string }[]; valor: T; onChange: (v: T) => void; rotulo?: string }) {
  const t = useTema();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={rotulo} style={[estilos.segmentado, { backgroundColor: t.suave2, borderColor: t.borda }]}>
      {opcoes.map((o) => {
        const ativo = o.id === valor;
        return (
          <Pressable key={o.id} accessibilityRole="tab" accessibilityState={{ selected: ativo }} onPress={() => onChange(o.id)} style={[estilos.segmento, ativo && { backgroundColor: t.primaria }]}>
            <Text style={{ color: ativo ? t.sobrePrimaria : t.texto, fontWeight: ativo ? "700" : "500", fontSize: 14 }}>{o.rotulo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  cartao: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  cabecalhoCartao: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 24 },
  tituloCartao: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  botao: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  botaoPequeno: { minHeight: 40, borderRadius: 10, paddingHorizontal: 12 },
  botaoIcone: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  linha: { flexDirection: "row", alignItems: "center", gap: 8 },
  campoCaixa: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center" },
  campo: { flex: 1, fontSize: 16, minHeight: 46 },
  aviso: { borderWidth: 1, borderRadius: 10, padding: 12 },
  chip: { minHeight: 40, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, justifyContent: "center" },
  grupoChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  segmentado: { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 3, gap: 3 },
  segmento: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
});
