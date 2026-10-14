import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useTema } from "../components/tema";
import { useToast } from "../components/toast";
import { Aviso, Botao, Campo, Cartao, Texto } from "../components/ui";
import { useDados } from "../hooks/useDados";
import { api } from "../lib/api";
import { confirmar } from "../lib/confirmar";
import { dataBR } from "../lib/format";
import {
  backupMensalNaPasta, definirSenhaDoBackupAutomatico, escolherPasta, esquecerPasta, estadoDaPasta, listarBackupsDaPasta, NOME_DA_PASTA, restaurarBackupDaPasta, senhaDoBackupAutomatico, SUBPASTA_BACKUPS,
  sincronizarPasta, type ResultadoSincronizacao,
} from "../lib/pasta-documentos";
import { TAMANHO_MIN_SENHA } from "../../../core/src/index";

const ROTULO_STATUS: Record<string, string> = { importado: "Importado", repetido: "Já importado", ignorado: "Ignorado", precisa_decisao: "Precisa de você", erro: "Erro" };
const dataDe = (segundos: number) => dataBR(new Date(segundos * 1000).toISOString().slice(0, 10));

function resumo(r: ResultadoSincronizacao): string {
  if (r.status === "indisponivel") return "A pasta de documentos só funciona no aplicativo instalado no iPhone (build com o Xcode).";
  if (r.status === "nao_configurada") return "Nenhuma pasta escolhida ainda.";
  if (r.status === "sem_acesso") return r.mensagens[0] ?? "Sem acesso à pasta.";
  const p = [`${r.vistos} arquivo(s) de documentos na pasta`, `${r.importados} importado(s) agora`];
  if (r.repetidos) p.push(`${r.repetidos} com conteúdo já importado`);
  if (r.pendentes) p.push(`${r.pendentes} aguardando decisão sua`);
  if (r.erros) p.push(`${r.erros} com erro`);
  if (r.aguardando_download) p.push(`${r.aguardando_download} aguardando download do iCloud`);
  return p.join(", ") + ".";
}

