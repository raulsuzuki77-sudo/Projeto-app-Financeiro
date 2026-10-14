import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { ROTULO_TIPO_EVENTO, somarDias, TIPOS_EVENTO, type TipoEvento } from "../../../core/src/index";
import { FormularioEvento } from "../components/formulario-evento";
import { Icone } from "../components/icone";
import { useTema } from "../components/tema";
import { useToast } from "../components/toast";
import { Aviso, Botao, Cartao, Texto } from "../components/ui";
import { useBotaoAtualizar, useDados } from "../hooks/useDados";
import { api } from "../lib/api";
import { dataBR, dataParaISO, formatarBRL } from "../lib/format";

interface Preenchimento {
  /** Muda a cada preenchimento, para reiniciar o formulário. */
  n: number;
  nome: string;
  tipo: TipoEvento;
  inicio: string;
  fim: string;
}

const gastos = (n: number) => `${n} ${n === 1 ? "gasto" : "gastos"}`;
const dataIsoValida = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && dataParaISO(dataBR(d), 0) === d;

/** Parâmetros de rota (ISO) viram o preenchimento inicial do formulário; sem início válido, o formulário abre vazio. */
function deParametros(p: { novo?: string; inicio?: string; fim?: string; nome?: string; tipo?: string }, n: number): Preenchimento {
  const inicio = dataIsoValida(p.inicio) ? p.inicio : null;
  const fim = inicio ? (dataIsoValida(p.fim) && p.fim >= inicio ? p.fim : somarDias(inicio, 6)) : null;
  const tipo = (TIPOS_EVENTO as readonly string[]).includes(p.tipo ?? "") ? (p.tipo as TipoEvento) : "ferias";
  return { n, nome: p.nome ?? "", tipo, inicio: inicio ? dataBR(inicio) : "", fim: fim ? dataBR(fim) : "" };
}

