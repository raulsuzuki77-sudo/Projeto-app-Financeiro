import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from "react-native";
import { useTema } from "../components/tema";
import { Aviso, Botao, Campo, Cartao, Chip, GrupoChips, Segmentado, Texto } from "../components/ui";
import { api, type Cartao as CartaoLocal } from "../lib/api";
import { importarArquivo, type TipoImportacao } from "../lib/importar";
import { ErroPdfProtegido } from "../lib/ocr";
import { apagarSenhaPdf, lerSenhaPdf, salvarSenhaPdf } from "../lib/senha-pdf";

interface Arquivo {
  uri: string;
  nome: string;
}

function tipoSugerido(nome: string): TipoImportacao {
  const e = (nome.split(".").pop() ?? "").toLowerCase();
  if (e === "ofx" || e === "csv") return "extrato";
  if (["jpg", "jpeg", "png", "heic", "heif"].includes(e)) return "comprovante";
  return "fatura";
}

/** Tela única de importação: escolhe o arquivo (ou recebe do menu Compartilhar), o tipo, o cartão e, se o PDF tiver senha, a senha. */
export default function Importar() {
  const t = useTema();
  const router = useRouter();
  const params = useLocalSearchParams<{ uri?: string; nome?: string; tipo?: string }>();
  const [arquivo, setArquivo] = useState<Arquivo | null>(null);
  const [tipo, setTipo] = useState<TipoImportacao>("fatura");
  const [cartoes, setCartoes] = useState<CartaoLocal[]>([]);
  const [cartaoId, setCartaoId] = useState<number | null>(null);
  const [senha, setSenha] = useState("");
  const [lembrar, setLembrar] = useState(false);
  const [pedirSenha, setPedirSenha] = useState<null | "pedida" | "incorreta">(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.cartoes().then(setCartoes, () => undefined);
  }, []);

  // arquivo recebido de fora (menu Compartilhar) ou da câmera na tela inicial
  useEffect(() => {
    if (params.uri) {
      const uri = decodeURIComponent(String(params.uri));
      const nome = params.nome ? String(params.nome) : decodeURIComponent(uri.split("/").pop() ?? "arquivo");
      escolher({ uri, nome }, params.tipo as TipoImportacao | undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.uri]);

  function escolher(a: Arquivo, forcado?: TipoImportacao) {
    setArquivo(a);
    setTipo(forcado ?? tipoSugerido(a.nome));
    setResultado(null);
    setErro(null);
    setPedirSenha(null);
  }

  async function escolherCartao(id: number | null) {
    setCartaoId(id);
    setPedirSenha(null);
    if (id !== null) {
      const salva = await lerSenhaPdf(id);
      setSenha(salva ?? "");
      setLembrar(salva !== null);
    }
  }

  async function pickArquivo() {
    const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    const a = r.canceled ? null : r.assets[0];
    if (a) escolher({ uri: a.uri, nome: a.name });
  }
  async function pickFoto() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.9 });
    const a = r.canceled ? null : r.assets[0];
    if (a) escolher({ uri: a.uri, nome: a.fileName ?? "foto.jpg" }, "comprovante");
  }
  async function pickCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setErro("Permissão da câmera negada. Habilite em Ajustes do iPhone.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.9 });
    const a = r.canceled ? null : r.assets[0];
    if (a) escolher({ uri: a.uri, nome: "foto-comprovante.jpg" }, "comprovante");
  }

  async function importar() {
    if (!arquivo) return;
    setOcupado(true);
    setErro(null);
    setResultado(null);
    try {
      const msg = await importarArquivo(arquivo, tipo, cartaoId, senha || null);
      if (cartaoId !== null) {
        if (lembrar && senha) await salvarSenhaPdf(cartaoId, senha);
        if (!lembrar) await apagarSenhaPdf(cartaoId);
      }
      setPedirSenha(null);
      setResultado(msg);
    } catch (e) {
      if (e instanceof ErroPdfProtegido) setPedirSenha(e.incorreta ? "incorreta" : "pedida");
      else setErro(e instanceof Error ? e.message : "Falha ao importar.");
    } finally {
      setOcupado(false);
    }
  }

  const ehPdf = (arquivo?.nome ?? "").toLowerCase().endsWith(".pdf");

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Cartao titulo="1. Arquivo">
          {arquivo ? <Text style={{ color: t.texto, fontSize: 15, fontWeight: "600" }} numberOfLines={2}>{arquivo.nome}</Text> : <Texto suave>Escolha a fatura (PDF ou foto), o extrato (OFX ou CSV) ou um comprovante.</Texto>}
          <Botao rotulo={arquivo ? "Escolher outro arquivo" : "Escolher arquivo"} icone="importar" onPress={pickArquivo} secundario />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Botao rotulo="Galeria" pequeno secundario onPress={pickFoto} /></View>
            <View style={{ flex: 1 }}><Botao rotulo="Câmera" icone="camera" pequeno secundario onPress={pickCamera} /></View>
          </View>
          <Texto suave pequeno>Dica: em Arquivos, Mail ou no app do banco, toque em Compartilhar e escolha Controle Financeiro para chegar aqui já com o arquivo.</Texto>
        </Cartao>

        {arquivo ? (
          <Cartao titulo="2. Tipo e cartão">
            <Segmentado rotulo="Tipo de documento" valor={tipo} onChange={setTipo} opcoes={[{ id: "fatura", rotulo: "Fatura" }, { id: "extrato", rotulo: "Extrato" }, { id: "comprovante", rotulo: "Comprovante" }]} />
            {cartoes.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Texto suave pequeno>Cartão da fatura ou do comprovante</Texto>
                <GrupoChips>
                  <Chip rotulo="Nenhum" ativo={cartaoId === null} onPress={() => escolherCartao(null)} />
                  {cartoes.map((c) => <Chip key={c.id} rotulo={c.apelido} ativo={cartaoId === c.id} onPress={() => escolherCartao(c.id)} />)}
                </GrupoChips>
              </View>
            ) : (
              <Texto suave pequeno>Cadastre seus cartões em Mais opções, Cartões para vincular as faturas.</Texto>
            )}
            {ehPdf || pedirSenha ? (
              <View style={{ gap: 8 }}>
                {pedirSenha ? <Aviso tipo="info">{pedirSenha === "incorreta" ? "A senha informada não abriu o PDF. Confira e tente de novo." : "Este PDF é protegido por senha. Informe-a abaixo."}</Aviso> : null}
                <Campo rotulo="Senha do PDF (se houver)" value={senha} onChangeText={setSenha} secureTextEntry autoCapitalize="none" autoCorrect={false} />
                {cartaoId !== null ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Switch accessibilityLabel="Lembrar a senha deste cartão" value={lembrar} onValueChange={setLembrar} />
                    <Texto suave pequeno>Lembrar a senha para este cartão (Chaveiro do iPhone)</Texto>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Botao rotulo={ocupado ? "Lendo o documento..." : "Importar"} onPress={importar} carregando={ocupado} />
          </Cartao>
        ) : null}

        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        {resultado ? (
          <Cartao titulo="Resultado">
            <Texto>{resultado}</Texto>
            <Botao rotulo="Ir para Revisar" onPress={() => router.replace("/revisar")} secundario />
          </Cartao>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
