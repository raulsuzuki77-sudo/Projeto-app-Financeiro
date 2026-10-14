import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, FlatList, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { chaveEstabelecimento, rotuloCategoria, rotuloCompleto } from "../../../../core/src/index";
import { SeletorCategoria } from "../../components/seletor-categoria";
import { SeletorMes } from "../../components/seletor-mes";
import { useTema } from "../../components/tema";
import { useToast } from "../../components/toast";
import { Aviso, Botao, BotaoIcone, Campo, Chip, GrupoChips, Texto } from "../../components/ui";
import { useBotaoAtualizar, useDados } from "../../hooks/useDados";
import { api, type Lancamento } from "../../lib/api";
import { confirmar } from "../../lib/confirmar";
import { dataBR, formatarBRL, mesAtual } from "../../lib/format";

type Filtro = "todos" | "despesa" | "receita";
type Ordem = "data_desc" | "data_asc" | "valor_desc" | "valor_asc";
const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: "data_desc", rotulo: "Mais recentes" },
  { id: "data_asc", rotulo: "Mais antigos" },
  { id: "valor_desc", rotulo: "Maior valor" },
  { id: "valor_asc", rotulo: "Menor valor" },
];

export default function Extrato() {
  const t = useTema();
  const router = useRouter();
  const toast = useToast();
  const [mes, setMes] = useState(mesAtual());
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("data_desc");
  const [evento, setEvento] = useState<number | "nenhum" | null>(null);
  const [semCategoria, setSemCategoria] = useState(false);
  const [opcoes, setOpcoes] = useState(false);
  /** Seleção múltipla: ações em lote (excluir, classificar, evento) sobre os lançamentos marcados. */
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [selecionando, setSelecionando] = useState(false);
  const [escolhendoCategoria, setEscolhendoCategoria] = useState(false);
  const [escolhendoEvento, setEscolhendoEvento] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const modoSel = selecionando || sel.size > 0;

  const { dados: pacote, erro, carregando, recarregar } = useDados(async () => {
    const [lancamentos, recorrentes, eventos] = await Promise.all([api.lancamentos({ mes: typeof evento === "number" ? undefined : mes, tipo: filtro === "todos" ? undefined : filtro, busca, ordem, evento: evento ?? undefined, categoria: semCategoria ? "nao_classificado" : undefined, limite: 800 }), api.recorrentesDetectadas(), api.eventos()]);
    return { lancamentos, recorrentes: new Set(recorrentes.filter((r) => !r.encerrada).map((r) => `${r.tipo}|${r.chave}`)), eventos: new Map(eventos.map((e) => [e.id, e.nome])) };
  }, [mes, filtro, busca, ordem, evento, semCategoria]);
  const dados = pacote?.lancamentos ?? null;
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

  const alterna = (id: number) => setSel((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sair = () => { setSel(new Set()); setSelecionando(false); };
  const ids = [...sel];
  const somaSel = (dados ?? []).filter((l) => sel.has(l.id) && l.tipo === "despesa").reduce((s, l) => s + l.valor_centavos, 0);

  async function lote(fazer: () => Promise<string | { texto: string; desfazer?: () => Promise<void> }>) {
    setOcupado(true);
    try {
      const r = await fazer();
      sair();
      await recarregar();
      const texto = typeof r === "string" ? r : r.texto;
      toast({ texto, acao: typeof r === "string" || !r.desfazer ? undefined : { rotulo: "Desfazer", fazer: async () => { await r.desfazer!(); await recarregar(); } } });
    } catch (e) {
      toast({ texto: e instanceof Error ? e.message : "Não foi possível concluir a ação." });
    } finally {
      setOcupado(false);
    }
  }
  async function excluirSel() {
    if (!(await confirmar("Excluir lançamentos", `${ids.length} lançamento(s) selecionado(s) serão excluídos. Você pode desfazer logo em seguida.`, "Excluir"))) return;
    await lote(async () => {
      const feitos = await api.excluirVarios(ids);
      return { texto: `${feitos.length} lançamento(s) excluído(s).`, desfazer: async () => void (await api.restaurarVarios(feitos)) };
    });
  }
  async function classificarSel(categoria: string) {
    setEscolhendoCategoria(false);
    if (!(await confirmar("Classificar em lote", `${ids.length} lançamento(s) serão classificados como ${rotuloCategoria(categoria)}. O aplicativo também aprende essa categoria para cada estabelecimento selecionado.`, "Classificar", false))) return;
    await lote(async () => `${await api.classificarVarios(ids, categoria)} lançamento(s) classificado(s) como ${rotuloCategoria(categoria)}.`);
  }
  async function eventoSel(eventoId: number | null) {
    setEscolhendoEvento(false);
    await lote(async () => {
      const n = await api.definirEventoVarios(ids, eventoId);
      return eventoId === null ? `${n} lançamento(s) retirado(s) do evento.` : `${n} lançamento(s) vinculado(s) ao evento ${pacote?.eventos.get(eventoId) ?? ""}. Só despesas podem ser vinculadas.`;
    });
  }
  async function confirmarSel() {
    await lote(async () => {
      const n = await api.confirmarVarios(ids);
      return n === ids.length ? `${n} lançamento(s) confirmado(s).` : `${n} confirmado(s); os demais não estavam pendentes ou estão sem categoria.`;
    });
  }

  const barraSelecao = modoSel ? (
    <View style={{ gap: 8, padding: 12, backgroundColor: t.suave2, borderBottomWidth: 1, borderBottomColor: t.borda }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Texto forte>{sel.size} selecionado(s){somaSel ? ` · saídas ${formatarBRL(somaSel)}` : ""}</Texto>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip rotulo={`Todos (${(dados ?? []).length})`} onPress={() => setSel(new Set((dados ?? []).map((l) => l.id)))} />
          <Chip rotulo="Sair" onPress={sair} />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Botao rotulo="Categoria" pequeno onPress={() => setEscolhendoCategoria(true)} desabilitado={sel.size === 0 || ocupado} />
        <Botao rotulo="Evento" pequeno secundario onPress={() => setEscolhendoEvento(true)} desabilitado={sel.size === 0 || ocupado} />
        <Botao rotulo="Confirmar" pequeno secundario onPress={confirmarSel} desabilitado={sel.size === 0 || ocupado} />
        <Botao rotulo="Excluir" pequeno perigo onPress={excluirSel} desabilitado={sel.size === 0 || ocupado} />
      </ScrollView>
      {sel.size === 0 ? <Texto suave pequeno>Toque nos lançamentos para marcar. Segurar um lançamento também o marca.</Texto> : null}
    </View>
  ) : null;

  const cabecalho = (
    <View style={{ gap: 12, padding: 16, paddingBottom: 8 }}>
      <SeletorMes mes={mes} onChange={setMes} />
      <Campo rotulo="Buscar" value={busca} onChangeText={setBusca} placeholder="Descrição do lançamento" autoCorrect={false} returnKeyType="search" />
      <GrupoChips>
        <Chip rotulo="Tudo" ativo={filtro === "todos"} onPress={() => setFiltro("todos")} />
        <Chip rotulo="Saídas" ativo={filtro === "despesa"} onPress={() => setFiltro("despesa")} />
        <Chip rotulo="Entradas" ativo={filtro === "receita"} onPress={() => setFiltro("receita")} />
        <Chip rotulo="Sem categoria" ativo={semCategoria} onPress={() => setSemCategoria(!semCategoria)} />
        <Chip rotulo={modoSel ? "Selecionando" : "Selecionar vários"} ativo={modoSel} destaque={!modoSel} onPress={() => (modoSel ? sair() : setSelecionando(true))} />
      </GrupoChips>
      <View style={{ gap: 8 }}>
        <Chip rotulo={opcoes ? "Ocultar ordenação e filtros" : `Ordenar e filtrar${ordem !== "data_desc" || evento !== null ? " (ativos)" : ""}`} ativo={ordem !== "data_desc" || evento !== null} onPress={() => setOpcoes(!opcoes)} />
        {opcoes ? (
          <View style={{ gap: 10 }}>
            <Texto suave pequeno>Ordenar por</Texto>
            <GrupoChips>{ORDENS.map((o) => <Chip key={o.id} rotulo={o.rotulo} ativo={ordem === o.id} onPress={() => setOrdem(o.id)} />)}</GrupoChips>
            <Texto suave pequeno>Evento (viagem, férias){typeof evento === "number" ? ": mostrando o evento inteiro, de todos os meses" : ""}</Texto>
            <GrupoChips>
              <Chip rotulo="Todos" ativo={evento === null} onPress={() => setEvento(null)} />
              <Chip rotulo="Sem evento" ativo={evento === "nenhum"} onPress={() => setEvento("nenhum")} />
              {[...(pacote?.eventos.entries() ?? [])].map(([id, nome]) => <Chip key={id} rotulo={nome} ativo={evento === id} onPress={() => setEvento(id)} />)}
            </GrupoChips>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Texto suave pequeno>Saídas: {formatarBRL(totais.saidas)}</Texto>
        <Texto suave pequeno>Entradas: {formatarBRL(totais.entradas)}</Texto>
      </View>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {barraSelecao}
      <FlatList
        data={dados ?? []}
        extraData={sel}
        keyExtractor={(l) => String(l.id)}
        ListHeaderComponent={cabecalho}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={dados ? <View style={{ padding: 24 }}><Texto suave>Nenhum lançamento neste período.</Texto></View> : null}
        renderItem={({ item: l }) => {
          const marcado = sel.has(l.id);
          return (
            <View style={{ flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: t.borda, backgroundColor: marcado ? t.suave2 : t.cartao }}>
              {modoSel ? (
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: marcado }} accessibilityLabel={`Selecionar ${l.descricao}`} onPress={() => alterna(l.id)} style={{ paddingLeft: 16, paddingRight: 4, minHeight: 56, justifyContent: "center" }}>
                  <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: marcado ? t.primaria : t.suave, backgroundColor: marcado ? t.primaria : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {marcado ? <Text style={{ color: t.sobrePrimaria, fontSize: 14, fontWeight: "800" }}>✓</Text> : null}
                  </View>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel={modoSel ? `Selecionar ${l.descricao}, ${formatarBRL(l.valor_centavos)}` : `Editar ${l.descricao}, ${formatarBRL(l.valor_centavos)}`} onPress={() => (modoSel ? alterna(l.id) : router.push(`/lancamento/${l.id}`))} onLongPress={() => alterna(l.id)} style={({ pressed }) => ({ flex: 1, paddingVertical: 12, paddingLeft: modoSel ? 10 : 16, gap: 2, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ color: t.texto, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>{l.descricao}</Text>
                <Text style={{ color: t.suave, fontSize: 13 }} numberOfLines={1}>
                  {dataBR(l.data_local)}{l.hora_local !== null ? ` · ${String(l.hora_local).padStart(2, "0")}h` : ""}
                </Text>
                <Text style={{ color: l.status === "pendente" ? t.alerta : t.suave, fontSize: 13 }} numberOfLines={1}>
                  {rotuloCompleto(l.categoria)}{l.parcela_total ? ` · parcela ${l.parcela_atual ?? "?"}/${l.parcela_total}` : ""}{(l as { prevista?: number }).prevista ? " (prevista)" : ""}{l.status === "pendente" ? " (pendente)" : ""}
                </Text>
                {pacote?.recorrentes.has(`${l.tipo}|${chaveEstabelecimento(l.estabelecimento_norm)}`) || pacote?.eventos.has(l.evento_id ?? -1) ? (
                  <Text style={{ color: t.primaria, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>
                    {pacote?.recorrentes.has(`${l.tipo}|${chaveEstabelecimento(l.estabelecimento_norm)}`) ? "Recorrente" : ""}
                    {pacote?.recorrentes.has(`${l.tipo}|${chaveEstabelecimento(l.estabelecimento_norm)}`) && pacote?.eventos.has(l.evento_id ?? -1) ? " · " : ""}
                    {pacote?.eventos.has(l.evento_id ?? -1) ? `Evento: ${pacote.eventos.get(l.evento_id!)}` : ""}
                  </Text>
                ) : null}
              </Pressable>
              <Text style={{ color: l.tipo === "receita" ? t.receita : l.tipo === "despesa" ? t.texto : t.suave, fontSize: 16, fontWeight: "700", paddingHorizontal: 8 }}>
                {l.tipo === "receita" ? "+" : l.tipo === "despesa" ? "−" : ""}{formatarBRL(l.valor_centavos)}
              </Text>
              {modoSel ? <View style={{ width: 12 }} /> : <BotaoIcone icone="lixeira" rotulo={`Excluir ${l.descricao}`} onPress={() => excluir(l)} cor={t.suave} />}
            </View>
          );
        }}
      />
      <SeletorCategoria visivel={escolhendoCategoria} onEscolher={(id) => void classificarSel(id)} onFechar={() => setEscolhendoCategoria(false)} />
      <Modal visible={escolhendoEvento} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEscolhendoEvento(false)}>
        <View style={{ flex: 1, backgroundColor: t.fundo, padding: 16, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 20, fontWeight: "700", flex: 1 }}>Evento dos {sel.size} lançamento(s)</Text>
            <BotaoIcone icone="fechar" rotulo="Fechar" onPress={() => setEscolhendoEvento(false)} />
          </View>
          <Texto suave pequeno>O gasto passa a contar no evento e continua na categoria. Só despesas podem ser vinculadas a um evento.</Texto>
          <ScrollView contentContainerStyle={{ gap: 8 }}>
            {[...(pacote?.eventos.entries() ?? [])].map(([id, nome]) => <Botao key={id} rotulo={nome} secundario onPress={() => void eventoSel(id)} />)}
            {(pacote?.eventos.size ?? 0) === 0 ? <Texto suave>Nenhum evento cadastrado. Crie um em Mais opções, Viagens e eventos.</Texto> : null}
            <Botao rotulo="Retirar dos eventos" perigo onPress={() => void eventoSel(null)} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
