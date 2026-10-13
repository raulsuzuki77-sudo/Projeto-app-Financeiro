import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Aviso, Botao, Campo, Cartao, Texto } from "../components/ui";
import { useTema } from "../components/tema";
import { api, apagarConexao, lerConexao, salvarConexao } from "../lib/api";
import { urlServidorValida } from "../lib/format";

export default function Ajustes() {
  const t = useTema();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ tipo: "erro" | "info"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    lerConexao().then((c) => {
      if (c) setUrl(c.url);
    });
  }, []);

  async function salvar() {
    const v = urlServidorValida(url);
    if (!v.ok) return setMsg({ tipo: "erro", texto: v.motivo });
    if (token.trim().length < 24) return setMsg({ tipo: "erro", texto: "O token deve ter pelo menos 24 caracteres." });
    setOcupado(true);
    try {
      const c = { url: v.url, token: token.trim() };
      await api.testar(c);
      await salvarConexao(c);
      setToken("");
      setUrl(v.url);
      setMsg({ tipo: "info", texto: "Conexao salva. O token fica guardado no Chaveiro do iPhone." });
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : "Falha ao conectar." });
    } finally {
      setOcupado(false);
    }
  }

  async function sair() {
    await apagarConexao();
    setUrl("");
    setToken("");
    setMsg({ tipo: "info", texto: "Conexao removida deste aparelho." });
  }

  return (
    <ScrollView style={{ backgroundColor: t.fundo }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Cartao titulo="Servidor">
        <Campo rotulo="Endereco do servidor" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://seu-servidor.exemplo.com" />
        <Campo rotulo="Token de acesso" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Cole o API_TOKEN do servidor" />
        <Botao rotulo="Testar e salvar" onPress={salvar} carregando={ocupado} />
        <Botao rotulo="Remover conexao" onPress={sair} secundario />
        {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
      </Cartao>
      <Cartao titulo="Seguranca">
        <Texto suave>O endereco precisa ser https, exceto na rede local. Os dados financeiros ficam no seu servidor; este aplicativo guarda apenas o endereco e o token, no Chaveiro do aparelho.</Texto>
      </Cartao>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
