import { useCallback, useState } from "react";
import { Alert, ScrollView, Switch, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Aviso, Botao, Campo, Cartao, Texto } from "../components/ui";
import { useTema } from "../components/tema";
import { api, type Cartao as CartaoLocal } from "../lib/api";
import { exportarBackup, restaurarBackup } from "../lib/backup";
import { bloqueioAtivo, definirBloqueio } from "../lib/seguranca";

export default function Ajustes() {
  const t = useTema();
  const [cartoes, setCartoes] = useState<CartaoLocal[]>([]);
  const [apelido, setApelido] = useState("");
  const [final4, setFinal4] = useState("");
  const [bloqueio, setBloqueio] = useState(false);
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [msg, setMsg] = useState<{ tipo: "erro" | "info"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCartoes(await api.cartoes());
    setBloqueio(await bloqueioAtivo());
  }, []);
  useFocusEffect(useCallback(() => void carregar(), [carregar]));

  const erro = (e: unknown) => setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : "Falha inesperada." });

  async function addCartao() {
    try {
      await api.criarCartao({ apelido, ultimos4: final4.trim() || null });
      setApelido("");
      setFinal4("");
      setMsg(null);
      await carregar();
    } catch (e) {
      erro(e);
    }
  }

  async function removerCartao(id: number) {
    try {
      await api.removerCartao(id);
      await carregar();
    } catch (e) {
      erro(e);
    }
  }

  async function alternarBloqueio(v: boolean) {
    const r = await definirBloqueio(v);
    if (!r.ok) return setMsg({ tipo: "erro", texto: r.motivo ?? "Nao foi possivel alterar." });
    setBloqueio(v);
    setMsg(null);
  }

  async function exportar() {
    if (senha !== senha2) return setMsg({ tipo: "erro", texto: "As senhas nao coincidem." });
    setOcupado(true);
    try {
      await exportarBackup(senha);
      setSenha("");
      setSenha2("");
      setMsg({ tipo: "info", texto: "Backup gerado. Guarde a senha em local seguro: sem ela o arquivo nao pode ser aberto." });
    } catch (e) {
      erro(e);
    } finally {
      setOcupado(false);
    }
  }

  function restaurar() {
    Alert.alert("Restaurar backup", "Todos os dados atuais deste aparelho serao SUBSTITUIDOS pelos do backup. Deseja continuar?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Substituir",
        style: "destructive",
        onPress: async () => {
          setOcupado(true);
          try {
            const n = await restaurarBackup(senha);
            setMsg(n === null ? null : { tipo: "info", texto: `Backup restaurado (${n} registros).` });
            setSenha("");
            await carregar();
          } catch (e) {
            erro(e);
          } finally {
            setOcupado(false);
          }
        },
      },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: t.fundo }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}

      <Cartao titulo="Cartoes">
        <Texto suave>Cadastre um apelido de uma palavra (ex.: nomad). Use-o nas mensagens: "mercado 50 credito nomad". Nunca informe o numero completo do cartao.</Texto>
        {cartoes.map((c) => (
          <View key={c.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Texto forte>{c.apelido}{c.ultimos4 ? ` (final ${c.ultimos4})` : ""}</Texto>
            <View style={{ width: 110 }}><Botao rotulo="Remover" onPress={() => removerCartao(c.id)} secundario /></View>
          </View>
        ))}
        <Campo rotulo="Apelido do cartao" value={apelido} onChangeText={setApelido} autoCapitalize="none" />
        <Campo rotulo="Ultimos 4 digitos (opcional)" value={final4} onChangeText={setFinal4} keyboardType="number-pad" maxLength={4} />
        <Botao rotulo="Adicionar cartao" onPress={addCartao} />
      </Cartao>

      <Cartao titulo="Seguranca">
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Texto forte>Bloquear com Face ID</Texto>
            <Texto suave>Pede Face ID, Touch ID ou o codigo do aparelho ao abrir e ao voltar apos 30 segundos.</Texto>
          </View>
          <Switch accessibilityLabel="Bloquear com Face ID" value={bloqueio} onValueChange={alternarBloqueio} />
        </View>
        <Texto suave>Seus dados ficam apenas neste iPhone, no banco do aplicativo. Nada e enviado a servidores.</Texto>
      </Cartao>

      <Cartao titulo="Backup cifrado">
        <Texto suave>Como os dados existem so neste aparelho, faca backups com frequencia e guarde o arquivo no iCloud Drive ou em outro lugar seguro. O arquivo e cifrado (AES-256) com a senha abaixo; se perder a senha, nao ha como recuperar.</Texto>
        <Campo rotulo="Senha do backup (minimo 10 caracteres)" value={senha} onChangeText={setSenha} secureTextEntry autoCapitalize="none" autoCorrect={false} />
        <Campo rotulo="Repita a senha (so para exportar)" value={senha2} onChangeText={setSenha2} secureTextEntry autoCapitalize="none" autoCorrect={false} />
        <Botao rotulo="Exportar backup" onPress={exportar} carregando={ocupado} desabilitado={senha.length < 10} />
        <Botao rotulo="Restaurar de um arquivo" onPress={restaurar} desabilitado={ocupado || senha.length < 10} secundario />
        <Texto suave>Exportar e restaurar usam a mesma senha. A cifragem pode levar alguns segundos.</Texto>
      </Cartao>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