export default function Pasta() {
  const t = useTema();
  const toast = useToast();
  const [estado, setEstado] = useState(estadoDaPasta());
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimo, setUltimo] = useState<ResultadoSincronizacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [temSenha, setTemSenha] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [senhaRestauro, setSenhaRestauro] = useState("");

  const { dados, recarregar } = useDados(async () => ({ arquivos: await api.arquivosDaPasta(), backups: await listarBackupsDaPasta().catch(() => []) }), []);
  const atualizarEstado = useCallback(() => setEstado(estadoDaPasta()), []);
  useEffect(() => {
    senhaDoBackupAutomatico().then((s) => setTemSenha(!!s), () => undefined);
  }, []);

  async function escolher() {
    setErro(null);
    try {
      const nome = await escolherPasta();
      atualizarEstado();
      if (nome) {
        toast({ texto: `Pasta «${nome}» escolhida.` });
        await sincronizar();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível escolher a pasta.");
    }
  }

  async function sincronizar() {
    setSincronizando(true);
    setErro(null);
    try {
      const r = await sincronizarPasta();
      setUltimo(r);
      await recarregar();
      toast({ texto: resumo(r) });
    } finally {
      setSincronizando(false);
    }
  }

  async function salvarSenha() {
    setErro(null);
    if (senha !== senha2) return setErro("As senhas não coincidem.");
    try {
      await definirSenhaDoBackupAutomatico(senha);
      setSenha("");
      setSenha2("");
      setTemSenha(true);
      toast({ texto: "Senha dos backups automáticos guardada no Chaveiro deste iPhone." });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar a senha.");
    }
  }

  async function fazerBackup() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await backupMensalNaPasta(true);
      if (r.status === "feito") toast({ texto: r.mensagem });
      else setErro(r.mensagem);
      await recarregar();
    } finally {
      setOcupado(false);
    }
  }

  async function restaurar(caminho: string) {
    setErro(null);
    if (senhaRestauro.length < TAMANHO_MIN_SENHA) return setErro(`Informe a senha do backup (mínimo ${TAMANHO_MIN_SENHA} caracteres).`);
    if (!(await confirmar("Restaurar backup", "Todos os dados atuais deste aparelho serão SUBSTITUÍDOS pelos do backup escolhido. Deseja continuar?", "Substituir"))) return;
    setOcupado(true);
    try {
      const n = await restaurarBackupDaPasta(caminho, senhaRestauro);
      setRestaurando(null);
      setSenhaRestauro("");
      toast({ texto: `Backup restaurado (${n} registros).` });
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível restaurar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {!estado.disponivel ? <Aviso tipo="info">Esta função usa o app Arquivos do iPhone e só está disponível no aplicativo instalado pelo Xcode (não no Expo Go nem na versão para computador).</Aviso> : null}
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

        <Cartao titulo={`Pasta «${NOME_DA_PASTA}»`}>
          <Texto suave>Crie no app Arquivos do iPhone uma pasta chamada «{NOME_DA_PASTA}» (em Neste iPhone ou no iCloud Drive), coloque nela as faturas, os extratos e os informes que receber e escolha-a aqui. Sempre que o aplicativo abre, ele lê a pasta e importa o que ainda não foi importado; o que já foi importado não é lido nem contado de novo.</Texto>
          <Texto suave pequeno>Importa sozinho: extratos e faturas em CSV ou OFX, faturas em PDF e extratos de investimento em PDF (BTG). Faturas em PDF precisam do cartão identificado e, se tiverem senha, a senha precisa estar guardada para o cartão. Outros tipos de arquivo são ignorados. Os dados continuam só neste aparelho.</Texto>
          {estado.configurada ? (
            <>
              <Texto forte>{estado.valida ? `Pasta escolhida: ${estado.nome}` : "A permissão da pasta deixou de valer. Escolha-a de novo."}</Texto>
              <Botao rotulo={sincronizando ? "Lendo a pasta..." : "Sincronizar agora"} onPress={sincronizar} carregando={sincronizando} desabilitado={!estado.valida} />
              <Botao rotulo="Escolher outra pasta" secundario pequeno onPress={escolher} />
              <Botao rotulo="Esquecer a pasta" secundario pequeno perigo onPress={() => { esquecerPasta(); atualizarEstado(); }} />
            </>
          ) : (
            <Botao rotulo="Escolher a pasta" icone="importar" onPress={escolher} desabilitado={!estado.disponivel} />
          )}
          {ultimo ? <Aviso tipo="info">{resumo(ultimo)}</Aviso> : null}
          {ultimo && ultimo.mensagens.length > 0 ? ultimo.mensagens.slice(0, 6).map((m, i) => <Texto key={i} suave pequeno>{m}</Texto>) : null}
        </Cartao>

        {dados && dados.arquivos.length > 0 ? (
          <Cartao titulo="O que o aplicativo já fez com os arquivos">
            {dados.arquivos.slice(0, 30).map((a) => (
              <View key={`${a.caminho}-${a.tamanho}-${a.modificado}`} style={{ gap: 2 }}>
                <Text style={{ color: t.texto, fontSize: 14, fontWeight: "600" }} numberOfLines={2}>{a.caminho}</Text>
                <Text style={{ color: a.status === "erro" || a.status === "precisa_decisao" ? t.alerta : t.suave, fontSize: 12 }}>{ROTULO_STATUS[a.status] ?? a.status} · {dataBR(a.processado_em.slice(0, 10))}{a.mensagem ? ` · ${a.mensagem}` : ""}</Text>
              </View>
            ))}
            <Texto suave pequeno>Arquivos marcados «Precisa de você» ou «Erro» são tentados de novo a cada abertura. Para reimportar tudo, use o botão abaixo: o que já está no aplicativo não é duplicado.</Texto>
            <Botao rotulo="Reler todos os arquivos da pasta" secundario pequeno onPress={async () => { await api.reiniciarRegistroDaPasta(); await sincronizar(); }} desabilitado={!estado.valida || sincronizando} />
          </Cartao>
        ) : null}

        <Cartao titulo={`Backups mensais em «${SUBPASTA_BACKUPS}»`}>
          <Texto suave>O aplicativo grava, dentro da pasta de documentos, um backup cifrado por mês (atualizado uma vez por dia enquanto o mês durar). Como o arquivo fica fora do aplicativo, ele sobrevive a desinstalar o app ou a um problema no banco de dados.</Texto>
          <Aviso tipo="info">A senha cifra os backups e fica guardada no Chaveiro deste iPhone. O aplicativo não consegue recuperá-la: anote-a em lugar seguro. Sem ela, os backups não abrem.</Aviso>
          <Texto forte>{temSenha ? "Senha dos backups automáticos: definida" : "Senha dos backups automáticos: ainda não definida"}</Texto>
          <Campo rotulo={temSenha ? "Nova senha (mínimo 10 caracteres)" : "Senha (mínimo 10 caracteres)"} value={senha} onChangeText={setSenha} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <Campo rotulo="Repita a senha" value={senha2} onChangeText={setSenha2} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <Botao rotulo={temSenha ? "Trocar a senha" : "Guardar a senha"} secundario onPress={salvarSenha} desabilitado={senha.length < TAMANHO_MIN_SENHA} />
          <Botao rotulo="Fazer o backup agora" onPress={fazerBackup} carregando={ocupado} desabilitado={!estado.valida || !temSenha} />
          {dados && dados.backups.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Texto forte>Backups na pasta</Texto>
              {dados.backups.map((b) => (
                <View key={b.caminho} style={{ gap: 6 }}>
                  <Text style={{ color: t.texto, fontSize: 14 }}>{b.nome} · atualizado em {dataDe(b.modificado)} · {Math.max(1, Math.round(b.tamanho / 1024))} KB</Text>
                  {restaurando === b.caminho ? (
                    <View style={{ gap: 8 }}>
                      <Campo rotulo="Senha deste backup" value={senhaRestauro} onChangeText={setSenhaRestauro} secureTextEntry autoCapitalize="none" autoCorrect={false} />
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <View style={{ flex: 1 }}><Botao rotulo="Restaurar" pequeno perigo onPress={() => restaurar(b.caminho)} carregando={ocupado} /></View>
                        <View style={{ flex: 1 }}><Botao rotulo="Cancelar" pequeno secundario onPress={() => { setRestaurando(null); setSenhaRestauro(""); }} /></View>
                      </View>
                    </View>
                  ) : (
                    <Botao rotulo="Restaurar este backup" pequeno secundario onPress={() => setRestaurando(b.caminho)} desabilitado={ocupado} />
                  )}
                </View>
              ))}
              <Texto suave pequeno>Restaurar substitui todos os dados atuais. Depois de reinstalar o aplicativo, escolha a pasta de documentos de novo para ver os backups aqui.</Texto>
            </View>
          ) : (
            <Texto suave pequeno>Nenhum backup na pasta ainda.</Texto>
          )}
        </Cartao>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
