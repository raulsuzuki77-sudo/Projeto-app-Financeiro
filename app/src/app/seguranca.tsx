import { useCallback, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, View } from "react-native";
import Constants from "expo-constants";
import { useFocusEffect } from "expo-router";
import { Aviso, Botao, Campo, Cartao, Texto } from "../components/ui";
import { useTema } from "../components/tema";
import { exportarBackup, restaurarBackup } from "../lib/backup";
import { apagarDadosDoNavegador, dadosNoNavegador } from "../data/banco";
import { bloqueioAtivo, definirBloqueio } from "../lib/seguranca";

export default function Seguranca() {
  const t = useTema();
  const [bloqueio, setBloqueio] = useState(false);
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [msg, setMsg] = useState<{ tipo: "erro" | "info"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useFocusEffect(useCallback(() => void bloqueioAtivo().then(setBloqueio), []));
  const erro = (e: unknown) => setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : "Falha inesperada." });

  async function alternar(v: boolean) {
    const r = await definirBloqueio(v);
    if (!r.ok) return setMsg({ tipo: "erro", texto: r.motivo ?? "Não foi possível alterar." });
    setBloqueio(v);
    setMsg(null);
  }

  async function exportar() {
    if (senha !== senha2) return setMsg({ tipo: "erro", texto: "As senhas não coincidem." });
    setOcupado(true);
    try {
      await exportarBackup(senha);
      setSenha("");
      setSenha2("");
      setMsg({ tipo: "info", texto: "Backup gerado. Guarde a senha em local seguro: sem ela o arquivo não pode ser aberto." });
    } catch (e) {
      erro(e);
    } finally {
      setOcupado(false);
    }
  }

  function restaurar() {
    const executar = async () => {
      setOcupado(true);
      try {
        const n = await restaurarBackup(senha);
        setMsg(n === null ? null : { tipo: "info", texto: `Backup restaurado (${n} registros).` });
        setSenha("");
      } catch (e) {
        erro(e);
      } finally {
        setOcupado(false);
      }
    };
    if (Platform.OS === "web") return void executar();
    Alert.alert("Restaurar backup", "Todos os dados atuais deste aparelho serão SUBSTITUÍDOS pelos do backup. Deseja continuar?", [{ text: "Cancelar", style: "cancel" }, { text: "Substituir", style: "destructive", onPress: executar }]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
        {Platform.OS === "web" && dadosNoNavegador() ? (
          <Cartao titulo="Dados neste navegador">
            <Texto suave pequeno>Versão para computador: os dados ficam gravados apenas neste navegador, neste endereço, e não são enviados a nenhum servidor. Limpar os dados do site no navegador também os apaga: exporte um backup antes. Um backup exportado aqui pode ser restaurado no aplicativo do iPhone, e vice-versa.</Texto>
            <Botao rotulo="Apagar todos os dados deste navegador" perigo pequeno onPress={() => { if (window.confirm("Apagar TODOS os dados guardados neste navegador? Esta ação não pode ser desfeita.")) void apagarDadosDoNavegador(); }} />
          </Cartao>
        ) : null}
        <Cartao titulo="Segurança">
          {Platform.OS !== "web" ? <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Texto forte>Bloquear com Face ID</Texto>
              <Texto suave pequeno>Pede Face ID, Touch ID ou o código do aparelho ao abrir e ao voltar após 30 segundos.</Texto>
            </View>
            <Switch accessibilityLabel="Bloquear com Face ID" value={bloqueio} onValueChange={alternar} />
          </View> : null}
          <Texto suave pequeno>Seus dados ficam apenas neste aparelho, no banco do aplicativo. Nada é enviado a servidores.</Texto>
        </Cartao>
        <Cartao titulo="Sobre esta versão">
          <Texto suave pequeno>{`Versão ${Constants.expoConfig?.version ?? "?"}, código ${String((Constants.expoConfig?.extra as { build?: string } | undefined)?.build ?? "não informado")}. Confira que o código é o mesmo mostrado pelo Terminal (git log -1 --oneline) ao instalar.`}</Texto>
        </Cartao>
        <Cartao titulo="Backup cifrado">
          <Texto suave pequeno>Como os dados existem só neste aparelho, faça backups com frequência e guarde o arquivo no iCloud Drive ou em outro lugar seguro. O arquivo é cifrado (AES-256) com a senha abaixo; se perder a senha, não há como recuperar.</Texto>
          <Campo rotulo="Senha do backup (mínimo 10 caracteres)" value={senha} onChangeText={setSenha} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <Campo rotulo="Repita a senha (só para exportar)" value={senha2} onChangeText={setSenha2} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <Botao rotulo="Exportar backup" icone="importar" onPress={exportar} carregando={ocupado} desabilitado={senha.length < 10} />
          <Botao rotulo="Restaurar de um arquivo" onPress={restaurar} desabilitado={ocupado || senha.length < 10} secundario />
          <Texto suave pequeno>Exportar e restaurar usam a mesma senha. A cifragem pode levar alguns segundos.</Texto>
        </Cartao>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
