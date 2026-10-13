import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Aviso, Botao, Cartao, Texto } from "../components/ui";
import { useTema } from "../components/tema";
import { api, type Lancamento } from "../lib/api";
import { formatarBRL, rotuloCategoria } from "../lib/format";

const CATEGORIAS = [
  "alimentacao_supermercado", "alimentacao_restaurante", "alimentacao_delivery", "transporte_combustivel", "saude", "moradia",
  "moradia_manutencao", "lazer_bar", "lazer_passeios", "lazer_assinaturas", "educacao", "vestuario", "outros",
];

export default function Revisar() {
  const t = useTema();
  const [itens, setItens] = useState<Lancamento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    try {
      setErro(null);
      setItens(await api.lancamentos({ status: "pendente" }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    }
  }, []);
  useFocusEffect(useCallback(() => void carregar(), [carregar]));

  async function agir(id: number, dados: { categoria?: string; status?: "pendente" | "confirmado" | "cancelado" }) {
    try {
      await api.alterar(id, dados);
      setAberto(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    }
  }

  return (
    <ScrollView style={{ backgroundColor: t.fundo }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {itens && itens.length === 0 ? <Cartao><Texto>Nada pendente. Todos os lancamentos estao confirmados.</Texto></Cartao> : null}
      {itens?.map((l) => (
        <Cartao key={l.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Texto forte>{l.descricao}</Texto>
              <Texto suave>{l.data_local}{l.hora_local !== null ? ` ${String(l.hora_local).padStart(2, "0")}h` : ""} - {rotuloCategoria(l.categoria)}</Texto>
            </View>
            <Texto forte>{formatarBRL(l.valor_centavos)}</Texto>
          </View>
          {l.motivo_revisao ? <Aviso tipo="info">{l.motivo_revisao}</Aviso> : null}
          <Botao rotulo="Confirmar como esta" onPress={() => agir(l.id, { status: "confirmado" })} />
          <Botao rotulo={aberto === l.id ? "Fechar categorias" : "Corrigir categoria"} onPress={() => setAberto(aberto === l.id ? null : l.id)} secundario />
          {aberto === l.id ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {CATEGORIAS.map((c) => (
                <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Categoria ${rotuloCategoria(c)}`} onPress={() => agir(l.id, { categoria: c })} style={{ borderWidth: 1, borderColor: t.borda, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, justifyContent: "center" }}>
                  <Text style={{ color: t.texto, fontSize: 14 }}>{rotuloCategoria(c)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Botao rotulo="Excluir lancamento" onPress={() => agir(l.id, { status: "cancelado" })} secundario />
        </Cartao>
      ))}
    </ScrollView>
  );
}
