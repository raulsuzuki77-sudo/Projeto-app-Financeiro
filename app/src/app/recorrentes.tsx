import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { rotuloCategoria } from "../../../core/src/index";
import { SeletorCategoria } from "../components/seletor-categoria";
import { useTema } from "../components/tema";
import { useToast } from "../components/toast";
import { Aviso, Botao, Campo, CampoValor, Cartao, Chip, GrupoChips, Segmentado, Texto } from "../components/ui";
import { useBotaoAtualizar, useDados } from "../hooks/useDados";
import { api } from "../lib/api";
import { formatarBRL, mesAtual, nomeMes, reaisParaCentavos } from "../lib/format";

type Tipo = "despesa" | "receita" | "investimento";
const NOME_TIPO: Record<Tipo, string> = { despesa: "Saída", receita: "Entrada", investimento: "Investimento" };

export default function Recorrentes() {
  const t = useTema();
  const toast = useToast();
  const { dados: pacote, erro, carregando, recarregar } = useDados(async () => {
    const lista = await api.recorrencias();
    const [detectadas, coberturas] = await Promise.all([api.recorrentesDetectadas(), Promise.all(lista.map(async (r) => [r.id, await api.coberturaRecorrencia(r.id)] as const))]);
    return { lista, detectadas, coberturas: new Map(coberturas) };
  });
  const dados = pacote?.lista ?? null;
  const detectadas = (pacote?.detectadas ?? []).filter((d) => !d.cadastrada);
  useBotaoAtualizar(recarregar);

  const [tipo, setTipo] = useState<Tipo>("despesa");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [dia, setDia] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [aPartirDe, setAPartirDe] = useState<"este" | "proximo">("proximo");
  const [seletor, setSeletor] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [jaContemplada, setJaContemplada] = useState<{ mes: string; descricao: string; valor_centavos: number }[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

  // Enquanto o usuário preenche, verifica se os lançamentos importados já contemplam este compromisso.
  useEffect(() => {
    const centavos = reaisParaCentavos(valor);
    if (!descricao.trim() || centavos === null || centavos <= 0) return setJaContemplada([]);
    const espera = setTimeout(() => api.coberturaPrevia({ descricao, tipo, valor_centavos: centavos }).then(setJaContemplada, () => setJaContemplada([])), 300);
    return () => clearTimeout(espera);
  }, [descricao, valor, tipo]);

  async function criar() {
    setMsg(null);
    const centavos = reaisParaCentavos(valor);
    const d = Number(dia);
    if (!descricao.trim()) return setMsg("Informe o detalhamento, por exemplo: aluguel, Netflix, salário.");
    if (centavos === null || centavos <= 0) return setMsg("Informe o valor mensal, por exemplo 1800,00.");
    if (!Number.isInteger(d) || d < 1 || d > 31) return setMsg("Informe o dia do mês, de 1 a 31.");
    const mes = mesAtual();
    const [a, m] = mes.split("-").map(Number) as [number, number];
    const proximo = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
    try {
      await api.criarRecorrencia({ tipo, descricao, valor_centavos: centavos, dia_mes: d, categoria: categoria ?? undefined, inicio_mes: aPartirDe === "este" ? mes : proximo });
      const { criados: n, contemplados } = await api.gerarRecorrenciasDetalhado();
      setAviso(contemplados > 0 ? `${contemplados} mês(es) já tinham um lançamento equivalente nos arquivos importados e foram contados uma só vez.` : null);
      setDescricao("");
      setValor("");
      setDia("");
      setCategoria(null);
      await recarregar();
      toast({ texto: n > 0 ? `Recorrência criada e ${n} lançamento(s) gerado(s) para este mês.` : "Recorrência criada. O lançamento será gerado na data." });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível criar.");
    }
  }

  function remover(id: number, nome: string) {
    const feito = async () => {
      await api.removerRecorrencia(id);
      await recarregar();
    };
    if (Platform.OS === "web") return void feito();
    Alert.alert("Remover recorrência", `${nome}: os lançamentos já gerados continuam no extrato. Remover só a regra?`, [{ text: "Cancelar", style: "cancel" }, { text: "Remover", style: "destructive", onPress: feito }]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}>
        <Texto suave>Cadastre o que se repete todo mês. Na data de cada mês o aplicativo registra o lançamento sozinho, já categorizado e confirmado.</Texto>
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

        {(dados ?? []).map((r) => (
          <Cartao key={r.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.texto, fontSize: 16, fontWeight: "700" }}>{r.descricao}</Text>
                <Text style={{ color: t.suave, fontSize: 13 }}>Todo dia {r.dia_mes} · {NOME_TIPO[r.tipo]} · {rotuloCategoria(r.categoria)}</Text>
                {(pacote?.coberturas.get(r.id)?.length ?? 0) > 0 ? <Text style={{ color: t.primaria, fontSize: 12 }}>Já contemplada pelos arquivos importados em {pacote!.coberturas.get(r.id)!.length} mês(es): contada uma só vez.</Text> : null}
              </View>
              <Text style={{ color: t.texto, fontSize: 16, fontWeight: "700" }}>{formatarBRL(r.valor_centavos)}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Switch accessibilityLabel={`Ativar ${r.descricao}`} value={r.ativa === 1} onValueChange={async (v) => { await api.atualizarRecorrencia(r.id, { ativa: v }); await recarregar(); }} />
                <Texto suave pequeno>{r.ativa === 1 ? "Ativa" : "Pausada"}</Texto>
              </View>
              <Botao rotulo="Remover" icone="lixeira" pequeno perigo onPress={() => remover(r.id, r.descricao)} />
            </View>
          </Cartao>
        ))}
        {dados && dados.length === 0 ? <Cartao><Texto suave>Nenhuma recorrência cadastrada ainda.</Texto></Cartao> : null}
        {aviso ? <Aviso tipo="info">{aviso}</Aviso> : null}

        {detectadas.length > 0 ? (
          <Cartao titulo="Repetem-se mês a mês (detectadas)">
            <Texto suave pequeno>Encontradas nos seus lançamentos: mesmo favorecido, valor parecido, em dois ou mais meses. Cadastre para que o próximo mês já apareça previsto; meses que já têm o lançamento equivalente são contados uma só vez.</Texto>
            {detectadas.map((d) => (
              <View key={`${d.tipo}|${d.chave}|${d.valor_centavos}`} style={{ gap: 6, opacity: d.encerrada ? 0.65 : 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }} numberOfLines={2}>{d.descricao}</Text>
                    <Text style={{ color: t.suave, fontSize: 13 }}>{NOME_TIPO[d.tipo]} · {rotuloCategoria(d.categoria)} · dia {d.dia_tipico} · {d.meses.length} meses (último: {nomeMes(d.ultimo_mes)}){d.variavel ? " · valor varia" : ""}{d.encerrada ? " · parece encerrada" : ""}</Text>
                  </View>
                  <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>{formatarBRL(d.valor_centavos)}</Text>
                </View>
                {!d.encerrada ? (
                  <Botao
                    rotulo="Cadastrar como recorrente"
                    pequeno
                    secundario
                    onPress={async () => {
                      try {
                        await api.criarRecorrencia({ tipo: d.tipo, descricao: d.descricao, valor_centavos: d.valor_centavos, dia_mes: d.dia_tipico, categoria: d.categoria === "nao_classificado" ? undefined : d.categoria, inicio_mes: mesAtual() });
                        const g = await api.gerarRecorrenciasDetalhado();
                        await recarregar();
                        toast({ texto: g.contemplados > 0 ? `Cadastrada. ${g.contemplados} mês(es) já estavam nos lançamentos e foram contados uma só vez.` : "Cadastrada." });
                      } catch (e) {
                        setMsg(e instanceof Error ? e.message : "Não foi possível cadastrar.");
                      }
                    }}
                  />
                ) : null}
              </View>
            ))}
          </Cartao>
        ) : null}

        <Cartao titulo="Nova recorrência">
          <Segmentado rotulo="Tipo" valor={tipo} onChange={setTipo} opcoes={[{ id: "despesa", rotulo: "Saída" }, { id: "receita", rotulo: "Entrada" }, { id: "investimento", rotulo: "Investimento" }]} />
          <Campo rotulo="Detalhamento" value={descricao} onChangeText={setDescricao} placeholder="Ex.: aluguel, Netflix, salário" />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 2 }}><CampoValor rotulo="Valor mensal" value={valor} onChangeText={setValor} /></View>
            <View style={{ flex: 1 }}><Campo rotulo="Dia do mês" value={dia} onChangeText={setDia} keyboardType="number-pad" maxLength={2} placeholder="5" /></View>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={{ color: t.suave, fontSize: 13 }}>Categoria{categoria ? "" : " (automática pelo detalhamento)"}</Text>
            <GrupoChips>
              {categoria ? <Chip rotulo={`${rotuloCategoria(categoria)}  ×`} ativo onPress={() => setCategoria(null)} /> : null}
              <Chip rotulo="Escolher..." destaque onPress={() => setSeletor(true)} />
            </GrupoChips>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={{ color: t.suave, fontSize: 13 }}>Começar a registrar</Text>
            <GrupoChips>
              <Chip rotulo="Neste mês" ativo={aPartirDe === "este"} onPress={() => setAPartirDe("este")} />
              <Chip rotulo="No próximo mês" ativo={aPartirDe === "proximo"} onPress={() => setAPartirDe("proximo")} />
            </GrupoChips>
            <Texto suave pequeno>Escolha "No próximo mês" se este mês já foi lançado, para não duplicar. Em meses curtos, o dia 31 vira o último dia do mês.</Texto>
          </View>
          {jaContemplada.length > 0 ? (
            <Aviso tipo="info">{`Já aparece nos lançamentos: ${jaContemplada.map((c) => `${nomeMes(c.mes)} (${c.descricao}, ${formatarBRL(c.valor_centavos)})`).join("; ")}. Esses meses serão contados uma só vez; a recorrência só gera lançamento onde não houver um equivalente.`}</Aviso>
          ) : null}
          {msg ? <Aviso tipo="erro">{msg}</Aviso> : null}
          <Botao rotulo="Criar recorrência" onPress={criar} />
        </Cartao>
      </ScrollView>
      <SeletorCategoria visivel={seletor} selecionada={categoria} onEscolher={(c) => { setCategoria(c); setSeletor(false); }} onFechar={() => setSeletor(false)} />
    </KeyboardAvoidingView>
  );
}
