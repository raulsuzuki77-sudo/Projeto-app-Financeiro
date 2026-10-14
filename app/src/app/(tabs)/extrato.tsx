import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, FlatList, Platform, Pressable, RefreshControl, Text, View } from "react-native";
import { rotuloCategoria } from "../../../../core/src/index";
import { SeletorMes } from "../../components/seletor-mes";
import { useTema } from "../../components/tema";
import { useToast } from "../../components/toast";
import { Aviso, BotaoIcone, Campo, Chip, GrupoChips, Texto } from "../../components/ui";
import { useBotaoAtualizar, useDados } from "../../hooks/useDados";
import { api, type Lancamento } from "../../lib/api";
import { dataBR, formatarBRL, mesAtual } from "../../lib/format";

type Filtro = "todos" | "despesa" | "receita";

export default function Extrato() {
  const t = useTema();
  const router = useRouter();
  const toast = useToast();
  const [mes, setMes] = useState(mesAtual());
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");

  const { dados, erro, carregando, recarregar } = useDados(() => api.lancamentos({ mes, tipo: filtro === "todos" ? undefined : filtro, busca, limite: 800 }), [mes, filtro, busca]);
  useBotaoAtualizar(recarregar);

  const totais = useMemo(() => {
    const l = dados ?? [];
    return {
      saidas: l.filter((x) => x.tipo === "despesa").reduce((s, x) => s + x.valor_centavos, 0),
      entradas: l.filter((x) => x.tipo === "receita").reduce((s, x) => s + x.valor_centavos, 0),
    };
  }, [dados]);

  async function excluir(l: Lancamento) {
    const feito = async () => {
      await api.excluir(l.id);
      await recarregar();
      toast({ texto: `Excluído: ${l.descricao}`, acao: { rotulo: "Desfazer", fazer: async () => { await api.restaurar(l.id); await recarregar(); } } });
    };
    if (Platform.OS === "web") return feito();
    Alert.alert("Excluir lançamento", `${l.descricao}, ${formatarBRL(l.valor_centavos)}?`, [{ text: "Cancelar", style: "cancel" }, { text: "Excluir", style: "destructive", onPress: feito }]);
  }

  const cabecalho = (
    <View style={{ gap: 12, padding: 16, paddingBottom: 8 }}>
      <SeletorMes mes={mes} onChange={setMes} />
      <Campo rotulo="Buscar" value={busca} onChangeText={setBusca} placeholder="Descrição do lançamento" autoCorrect={false} returnKeyType="search" />
      <GrupoChips>
        <Chip rotulo="Tudo" ativo={filtro === "todos"} onPress={() => setFiltro("todos")} />
        <Chip rotulo="Saídas" ativo={filtro === "despesa"} onPress={() => setFiltro("despesa")} />
        <Chip rotulo="Entradas" ativo={filtro === "receita"} onPress={() => setFiltro("receita")} />
      </GrupoChips>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Texto suave pequeno>Saídas: {formatarBRL(totais.saidas)}</Texto>
        <Texto suave pequeno>Entradas: {formatarBRL(totais.entradas)}</Texto>
      </View>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </View>
  );

  return (
    <FlatList
      data={dados ?? []}
      keyExtractor={(l) => String(l.id)}
      ListHeaderComponent={cabecalho}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}
      contentContainerStyle={{ paddingBottom: 40 }}
      ListEmptyComponent={dados ? <View style={{ padding: 24 }}><Texto suave>Nenhum lançamento neste período.</Texto></View> : null}
      renderItem={({ item: l }) => (
        <View style={{ flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: t.borda, backgroundColor: t.cartao }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Editar ${l.descricao}, ${formatarBRL(l.valor_centavos)}`} onPress={() => router.push(`/lancamento/${l.id}`)} style={({ pressed }) => ({ flex: 1, paddingVertical: 12, paddingLeft: 16, gap: 2, opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ color: t.texto, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>{l.descricao}</Text>
            <Text style={{ color: t.suave, fontSize: 13 }} numberOfLines={1}>
              {dataBR(l.data_local)}{l.hora_local !== null ? ` · ${String(l.hora_local).padStart(2, "0")}h` : ""}
            </Text>
            <Text style={{ color: l.status === "pendente" ? t.alerta : t.suave, fontSize: 13 }} numberOfLines={1}>
              {rotuloCategoria(l.categoria)}{l.status === "pendente" ? " (pendente)" : ""}
            </Text>
          </Pressable>
          <Text style={{ color: l.tipo === "receita" ? t.receita : l.tipo === "despesa" ? t.texto : t.suave, fontSize: 16, fontWeight: "700", paddingHorizontal: 8 }}>
            {l.tipo === "receita" ? "+" : l.tipo === "despesa" ? "−" : ""}{formatarBRL(l.valor_centavos)}
          </Text>
          <BotaoIcone icone="lixeira" rotulo={`Excluir ${l.descricao}`} onPress={() => excluir(l)} cor={t.suave} />
        </View>
      )}
    />
  );
}
