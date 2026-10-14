import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useTema } from "../components/tema";
import { useToast } from "../components/toast";
import { Aviso, Botao, Campo, Cartao, Texto } from "../components/ui";
import { useDados } from "../hooks/useDados";
import { api, type Cartao as CartaoLocal } from "../lib/api";
import { apagarSenhaPdf, lerSenhaPdf, salvarSenhaPdf } from "../lib/senha-pdf";

function LinhaCartao({ c, temSenha, aoMudar, aoRemover }: { c: CartaoLocal; temSenha: boolean; aoMudar: () => void; aoRemover: () => void }) {
  const t = useTema();
  const toast = useToast();
  const [senha, setSenha] = useState("");
  return (
    <Cartao>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.texto, fontSize: 16, fontWeight: "700" }}>{c.apelido}</Text>
          <Text style={{ color: t.suave, fontSize: 13 }}>{c.ultimos4 ? `Final ${c.ultimos4}` : "Sem final informado"}</Text>
        </View>
        <Botao rotulo="Remover" icone="lixeira" pequeno perigo onPress={aoRemover} />
      </View>
      <Campo rotulo={temSenha ? "Senha do PDF da fatura (salva neste aparelho)" : "Senha do PDF da fatura (opcional)"} value={senha} onChangeText={setSenha} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder={temSenha ? "••••••••" : "Se o PDF da fatura tiver senha"} />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Botao rotulo="Salvar senha" pequeno secundario desabilitado={!senha} onPress={async () => { await salvarSenhaPdf(c.id, senha); setSenha(""); aoMudar(); toast({ texto: "Senha salva no Chaveiro do iPhone." }); }} />
        {temSenha ? <Botao rotulo="Apagar senha" pequeno perigo onPress={async () => { await apagarSenhaPdf(c.id); aoMudar(); toast({ texto: "Senha apagada." }); }} /> : null}
      </View>
    </Cartao>
  );
}

export default function Cartoes() {
  const t = useTema();
  const [apelido, setApelido] = useState("");
  const [final4, setFinal4] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const { dados, erro, recarregar } = useDados(async () => {
    const cartoes = await api.cartoes();
    const senhas = await Promise.all(cartoes.map(async (c) => [c.id, (await lerSenhaPdf(c.id)) !== null] as const));
    return { cartoes, senhas: new Map(senhas) };
  });

  async function adicionar() {
    try {
      await api.criarCartao({ apelido, ultimos4: final4.trim() || null });
      setApelido("");
      setFinal4("");
      setMsg(null);
      await recarregar();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível adicionar.");
    }
  }

  function remover(c: CartaoLocal) {
    const feito = async () => {
      try {
        await api.removerCartao(c.id);
        await apagarSenhaPdf(c.id);
        await recarregar();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Não foi possível remover.");
      }
    };
    if (Platform.OS === "web") return void feito();
    Alert.alert("Remover cartão", `Remover ${c.apelido}? Só é possível se não houver lançamentos nele.`, [{ text: "Cancelar", style: "cancel" }, { text: "Remover", style: "destructive", onPress: feito }]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Texto suave>Use o apelido nas mensagens ("mercado 50 crédito nomad") e para vincular faturas. Nunca informe o número completo do cartão. A senha do PDF, se houver, fica no Chaveiro do iPhone e nunca entra no backup.</Texto>
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        {msg ? <Aviso tipo="erro">{msg}</Aviso> : null}
        {(dados?.cartoes ?? []).map((c) => <LinhaCartao key={c.id} c={c} temSenha={dados?.senhas.get(c.id) ?? false} aoMudar={recarregar} aoRemover={() => remover(c)} />)}
        <Cartao titulo="Novo cartão">
          <Campo rotulo="Apelido (uma palavra)" value={apelido} onChangeText={setApelido} autoCapitalize="none" placeholder="Ex.: nomad, nubank" />
          <Campo rotulo="Últimos 4 dígitos (opcional)" value={final4} onChangeText={setFinal4} keyboardType="number-pad" maxLength={4} />
          <Botao rotulo="Adicionar cartão" onPress={adicionar} />
        </Cartao>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
