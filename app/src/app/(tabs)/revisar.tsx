import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Platform, RefreshControl, ScrollView, Text, View } from "react-native";
import { chaveEstabelecimento, rotuloCategoria } from "../../../../core/src/index";
import { SeletorCategoria } from "../../components/seletor-categoria";
import { useTema } from "../../components/tema";
import { useToast } from "../../components/toast";
import { Aviso, Botao, Cartao, Chip, GrupoChips, Texto } from "../../components/ui";
import { useBotaoAtualizar, useDados } from "../../hooks/useDados";
import { api, type Lancamento, type Sugestao } from "../../lib/api";
import { dataBR, formatarBRL } from "../../lib/format";

interface Item {
  l: Lancamento;
  sugestoes: Sugestao[];
  /** Quantos outros pendentes são do mesmo estabelecimento (classificados juntos com um toque). */
  parecidos: number;
}

export default function Revisar() {
  const t = useTema();
  const router = useRouter();
  const toast = useToast();
  const [escolhendo, setEscolhendo] = useState<Lancamento | null>(null);

  const { dados, erro, carregando, recarregar } = useDados(async (): Promise<Item[]> => {
    const pendentes = await api.lancamentos({ status: "pendente", limite: 300 });
    // Estabelecimentos com mais pendentes primeiro: classificar um resolve todos os parecidos.
    const grupo = (l: Lancamento) => `${l.natureza === "estorno" || l.tipo === "despesa" ? "d" : l.tipo}:${chaveEstabelecimento(l.estabelecimento_norm) || l.id}`;
    const tamanho = new Map<string, number>();
    for (const l of pendentes) tamanho.set(grupo(l), (tamanho.get(grupo(l)) ?? 0) + 1);
    const ordenados = [...pendentes].sort((a, b) => (tamanho.get(grupo(b))! - tamanho.get(grupo(a))!) || b.valor_centavos - a.valor_centavos);
    return Promise.all(
      ordenados.map(async (l) => ({
        l,
        parecidos: tamanho.get(grupo(l))! - 1,
        sugestoes: await api.sugestoes(l.descricao, l.natureza === "estorno" ? "despesa" : l.tipo === "receita" ? "receita" : l.tipo === "investimento" ? "investimento" : "despesa", { valor_centavos: l.valor_centavos, data_local: l.data_local }),
      })),
    );
  });
  useBotaoAtualizar(recarregar);

  // Só vale aceitar em bloco quando a primeira sugestão tem lastro (regra ou histórico), não quando é apenas "a mais usada".
  const comSugestao = (dados ?? []).filter((i) => i.sugestoes.length > 0 && i.l.categoria === "nao_classificado" && i.sugestoes[0]!.motivo !== "mais_usada");

  async function classificar(l: Lancamento, categoria: string) {
    const ids = await api.classificarLote(l.id, categoria, true);
    await recarregar();
    toast({ texto: ids.length > 1 ? `${ids.length} itens parecidos classificados como ${rotuloCategoria(categoria)}.` : `Classificado como ${rotuloCategoria(categoria)}.` });
  }

  async function confirmar(l: Lancamento) {
    await api.alterar(l.id, { status: "confirmado" });
    await recarregar();
    toast({ texto: `Confirmado: ${l.descricao}` });
  }

  async function excluir(l: Lancamento) {
    const feito = async () => {
      await api.excluir(l.id);
      await recarregar();
      toast({ texto: `Excluído: ${l.descricao}`, acao: { rotulo: "Desfazer", fazer: async () => { await api.restaurar(l.id); await recarregar(); } } });
    };
    if (Platform.OS === "web") return feito();
    Alert.alert("Excluir lançamento", `${l.descricao}, ${formatarBRL(l.valor_centavos)}?`, [{ text: "Cancelar", style: "cancel" }, { text: "Excluir", style: "destructive", onPress: feito }]);
  }

  async function aceitarTodas() {
    const feito = async () => {
      let n = 0;
      for (const i of comSugestao) {
        const atual = await api.lancamento(i.l.id);
        if (atual?.status === "pendente") {
          await api.classificarLote(i.l.id, i.sugestoes[0]!.categoria, true);
          n++;
        }
      }
      await recarregar();
      toast({ texto: `Sugestões aceitas em ${n} grupo(s) de itens.` });
    };
    if (Platform.OS === "web") return feito();
    Alert.alert("Aceitar sugestões", `Aplicar a primeira sugestão a ${comSugestao.length} item(ns)? Você pode corrigir depois no Extrato.`, [{ text: "Cancelar", style: "cancel" }, { text: "Aceitar", onPress: feito }]);
  }

  const motivoLegivel = (s: Sugestao["motivo"]) => (s === "repetida" ? "mesma transação de mês anterior" : s === "historico" ? "usada antes" : s === "parecido" ? "parecida" : s === "mais_usada" ? "mais usada" : "sugerida");

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}>
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        {dados && dados.length === 0 ? (
          <Cartao>
            <Texto forte>Tudo em dia</Texto>
            <Texto suave>Nenhum lançamento aguarda revisão. Quanto mais você classifica, mais o aplicativo aprende e menos itens chegam aqui.</Texto>
          </Cartao>
        ) : null}
        {dados && dados.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Texto suave>{dados.length} item(ns) para revisar. Toque numa categoria para classificar; itens parecidos são classificados juntos.</Texto>
            {comSugestao.length > 1 ? <Botao rotulo={`Aceitar a sugestão em ${comSugestao.length} itens`} onPress={aceitarTodas} secundario pequeno /> : null}
          </View>
        ) : null}

        {(dados ?? []).map(({ l, sugestoes, parecidos }) => {
          const real = l.categoria !== "nao_classificado";
          return (
            <Cartao key={l.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.texto, fontSize: 16, fontWeight: "700" }}>{l.descricao}</Text>
                  <Text style={{ color: t.suave, fontSize: 13 }}>{dataBR(l.data_local)}{l.hora_local !== null ? ` ${String(l.hora_local).padStart(2, "0")}h` : ""}{real ? ` · ${rotuloCategoria(l.categoria)}` : ""}{parecidos > 0 ? ` · +${parecidos} parecido(s)` : ""}{l.natureza === "estorno" ? " · estorno ou desconto" : ""}</Text>
                </View>
                <Text style={{ color: t.texto, fontSize: 16, fontWeight: "700" }}>{formatarBRL(l.valor_centavos)}</Text>
              </View>
              {l.motivo_revisao ? <Text style={{ color: t.alerta, fontSize: 13 }}>{l.motivo_revisao}</Text> : null}
              <GrupoChips>
                {sugestoes.map((s, i) => <Chip key={s.categoria} rotulo={`${rotuloCategoria(s.categoria)}${i === 0 && s.motivo !== "mais_usada" ? ` (${motivoLegivel(s.motivo)})` : ""}`} destaque={i === 0} onPress={() => classificar(l, s.categoria)} />)}
                <Chip rotulo="Outra..." onPress={() => setEscolhendo(l)} />
              </GrupoChips>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {real ? <Botao rotulo="Confirmar" pequeno onPress={() => confirmar(l)} /> : null}
                <Botao rotulo="Editar" icone="editar" pequeno secundario onPress={() => router.push(`/lancamento/${l.id}`)} />
                <Botao rotulo="Excluir" icone="lixeira" pequeno perigo onPress={() => excluir(l)} />
              </View>
            </Cartao>
          );
        })}
      </ScrollView>
      <SeletorCategoria visivel={!!escolhendo} selecionada={escolhendo?.categoria} onEscolher={(id) => { const l = escolhendo!; setEscolhendo(null); void classificar(l, id); }} onFechar={() => setEscolhendo(null)} />
    </>
  );
}