export default function Eventos() {
  const t = useTema();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ novo?: string; inicio?: string; fim?: string; nome?: string; tipo?: string }>();
  const { dados, erro, carregando, recarregar } = useDados(async () => ({ eventos: await api.eventos(), sem: await api.viagensSemEvento() }));
  useBotaoAtualizar(recarregar);

  const [preench, setPreench] = useState<Preenchimento>(() => deParametros(params, 0));
  const rolagem = useRef<ScrollView>(null);
  const yFormulario = useRef(0);
  const veioPorParametro = useRef(params.novo === "1" || !!params.inicio);

  // Navegação para esta mesma tela com outros parâmetros (ex.: nova classificação como viagem).
  useEffect(() => {
    if (params.novo === "1" || params.inicio) {
      setPreench((p) => deParametros(params, p.n + 1));
      veioPorParametro.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.novo, params.inicio, params.fim, params.nome, params.tipo]);

  // Com o formulário já preenchido, leva a tela até ele.
  useEffect(() => {
    if (!veioPorParametro.current) return;
    const h = setTimeout(() => rolagem.current?.scrollTo({ y: Math.max(0, yFormulario.current - 8), animated: true }), 350);
    return () => clearTimeout(h);
  }, [preench.n]);

  function informarPeriodo(dataGasto: string) {
    veioPorParametro.current = true;
    setPreench((p) => ({ n: p.n + 1, nome: "", tipo: "ferias", inicio: dataBR(dataGasto), fim: dataBR(somarDias(dataGasto, 6)) }));
  }

  async function criar(e: { nome: string; tipo: TipoEvento; data_inicio: string; data_fim: string }) {
    const r = await api.criarEvento({ ...e, vincular: true });
    veioPorParametro.current = false;
    setPreench((p) => ({ n: p.n + 1, nome: "", tipo: "ferias", inicio: "", fim: "" }));
    await recarregar();
    toast({ texto: r.vinculados > 0 ? `Evento criado. ${r.vinculados} ${r.vinculados === 1 ? "gasto do período foi vinculado" : "gastos do período foram vinculados"} ao evento.` : "Evento criado. Nenhum gasto do período foi vinculado." });
    router.push(`/evento/${r.id}`);
  }

  const eventos = dados?.eventos ?? [];
  const sem = dados?.sem ?? [];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={rolagem} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}>
        <Texto suave>Férias, viagens a serviço e outros períodos especiais. O gasto do período fica no evento e continua na sua categoria (um bar nas férias aparece em Bares e também em Férias).</Texto>
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

        {eventos.map((e) => (
          <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${e.nome}, ${ROTULO_TIPO_EVENTO[e.tipo]}, de ${dataBR(e.data_inicio)} a ${dataBR(e.data_fim)}, total ${formatarBRL(e.total_centavos)}, ${gastos(e.quantidade)}. Abrir detalhes`} onPress={() => router.push(`/evento/${e.id}`)} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
            <Cartao>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.texto, fontSize: 16, fontWeight: "700" }}>{e.nome}</Text>
                  <Text style={{ color: t.suave, fontSize: 13 }}>{ROTULO_TIPO_EVENTO[e.tipo]} · {dataBR(e.data_inicio)} a {dataBR(e.data_fim)}</Text>
                </View>
                <Text style={{ color: t.texto, fontSize: 16, fontWeight: "700" }}>{formatarBRL(e.total_centavos)}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 24 }}>
                <Text style={{ color: t.suave, fontSize: 13 }}>{gastos(e.quantidade)}</Text>
                <Icone nome="seta" cor={t.suave} tamanho={18} />
              </View>
              {e.pendentes > 0 ? <Text style={{ color: t.alerta, fontSize: 13 }}>{e.pendentes === 1 ? "1 gasto deste evento aguarda revisão" : `${e.pendentes} gastos deste evento aguardam revisão`}; a categoria e o valor podem mudar.</Text> : null}
            </Cartao>
          </Pressable>
        ))}
        {dados && eventos.length === 0 ? <Cartao><Texto suave>Nenhum evento cadastrado ainda. Crie o primeiro abaixo.</Texto></Cartao> : null}

        {sem.length > 0 ? (
          <Cartao titulo="Gastos de viagem sem evento">
            <Texto forte>Qual foi o período desta viagem?</Texto>
            <Texto suave pequeno>Informando o período, os gastos desse intervalo são vinculados ao evento e continuam na categoria Viagens e hospedagem.</Texto>
            {sem.map((g, i) => (
              <View key={g.id} style={[{ gap: 8 }, i > 0 && { borderTopWidth: 1, borderTopColor: t.borda, paddingTop: 12 }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.texto, fontSize: 15, fontWeight: "600" }}>{g.descricao}</Text>
                    <Text style={{ color: t.suave, fontSize: 13 }}>{dataBR(g.data_local)}</Text>
                  </View>
                  <Text style={{ color: t.texto, fontSize: 15, fontWeight: "600" }}>{formatarBRL(g.valor_centavos)}</Text>
                </View>
                <View style={{ alignItems: "flex-start" }}>
                  <Botao rotulo="Informar período" pequeno secundario onPress={() => informarPeriodo(g.data_local)} />
                </View>
              </View>
            ))}
          </Cartao>
        ) : null}

        <View onLayout={(ev) => void (yFormulario.current = ev.nativeEvent.layout.y)}>
          <Cartao titulo="Novo evento">
            <FormularioEvento
              key={preench.n}
              inicial={{ nome: preench.nome, tipo: preench.tipo, inicio: preench.inicio, fim: preench.fim }}
              rotuloBotao="Criar evento"
              onEnviar={criar}
              ajuda={<Texto suave pequeno>Ao criar, os gastos do período são vinculados ao evento, exceto contas fixas, assinaturas, parcelas, aportes e transferências. Gastos importados depois dentro do período já entram vinculados. Você ajusta caso a caso. O período vai até 120 dias.</Texto>}
            />
          </Cartao>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
