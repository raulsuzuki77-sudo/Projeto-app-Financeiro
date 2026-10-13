import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Aviso, Botao, Campo, Cartao, Texto } from "../components/ui";
import { useTema } from "../components/tema";
import { api, type Cartao as CartaoLocal } from "../lib/api";
import { importarArquivo, type TipoImportacao } from "../lib/importar";

interface Entrada {
  id: number;
  quem: "voce" | "sistema";
  texto: string;
}

export default function Lancar() {
  const t = useTema();
  const [texto, setTexto] = useState("");
  const [historico, setHistorico] = useState<Entrada[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cartoes, setCartoes] = useState<CartaoLocal[]>([]);
  const [cartaoId, setCartaoId] = useState<number | null>(null);
  const seq = useRef(0);

  useFocusEffect(useCallback(() => void api.cartoes().then(setCartoes), []));

  const add = (quem: Entrada["quem"], msg: string) => setHistorico((h) => [{ id: ++seq.current, quem, texto: msg }, ...h].slice(0, 30));

  async function enviar() {
    const msg = texto.trim();
    if (!msg) return;
    setErro(null);
    try {
      add("voce", msg);
      const r = await api.enviarMensagem(msg);
      add("sistema", r.resposta || "Mensagem ja processada.");
      setTexto("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao registrar.");
    }
  }

  async function processar(uri: string, nome: string, tipo: TipoImportacao) {
    setOcupado(true);
    setErro(null);
    try {
      add("voce", `Enviado: ${nome}`);
      add("sistema", await importarArquivo({ uri, nome }, tipo, cartaoId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao importar.");
    } finally {
      setOcupado(false);
    }
  }

  async function fotografar() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setErro("Permissao da camera negada. Habilite em Ajustes do iPhone.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.9 });
    const a = r.canceled ? null : r.assets[0];
    if (a) await processar(a.uri, "foto-comprovante.jpg", "comprovante");
  }

  async function escolherFoto() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.9 });
    const a = r.canceled ? null : r.assets[0];
    if (a) await processar(a.uri, a.fileName ?? "foto.jpg", "comprovante");
  }

  async function escolherFatura() {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*", "text/plain"], copyToCacheDirectory: true });
    const a = r.canceled ? null : r.assets[0];
    if (a) await processar(a.uri, a.name, "fatura");
  }

  async function escolherExtrato() {
    const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    const a = r.canceled ? null : r.assets[0];
    if (a) await processar(a.uri, a.name, "extrato");
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.fundo }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Cartao titulo="Novo gasto">
          <Campo rotulo="Descreva a compra" value={texto} onChangeText={setTexto} placeholder="mercado 187,40 credito nomad" autoCapitalize="none" returnKeyType="send" onSubmitEditing={enviar} />
          <Botao rotulo="Registrar" onPress={enviar} desabilitado={!texto.trim()} />
          <Texto suave>Exemplos: "almoco 42,90 debito ontem 13h", "notebook 3000 em 10x nomad", "recebi 5000 salario". Cadastre seus cartoes em Ajustes.</Texto>
        </Cartao>

        <Cartao titulo="Importar documentos">
          <Texto suave>Cartao da fatura ou do comprovante:</Texto>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[{ id: null as number | null, apelido: "Nenhum" }, ...cartoes].map((c) => (
              <Pressable key={String(c.id)} accessibilityRole="button" accessibilityState={{ selected: cartaoId === c.id }} onPress={() => setCartaoId(c.id)} style={{ borderWidth: 1, borderColor: cartaoId === c.id ? t.primaria : t.borda, borderRadius: 16, minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}>
                <Text style={{ color: cartaoId === c.id ? t.primaria : t.texto, fontWeight: cartaoId === c.id ? "700" : "400" }}>{c.apelido}</Text>
              </Pressable>
            ))}
          </View>
          <Botao rotulo="Fotografar comprovante" onPress={fotografar} desabilitado={ocupado} secundario />
          <Botao rotulo="Escolher foto da galeria" onPress={escolherFoto} desabilitado={ocupado} secundario />
          <Botao rotulo="Importar fatura (PDF ou foto)" onPress={escolherFatura} carregando={ocupado} secundario />
          <Botao rotulo="Importar extrato (OFX ou CSV)" onPress={escolherExtrato} desabilitado={ocupado} secundario />
          <Texto suave>Dados lidos de imagem sempre pedem a sua confirmacao na aba Revisar.</Texto>
        </Cartao>

        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        {historico.length > 0 ? (
          <Cartao titulo="Conversa">
            {historico.map((h) => (
              <View key={h.id} style={{ gap: 2 }}>
                <Texto suave>{h.quem === "voce" ? "Voce" : "Sistema"}</Texto>
                <Texto>{h.texto}</Texto>
              </View>
            ))}
          </Cartao>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
