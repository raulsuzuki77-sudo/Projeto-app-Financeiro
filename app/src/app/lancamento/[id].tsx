import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { rotuloCategoria } from "../../../../core/src/index";
import { SeletorCategoria } from "../../components/seletor-categoria";
import { SeletorEvento } from "../../components/seletor-evento";
import { useTema } from "../../components/tema";
import { useToast } from "../../components/toast";
import { Aviso, Botao, Campo, CampoValor, Cartao, Chip, GrupoChips, Segmentado, Texto } from "../../components/ui";
import { useDados } from "../../hooks/useDados";
import { api } from "../../lib/api";
import { dataBR, dataParaISO, formatarBRL, mascaraDeCentavos, reaisParaCentavos } from "../../lib/format";

type Tipo = "despesa" | "receita" | "investimento" | "transferencia";
type Forma = "pix" | "debito" | "credito" | "dinheiro" | "boleto" | "outro";
const FORMAS: { id: Forma; rotulo: string }[] = [{ id: "pix", rotulo: "Pix" }, { id: "debito", rotulo: "Débito" }, { id: "credito", rotulo: "Crédito" }, { id: "dinheiro", rotulo: "Dinheiro" }, { id: "boleto", rotulo: "Boleto" }];

export default function EditarLancamento() {
  const t = useTema();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const numero = Number(id);

  const { dados, erro } = useDados(async () => ({ l: await api.lancamento(numero), cartoes: await api.cartoes(), eventos: await api.eventos() }), [numero]);
  const l = dados?.l;
  const eventoOriginal = (l as (typeof l & { evento_id?: number | null }) | undefined)?.evento_id ?? null;

  const [tipo, setTipo] = useState<Tipo>("despesa");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [forma, setForma] = useState<Forma | null>(null);
  const [cartaoId, setCartaoId] = useState<number | null>(null);
  const [categoria, setCategoria] = useState("nao_classificado");
  const [eventoId, setEventoId] = useState<number | null>(null);
  const [seletor, setSeletor] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!l) return;
    setTipo(l.tipo as Tipo);
    setValor(mascaraDeCentavos(l.valor_centavos));
    setDescricao(l.descricao);
    setData(dataBR(l.data_local));
    setHora(l.hora_local === null ? "" : String(l.hora_local));
    setForma(l.forma_pagamento as Forma | null);
    setCartaoId(l.cartao_id);
    setCategoria(l.categoria);
    setEventoId(eventoOriginal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l]);

  async function salvar() {
    setMsg(null);
    const centavos = reaisParaCentavos(valor);
    if (centavos === null || centavos <= 0) return setMsg("Informe um valor válido, por exemplo 42,90.");
    const iso = dataParaISO(data, new Date().getFullYear());
    if (!iso) return setMsg("Data inválida. Use dd/mm/aaaa.");
    const h = hora.trim() === "" ? null : Number(hora);
    if (h !== null && (!Number.isInteger(h) || h < 0 || h > 23)) return setMsg("A hora deve ser um número de 0 a 23, ou ficar em branco.");
    setSalvando(true);
    try {
      await api.editar(numero, { tipo, valor_centavos: centavos, descricao, data_local: iso, hora_local: h, forma_pagamento: forma, cartao_id: cartaoId, categoria });
      if (eventoId !== eventoOriginal) await api.definirEventoDoLancamento(numero, eventoId);
      toast({ texto: "Alterações salvas." });
      router.back();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  /** Abre o cadastro de evento já com o início na data deste gasto (a que está no campo, se válida). */
  function novoEvento() {
    router.push(`/eventos?novo=1&inicio=${dataParaISO(data, new Date().getFullYear()) ?? l?.data_local}`);
  }

  async function excluir() {
    const feito = async () => {
      await api.excluir(numero);
      toast({ texto: `Excluído: ${descricao}`, acao: { rotulo: "Desfazer", fazer: async () => void (await api.restaurar(numero)) } });
      router.back();
    };
    if (Platform.OS === "web") return feito();
    Alert.alert("Excluir lançamento", `${descricao}, ${formatarBRL(l?.valor_centavos ?? 0)}?`, [{ text: "Cancelar", style: "cancel" }, { text: "Excluir", style: "destructive", onPress: feito }]);
  }

  if (erro) return <View style={{ padding: 16 }}><Aviso tipo="erro">{erro}</Aviso></View>;
  if (dados && !l) return <View style={{ padding: 16 }}><Aviso tipo="erro">Lançamento não encontrado.</Aviso></View>;
  if (!l) return null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {l.status === "pendente" ? <Aviso tipo="info">{l.motivo_revisao ?? "Este lançamento aguarda revisão. Ao salvar, ele é confirmado."}</Aviso> : null}
        <Cartao>
          <Segmentado rotulo="Tipo" valor={tipo} onChange={setTipo} opcoes={[{ id: "despesa", rotulo: "Saída" }, { id: "receita", rotulo: "Entrada" }, { id: "investimento", rotulo: "Invest." }, { id: "transferencia", rotulo: "Transf." }]} />
          <CampoValor rotulo="Valor" value={valor} onChangeText={setValor} />
          <Campo rotulo="Detalhamento" value={descricao} onChangeText={setDescricao} />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 2 }}><Campo rotulo="Data (dd/mm/aaaa)" value={data} onChangeText={setData} keyboardType="numbers-and-punctuation" /></View>
            <View style={{ flex: 1 }}><Campo rotulo="Hora (0-23)" value={hora} onChangeText={setHora} keyboardType="number-pad" maxLength={2} placeholder="opcional" /></View>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={{ color: t.suave, fontSize: 13 }}>Categoria</Text>
            <GrupoChips><Chip rotulo={rotuloCategoria(categoria)} ativo onPress={() => setSeletor(true)} /><Chip rotulo="Trocar..." destaque onPress={() => setSeletor(true)} /></GrupoChips>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={{ color: t.suave, fontSize: 13 }}>Forma de pagamento</Text>
            <GrupoChips>{FORMAS.map((f) => <Chip key={f.id} rotulo={f.rotulo} ativo={forma === f.id} onPress={() => setForma(forma === f.id ? null : f.id)} />)}</GrupoChips>
            {dados!.cartoes.length > 0 ? <GrupoChips>{dados!.cartoes.map((c) => <Chip key={c.id} rotulo={c.apelido} ativo={cartaoId === c.id} onPress={() => setCartaoId(cartaoId === c.id ? null : c.id)} />)}</GrupoChips> : null}
          </View>
          {tipo === "despesa" || eventoId !== null ? <SeletorEvento eventos={dados!.eventos} valor={eventoId} onChange={setEventoId} categoria={categoria} onNovo={novoEvento} /> : null}
          {msg ? <Aviso tipo="erro">{msg}</Aviso> : null}
          <Botao rotulo="Salvar alterações" onPress={salvar} carregando={salvando} />
          <Botao rotulo="Excluir lançamento" icone="lixeira" onPress={excluir} perigo />
        </Cartao>
        <Texto suave pequeno>Registrado em {dataBR(l.criado_em.slice(0, 10))}. Todas as alterações ficam registradas no histórico de auditoria do aplicativo.</Texto>
      </ScrollView>
      <SeletorCategoria visivel={seletor} selecionada={categoria} onEscolher={(c) => { setCategoria(c); setSeletor(false); }} onFechar={() => setSeletor(false)} />
    </KeyboardAvoidingView>
  );
}
