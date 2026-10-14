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
  const [arquivos, setArquivos] = useState<Arquivo[]>([]);
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
      escolher([{ uri, nome }], params.tipo as TipoImportacao | undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.uri]);

  function escolher(lista: Arquivo[], forcado?: TipoImportacao) {
    setArquivos(lista);
    setTipo(forcado ?? (lista.every((a) => tipoSugerido(a.nome) === "extrato") ? "extrato" : tipoSugerido(lista[0]!.nome)));
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
    const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: true });
    if (!r.canceled && r.assets.length > 0) escolher(r.assets.map((a) => ({ uri: a.uri, nome: a.name })));
  }
  async function pickFoto() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.9 });
    const a = r.canceled ? null : r.assets[0];
    if (a) escolher([{ uri: a.uri, nome: a.fileName ?? "foto.jpg" }], "comprovante");
  }
  async function pickCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setErro("Permissão da câmera negada. Habilite em Ajustes do iPhone.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.9 });
    const a = r.canceled ? null : r.assets[0];
    if (a) escolher([{ uri: a.uri, nome: "foto-comprovante.jpg" }], "comprovante");
  }

  async function importar() {
    if (arquivos.length === 0) return;
    setOcupado(true);
    setErro(null);
    setResultado(null);
    const feitos: string[] = [];
    const falhas: string[] = [];
    const varios = arquivos.length > 1;
    try {
      for (const a of arquivos) {
        try {
          const msg = await importarArquivo(a, tipo, cartaoId, senha || null);
          feitos.push(varios ? `${a.nome}: ${msg}` : msg);
          if (cartaoId !== null && /\.pdf$/i.test(a.nome)) {
            if (lembrar && senha) await salvarSenhaPdf(cartaoId, senha);
            if (!lembrar) await apagarSenhaPdf(cartaoId);
          }
        } catch (e) {
          if (e instanceof ErroPdfProtegido) {
            setPedirSenha(e.incorreta ? "incorreta" : "pedida");
            if (feitos.length) setResultado(feitos.join("\n\n"));
            return;
          }
          const m = e instanceof Error ? e.message : "Falha ao importar.";
          falhas.push(varios ? `${a.nome}: ${m}` : m);
        }
      }
      setPedirSenha(null);
      if (feitos.length) setResultado(feitos.join("\n\n"));
      if (falhas.length) setErro(falhas.join("\n"));
    } finally {
      setOcupado(false);
    }
  }

  const ehPdf = arquivos.some((a) => a.nome.toLowerCase().endsWith(".pdf"));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Cartao titulo="1. Arquivo">
          {arquivos.length > 0 ? arquivos.map((a) => <Text key={a.uri} style={{ color: t.texto, fontSize: 15, fontWeight: "600" }} numberOfLines={2}>{a.nome}</Text>) : <Texto suave>Escolha a fatura (PDF ou foto), o extrato (OFX ou CSV, vários de uma vez) ou um comprovante. Os extratos CSV do Nubank (conta e cartão) são reconhecidos automaticamente.</Texto>}
          <Botao rotulo={arquivos.length > 0 ? "Escolher outros arquivos" : "Escolher arquivos"} icone="importar" onPress={pickArquivo} secundario />
          {Platform.OS !== "web" ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Botao rotulo="Galeria" pequeno secundario onPress={pickFoto} /></View>
              <View style={{ flex: 1 }}><Botao rotulo="Câmera" icone="camera" pequeno secundario onPress={pickCamera} /></View>
            </View>
          ) : null}
          {Platform.OS !== "web" ? <Texto suave pequeno>Dica: em Arquivos, Mail ou no app do banco, toque em Compartilhar e escolha Controle Financeiro para chegar aqui já com o arquivo.</Texto> : null}
        </Cartao>

        {arquivos.length > 0 ? (
          <Cartao titulo="2. Tipo e cartão">
            <Segmentado rotulo="Tipo de documento" valor={tipo} onChange={setTipo} opcoes={[{ id: "fatura", rotulo: "Fatura" }, { id: "extrato", rotulo: "Extrato" }, { id: "comprovante", rotulo: "Comprovante" }]} />
            {cartoes.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Texto suave pequeno>Cartão da fatura ou do comprovante (o extrato da conta Nubank não usa cartão)</Texto>
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
