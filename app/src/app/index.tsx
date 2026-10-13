import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { Aviso, Botao, Campo, Cartao, Texto } from "../components/ui";
import { useTema } from "../components/tema";
import { api } from "../lib/api";
import { formatarBRL } from "../lib/format";

interface Entrada {
  id: number;
  quem: "voce" | "sistema";
  texto: string;
}

type Mime = "application/pdf" | "image/png" | "image/jpeg";
const MIMES: Mime[] = ["application/pdf", "image/png", "image/jpeg"];

export default function Lancar() {
  const t = useTema();
  const [texto, setTexto] = useState("");
  const [historico, setHistorico] = useState<Entrada[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const seq = useRef(0);

  const add = (quem: Entrada["quem"], t: string) => setHistorico((h) => [{ id: ++seq.current, quem, texto: t }, ...h].slice(0, 30));

  async function enviar() {
    const msg = texto.trim();
    if (!msg) return;
    setOcupado(true);
    setErro(null);
    try {
      add("voce", msg);
      const r = await api.enviarMensagem(msg);
      add("sistema", r.resposta || "Mensagem ja processada.");
      setTexto("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setOcupado(false);
    }
  }

  async function enviarArquivo(uri: string, mime: string | undefined, tipo: "fatura" | "comprovante", nome: string) {
    const m = MIMES.find((x) => x === mime);
    if (!m) return setErro("Formato nao suportado. Use PDF, PNG ou JPEG (fotos em HEIC devem ser enviadas como JPEG).");
    setOcupado(true);
    setErro(null);
    try {
      add("voce", `Enviado: ${nome}`);
      const r = await api.enviarArquivo(uri, m, tipo);
      if (tipo === "fatura") {
        const c = r.conciliacao as { fecha: boolean; total_declarado_centavos: number; soma_itens_centavos: number } | null;
        const conc = c ? (c.fecha ? `Soma confere com o total da fatura (${formatarBRL(c.total_declarado_centavos)}).` : `ATENCAO: a soma dos itens (${formatarBRL(c.soma_itens_centavos)}) difere do total declarado (${formatarBRL(c.total_declarado_centavos)}); todos os itens foram para revisao.`) : "Total da fatura nao localizado para conferencia.";
        add("sistema", `Fatura lida: ${r.criados} novos, ${r.mesclados} unidos a lancamentos existentes, ${r.ja_processados} ja importados. ${r.pendentes} aguardam revisao. ${conc}`);
      } else {
        add("sistema", `Comprovante lido (${String(r.resultado)}). Confira os dados na aba Revisar.`);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar o arquivo.");
    } finally {
      setOcupado(false);
    }
  }

  async function fotografar() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setErro("Permissao da camera negada. Habilite em Ajustes do iPhone.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.9 });
    const a = r.canceled ? null : r.assets[0];
    if (a) await enviarArquivo(a.uri, a.mimeType ?? "image/jpeg", "comprovante", "foto do comprovante");
  }

  async function escolherFoto() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.9 });
    const a = r.canceled ? null : r.assets[0];
    if (a) await enviarArquivo(a.uri, a.mimeType ?? "image/jpeg", "comprovante", a.fileName ?? "foto");
  }

  async function escolherFatura() {
    const r = await DocumentPicker.getDocumentAsync({ type: MIMES, copyToCacheDirectory: true });
    const a = r.canceled ? null : r.assets[0];
    if (a) await enviarArquivo(a.uri, a.mimeType, "fatura", a.name);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.fundo }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Cartao titulo="Novo gasto">
          <Campo rotulo="Descreva a compra" value={texto} onChangeText={setTexto} placeholder="mercado 187,40 credito nomad" autoCapitalize="none" returnKeyType="send" onSubmitEditing={enviar} />
          <Botao rotulo="Registrar" onPress={enviar} carregando={ocupado} desabilitado={!texto.trim()} />
          <Texto suave>Exemplos: "almoco 42,90 debito ontem 13h", "notebook 3000 em 10x nomad", "recebi 5000 salario".</Texto>
        </Cartao>
        <Cartao titulo="Comprovantes e faturas">
          <Botao rotulo="Fotografar comprovante" onPress={fotografar} desabilitado={ocupado} secundario />
          <Botao rotulo="Escolher foto da galeria" onPress={escolherFoto} desabilitado={ocupado} secundario />
          <Botao rotulo="Importar fatura (PDF ou foto)" onPress={escolherFatura} desabilitado={ocupado} secundario />
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
