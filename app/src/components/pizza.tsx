import { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { G, Path, Text as SvgTexto } from "react-native-svg";
import { agruparFatias, geometriaPizza, type Fatia } from "../lib/pizza";
import { formatarBRL } from "../lib/format";
import { useTema } from "./tema";

/**
 * Gráfico de pizza (anel) com legenda. Os valores aparecem também em texto, na legenda, para não depender só de cor.
 * Tocar numa fatia ou numa linha da legenda destaca a categoria no centro do anel.
 */
export function Pizza({ dados, tamanho = 200, max = 7, legenda = 5, aoTocar }: { dados: Fatia[]; tamanho?: number; max?: number; legenda?: number; aoTocar?: (id: string) => void }) {
  const t = useTema();
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [todas, setTodas] = useState(false);
  const fatias = useMemo(() => geometriaPizza(agruparFatias(dados, max), tamanho), [dados, max, tamanho]);
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const sel = fatias.find((f) => f.id === selecionada);
  const c = tamanho / 2;
  const fonte = Platform.OS === "web" ? "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" : undefined;

  if (fatias.length === 0) return null;
  return (
    <View style={{ gap: 16, alignItems: "center" }}>
      <Svg width={tamanho} height={tamanho} accessibilityLabel={`Gráfico de pizza. Total ${formatarBRL(total)}`}>
        <G>
          {fatias.map((f) => (
            <Path key={f.id} d={f.caminho} fill={f.cor} fillRule="evenodd" opacity={sel && sel.id !== f.id ? 0.35 : 1} onPress={() => setSelecionada(f.id === selecionada ? null : f.id)} />
          ))}
        </G>
        <SvgTexto x={c} y={c - 6} fill={t.suave} fontSize={12} fontFamily={fonte} textAnchor="middle">{sel ? sel.rotulo : "Total"}</SvgTexto>
        <SvgTexto x={c} y={c + 16} fill={t.texto} fontSize={tamanho > 170 ? 18 : 15} fontWeight="700" fontFamily={fonte} textAnchor="middle">{formatarBRL(sel ? sel.valor : total)}</SvgTexto>
      </Svg>
      <View style={{ alignSelf: "stretch", gap: 2 }}>
        {(todas ? fatias : fatias.slice(0, legenda)).map((f) => (
          <Pressable
            key={f.id}
            accessibilityRole="button"
            accessibilityLabel={`${f.rotulo}: ${formatarBRL(f.valor)}, ${(f.fracao * 100).toFixed(0)} por cento`}
            onPress={() => (aoTocar && f.id !== "__outras" ? aoTocar(f.id) : setSelecionada(f.id === selecionada ? null : f.id))}
            style={estilos.linha}
          >
            <View style={[estilos.cor, { backgroundColor: f.cor }]} />
            <Text style={[estilos.rotulo, { color: t.texto }]} numberOfLines={2}>{f.rotulo}</Text>
            <Text style={[estilos.pct, { color: t.suave }]}>{(f.fracao * 100).toFixed(0)}%</Text>
            <Text style={[estilos.valor, { color: t.texto }]}>{formatarBRL(f.valor)}</Text>
          </Pressable>
        ))}
        {fatias.length > legenda ? (
          <Pressable accessibilityRole="button" onPress={() => setTodas(!todas)} style={{ minHeight: 40, justifyContent: "center" }}>
            <Text style={{ color: t.primaria, fontWeight: "600", fontSize: 14 }}>{todas ? "Mostrar menos" : `Mostrar todas as categorias (${fatias.length})`}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  linha: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40, paddingVertical: 2 },
  cor: { width: 14, height: 14, borderRadius: 4 },
  rotulo: { flex: 1, fontSize: 14 },
  pct: { width: 40, textAlign: "right", fontSize: 13 },
  valor: { width: 104, textAlign: "right", fontSize: 14, fontWeight: "600" },
});
