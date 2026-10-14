import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { grupoDaCategoria, rotuloCategoria, ROTULO_TIPO_EVENTO } from "../../../../core/src/index";
import { FormularioEvento } from "../../components/formulario-evento";
import { useTema } from "../../components/tema";
import { useToast } from "../../components/toast";
import { Aviso, Botao, Cartao, Texto } from "../../components/ui";
import { useBotaoAtualizar, useDados } from "../../hooks/useDados";
import { api, type Lancamento } from "../../lib/api";
import { dataBR, formatarBRL } from "../../lib/format";

const gastos = (n: number) => `${n} ${n === 1 ? "gasto" : "gastos"}`;

interface GrupoResumo {
  grupo: string;
  total: number;
  quantidade: number;
  categorias: { categoria: string; total_centavos: number; quantidade: number }[];
}

export default function Evento() {
  const t = useTema();
  const router = useRouter();
  const navigation = useNavigation();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const numero = Number(id);
  const { dados, erro, carregando, recarregar } = useDados(() => api.detalheEvento(numero), [numero]);
  useBotaoAtualizar(recarregar);
  const [editando, setEditando] = useState(false);

  const evento = dados?.evento;
  const lancamentos = (dados?.lancamentos ?? []) as Lancamento[];

  useEffect(() => {
    if (evento) navigation.setOptions({ title: evento.nome });
  }, [navigation, evento]);

  // Categorias agrupadas pelo grupo (gênero), ambos em ordem decrescente de valor.
  const grupos = useMemo(() => {
    const m = new Map<string, GrupoResumo>();
    for (const c of dados?.por_categoria ?? []) {
      const nome = grupoDaCategoria(c.categoria);
      const g = m.get(nome) ?? { grupo: nome, total: 0, quantidade: 0, categorias: [] };
      g.total += c.total_centavos;
      g.quantidade += c.quantidade;
      g.categorias.push(c);
      m.set(nome, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [dados]);

  async function salvar(e: { nome: string; tipo: "ferias" | "viagem_servico" | "outro"; data_inicio: string; data_fim: string }) {
    const r = await api.atualizarEvento(numero, e);
    setEditando(false);
    await recarregar();
    toast({ texto: r.vinculados > 0 ? `Evento atualizado. ${r.vinculados} ${r.vinculados === 1 ? "gasto sem evento foi vinculado" : "gastos sem evento foram vinculados"} neste período.` : "Evento atualizado." });
  }

  async function removerDoEvento(l: Lancamento) {
    await api.definirEventoDoLancamento(l.id, null);
    await recarregar();
    toast({
      texto: `Removido do evento: ${l.descricao}`,
      acao: { rotulo: "Desfazer", fazer: async () => { await api.definirEventoDoLancamento(l.id, numero); await recarregar(); } },
    });
  }

  function excluir() {
    if (!evento) return;
    const msg = `Excluir o evento "${evento.nome}"? Os lançamentos permanecem no extrato, apenas sem o vínculo com o evento.`;
    const feito = async () => {
      await api.removerEvento(numero);
      toast({ texto: `Evento excluído: ${evento.nome}` });
      if (router.canGoBack()) router.back();
      else router.replace("/eventos");
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(msg)) void feito();
      return;
    }
    Alert.alert("Excluir evento", msg, [{ text: "Cancelar", style: "cancel" }, { text: "Excluir", style: "destructive", onPress: feito }]);
  }

  if (erro) return <View style={{ padding: 16 }}><Aviso tipo="erro">{erro}</Aviso></View>;
  if (!dados || !evento) return null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}>
        <Cartao>
          <View style={{ gap: 2 }}>
            <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 20, fontWeight: "700" }}>{evento.nome}</Text>
            <Text style={{ color: t.suave, fontSize: 14 }}>{ROTULO_TIPO_EVENTO[evento.tipo]} · {dataBR(evento.data_inicio)} a {dataBR(evento.data_fim)}</Text>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ color: t.suave, fontSize: 12, fontWeight: "600", letterSpacing: 0.5 }}>TOTAL DO EVENTO</Text>
            <Text accessibilityLabel={`Total do evento: ${formatarBRL(dados.total_centavos)}`} style={{ color: t.texto, fontSize: 28, fontWeight: "800" }}>{formatarBRL(dados.total_centavos)}</Text>
            <Text style={{ color: t.suave, fontSize: 13 }}>{gastos(dados.por_categoria.reduce((s, c) => s + c.quantidade, 0))}</Text>
          </View>
          {editando ? null : (
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Botao rotulo="Editar evento" icone="editar" pequeno secundario onPress={() => setEditando(true)} />
              <Botao rotulo="Excluir evento" icone="lixeira" pequeno perigo onPress={excluir} />
            </View>
          )}
        </Cartao>

        {editando ? (
          <Cartao titulo="Editar evento">
            <FormularioEvento
              inicial={{ nome: evento.nome, tipo: evento.tipo, inicio: dataBR(evento.data_inicio), fim: dataBR(evento.data_fim) }}
              rotuloBotao="Salvar alterações"
              onEnviar={salvar}
              onCancelar={() => setEditando(false)}
              ajuda={<Texto suave pequeno>Ao salvar, os gastos do período que ainda não têm evento são vinculados a este (o número aparece no aviso). Os gastos já vinculados que ficarem fora do novo período continuam no evento até você removê-los.</Texto>}
            />
          </Cartao>
        ) : null}

        <Cartao titulo="Gastos por categoria">
          {grupos.length === 0 ? <Texto suave>Nenhum gasto vinculado a este evento.</Texto> : null}
          {grupos.map((g) => (
            <View key={g.grupo} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <Text accessibilityRole="header" style={{ flex: 1, color: t.primaria, fontSize: 16, fontWeight: "700" }}>{g.grupo}</Text>
                <Text style={{ color: t.primaria, fontSize: 16, fontWeight: "700" }}>{formatarBRL(g.total)}</Text>
              </View>
              <View style={{ marginLeft: 6, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: t.borda, gap: 8 }}>
                {g.categorias.map((c) => (
                  <View key={c.categoria} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.texto, fontSize: 15 }}>{rotuloCategoria(c.categoria)}</Text>
                      <Text style={{ color: t.suave, fontSize: 12 }}>{gastos(c.quantidade)}</Text>
                    </View>
                    <Text style={{ color: t.texto, fontSize: 15 }}>{formatarBRL(c.total_centavos)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
          <Texto suave pequeno>O gasto conta no evento e também na sua categoria, sem duplicar: o total de cada visão (por evento ou por categoria) soma o gasto uma única vez.</Texto>
        </Cartao>

        <Cartao titulo={`Lançamentos do evento (${lancamentos.length})`}>
          {lancamentos.length === 0 ? <Texto suave>Nenhum lançamento vinculado. Em Editar lançamento, escolha este evento para vincular um gasto.</Texto> : null}
          {lancamentos.map((l, i) => {
            const fora = l.tipo !== "despesa";
            return (
              <View key={l.id} style={[{ gap: 2 }, i > 0 && { borderTopWidth: 1, borderTopColor: t.borda, paddingTop: 10 }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${l.descricao}, ${dataBR(l.data_local)}, ${formatarBRL(l.valor_centavos)}. Editar lançamento`} onPress={() => router.push(`/lancamento/${l.id}`)} style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                    <Text style={{ flex: 1, color: t.texto, fontSize: 15, fontWeight: "600" }}>{l.descricao}</Text>
                    <Text style={{ color: t.texto, fontSize: 15, fontWeight: "600" }}>{formatarBRL(l.valor_centavos)}</Text>
                  </View>
                  <Text style={{ color: t.suave, fontSize: 13 }}>
                    {dataBR(l.data_local)} · {rotuloCategoria(l.categoria)}
                    {l.status === "pendente" ? " · aguarda revisão" : ""}
                    {fora ? " · não entra no total" : ""}
                  </Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${l.descricao} do evento`} onPress={() => removerDoEvento(l)} style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ color: t.perigo, fontSize: 14, fontWeight: "600" }}>Remover do evento</Text>
                </Pressable>
              </View>
            );
          })}
        </Cartao>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
