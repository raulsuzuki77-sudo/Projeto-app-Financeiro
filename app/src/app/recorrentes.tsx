import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { rotuloCategoria } from "../../../core/src/index";
import { SeletorCategoria } from "../components/seletor-categoria";
import { useTema } from "../components/tema";
import { useToast } from "../components/toast";
import { Aviso, Botao, Campo, Cartao, Chip, GrupoChips, Segmentado, Texto } from "../components/ui";
import { useBotaoAtualizar, useDados } from "../hooks/useDados";
import { api } from "../lib/api";
import { formatarBRL, mesAtual, reaisParaCentavos } from "../lib/format";

type Tipo = "despesa" | "receita" | "investimento";
const NOME_TIPO: Record<Tipo, string> = { despesa: "Saída", receita: "Entrada", investimento: "Investimento" };

export default function Recorrentes() {
  const t = useTema();
  const toast = useToast();
  const { dados, erro, carregando, recarregar } = useDados(() => api.recorrencias());
  useBotaoAtualizar(recarregar);

  const [tipo, setTipo] = useState<Tipo>("despesa");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [dia, setDia] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [aPartirDe, setAPartirDe] = useState<"este" | "proximo">("proximo");
  const [seletor, setSeletor] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
      const n = await api.gerarRecorrencias();
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

        <Cartao titulo="Nova recorrência">
          <Segmentado rotulo="Tipo" valor={tipo} onChange={setTipo} opcoes={[{ id: "despesa", rotulo: "Saída" }, { id: "receita", rotulo: "Entrada" }, { id: "investimento", rotulo: "Investimento" }]} />
          <Campo rotulo="Detalhamento" value={descricao} onChangeText={setDescricao} placeholder="Ex.: aluguel, Netflix, salário" />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 2 }}><Campo rotulo="Valor mensal" prefixo="R$" value={valor} onChangeText={setValor} keyboardType="decimal-pad" placeholder="0,00" /></View>
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
          {msg ? <Aviso tipo="erro">{msg}</Aviso> : null}
          <Botao rotulo="Criar recorrência" onPress={criar} />
        </Cartao>
      </ScrollView>
      <SeletorCategoria visivel={seletor} selecionada={categoria} onEscolher={(c) => { setCategoria(c); setSeletor(false); }} onFechar={() => setSeletor(false)} />
    </KeyboardAvoidingView>
  );
}
