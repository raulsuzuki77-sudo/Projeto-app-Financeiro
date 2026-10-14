import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useDados } from "../hooks/useDados";
import { api, type DocumentoListado, type EscopoDoMes } from "../lib/api";
import { confirmar } from "../lib/confirmar";
import { dataBR, formatarBRL, mesAtual, mudarMes, nomeMes } from "../lib/format";
import { confirmarComSenhaDoAparelho } from "../lib/seguranca";
import { SeletorMes } from "./seletor-mes";
import { useTema } from "./tema";
import { useToast } from "./toast";
import { Aviso, Botao, Campo, Cartao, Chip, GrupoChips, Texto } from "./ui";

const TIPOS: Record<string, string> = {
  extrato_conta: "Extrato da conta",
  fatura_cartao: "Fatura de cartão",
  comprovante: "Comprovante",
  extrato_investimento: "Extrato de investimentos",
  legado: "Importação anterior ao registro de documentos",
};

const ESCOPOS: { id: EscopoDoMes; rotulo: string; descricao: string }[] = [
  { id: "tudo", rotulo: "Tudo do mês", descricao: "todos os lançamentos e os extratos de investimento do mês" },
  { id: "documentos", rotulo: "Só o que veio de arquivos", descricao: "lançamentos que vieram de faturas, extratos e comprovantes" },
  { id: "manuais", rotulo: "Só o que foi digitado", descricao: "lançamentos digitados, de mensagens e de recorrências" },
  { id: "investimentos", rotulo: "Só extratos de investimento", descricao: "posições e movimentos dos extratos do mês" },
];

function Documento({ d, mes, aoMudar }: { d: DocumentoListado; mes: string; aoMudar: () => void }) {
  const t = useTema();
  const toast = useToast();
  const [movendo, setMovendo] = useState(false);
  const [alvo, setAlvo] = useState(d.mes_referencia ?? mes);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ref = { fonte: d.fonte, id: d.id } as const;
  const noMes = d.lancamentos_no_mes ?? d.lancamentos;

  async function excluir() {
    const detalhe = d.fonte === "extrato_investimento" ? `As ${d.posicoes} posição(ões) e os movimentos deste extrato serão removidos.` : `Os ${d.lancamentos} lançamento(s) que vieram só deste arquivo serão removidos de vez (inclusive de outros meses); lançamentos que também vieram de outro arquivo ou foram digitados ficam.`;
    if (!(await confirmar("Excluir documento", `${d.nome}\n\n${detalhe}\n\nO arquivo poderá ser importado de novo depois.`, "Excluir"))) return;
    setOcupado(true);
    try {
      const r = await api.excluirDocumento(ref);
      toast({ texto: d.fonte === "extrato_investimento" ? "Extrato excluído." : `Documento excluído: ${r.lancamentos_removidos} lançamento(s) removido(s)${r.lancamentos_mantidos ? `, ${r.lancamentos_mantidos} mantido(s) por terem outra origem` : ""}.` });
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setOcupado(false);
    }
  }

  async function mover() {
    const base = d.mes_referencia ?? mes;
    if (alvo === base) return setErro("Escolha um mês diferente do atual do documento.");
    if (!(await confirmar("Mover documento", `${d.nome}\n\nTodas as datas deste documento serão deslocadas de ${nomeMes(base)} para ${nomeMes(alvo)} (os intervalos entre elas se mantêm).`, "Mover", false))) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.moverDocumento(ref, alvo, base);
      toast({ texto: d.fonte === "extrato_investimento" ? `Extrato movido para ${nomeMes(alvo)}.` : `${r.lancamentos_movidos} lançamento(s) movido(s) para ${nomeMes(alvo)}${r.lancamentos_mantidos ? `; ${r.lancamentos_mantidos} ficaram por terem outra origem` : ""}.` });
      setMovendo(false);
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível mover.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Cartao>
      <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>{d.nome}</Text>
      <Texto suave pequeno>{TIPOS[d.tipo] ?? d.tipo}{d.cartao ? ` · cartão ${d.cartao}` : ""} · importado em {dataBR(d.importado_em.slice(0, 10))}{d.origem === "pasta" ? " · pela pasta Documentos financeiros" : ""}</Texto>
      {d.periodo_inicio ? <Texto suave pequeno>Período: {dataBR(d.periodo_inicio)} a {dataBR(d.periodo_fim ?? d.periodo_inicio)}</Texto> : null}
      {d.fonte === "documento" ? (
        <Texto>{noMes} lançamento(s) neste mês{d.lancamentos !== noMes ? ` (${d.lancamentos} no total)` : ""} · saídas {formatarBRL(d.saidas_centavos)}{d.entradas_centavos ? ` · entradas ${formatarBRL(d.entradas_centavos)}` : ""}</Texto>
      ) : (
        <Texto>{d.posicoes} posição(ões) registrada(s)</Texto>
      )}
      {d.versao_de ? <Aviso tipo="info">Nova versão de um documento já importado: os itens repetidos não foram contados de novo.</Aviso> : null}
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {movendo ? (
        <View style={{ gap: 8 }}>
          <Texto suave pequeno>Mês do documento hoje: {nomeMes(d.mes_referencia ?? mes)}. Escolha o mês para onde ele deve ir:</Texto>
          <SeletorMes mes={alvo} onChange={setAlvo} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Botao rotulo="Mover" pequeno onPress={mover} carregando={ocupado} /></View>
            <View style={{ flex: 1 }}><Botao rotulo="Cancelar" pequeno secundario onPress={() => setMovendo(false)} /></View>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Botao rotulo="Mover de mês" pequeno secundario onPress={() => { setAlvo(d.mes_referencia ?? mes); setMovendo(true); }} desabilitado={ocupado} /></View>
          <View style={{ flex: 1 }}><Botao rotulo="Excluir" pequeno perigo onPress={excluir} desabilitado={ocupado} /></View>
        </View>
      )}
    </Cartao>
  );
}

function MesInteiro({ mes, aoMudar }: { mes: string; aoMudar: () => void }) {
  const toast = useToast();
  const [escopo, setEscopo] = useState<EscopoDoMes>("documentos");
  const [previa, setPrevia] = useState<{ lancamentos: number; extratos_investimento: number } | null>(null);
  const [alvo, setAlvo] = useState(mudarMes(mes, 1));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const info = ESCOPOS.find((e) => e.id === escopo)!;

  useEffect(() => {
    setAlvo(mudarMes(mes, 1));
  }, [mes]);
  useEffect(() => {
    api.previaDoMes(mes, escopo).then(setPrevia, () => setPrevia(null));
  }, [mes, escopo]);

  const resumo = previa ? `${previa.lancamentos} lançamento(s)${previa.extratos_investimento ? ` e ${previa.extratos_investimento} extrato(s) de investimento` : ""}` : "";

  async function excluir() {
    if (!previa || (previa.lancamentos === 0 && previa.extratos_investimento === 0)) return setErro("Não há nada neste escopo para excluir.");
    if (!(await confirmar("Excluir do mês", `${nomeMes(mes)}: ${info.rotulo.toLowerCase()}.\n\nSerão removidos de vez ${resumo}. Esta ação não pode ser desfeita.`, "Excluir"))) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.excluirMes(mes, escopo);
      toast({ texto: `Excluído: ${r.lancamentos} lançamento(s)${r.extratos_investimento ? ` e ${r.extratos_investimento} extrato(s)` : ""}.` });
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setOcupado(false);
    }
  }

  async function mover() {
    if (!previa || (previa.lancamentos === 0 && previa.extratos_investimento === 0)) return setErro("Não há nada neste escopo para mover.");
    if (alvo === mes) return setErro("Escolha um mês diferente.");
    if (!(await confirmar("Mover o mês", `${nomeMes(mes)} → ${nomeMes(alvo)}: ${info.rotulo.toLowerCase()}.\n\nSerão movidos ${resumo}, deslocando as datas.`, "Mover", false))) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.moverMes(mes, alvo, escopo);
      toast({ texto: `Movido para ${nomeMes(alvo)}: ${r.lancamentos} lançamento(s)${r.extratos_investimento ? ` e ${r.extratos_investimento} extrato(s)` : ""}.` });
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível mover.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Cartao titulo={`O mês inteiro: ${nomeMes(mes)}`}>
      <Texto suave pequeno>Para quando um mês foi importado errado e é melhor refazer, ou foi lançado com a data errada. Escolha o que a ação alcança:</Texto>
      <GrupoChips>{ESCOPOS.map((e) => <Chip key={e.id} rotulo={e.rotulo} ativo={escopo === e.id} onPress={() => setEscopo(e.id)} />)}</GrupoChips>
      <Texto suave pequeno>{info.descricao}{previa ? `: ${resumo}.` : "."}</Texto>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <Botao rotulo="Excluir do mês" perigo onPress={excluir} carregando={ocupado} desabilitado={!previa || (previa.lancamentos === 0 && previa.extratos_investimento === 0)} />
      <Texto suave pequeno>Ou mova esse conjunto para outro mês (as datas são deslocadas):</Texto>
      <SeletorMes mes={alvo} onChange={setAlvo} />
      <Botao rotulo={`Mover para ${nomeMes(alvo)}`} secundario onPress={mover} carregando={ocupado} desabilitado={!previa || (previa.lancamentos === 0 && previa.extratos_investimento === 0) || alvo === mes} />
    </Cartao>
  );
}

function ZerarDados({ aoMudar }: { aoMudar: () => void }) {
  const t = useTema();
  const router = useRouter();
  const toast = useToast();
  const [escopo, setEscopo] = useState<"movimentacoes" | "tudo" | null>(null);
  const [frase, setFrase] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function apagar() {
    if (!escopo) return;
    setErro(null);
    if (frase.trim().toUpperCase() !== "APAGAR") return setErro('Digite APAGAR, em letras maiúsculas, para confirmar.');
    const texto = escopo === "tudo" ? "TODOS os dados do aplicativo (lançamentos, documentos, cartões, regras aprendidas, orçamento, metas, eventos, recorrências e investimentos)" : "todos os lançamentos, documentos e extratos de investimento (cartões, regras aprendidas, orçamento, metas, eventos e recorrências ficam)";
    if (!(await confirmar("Apagar dados", `Serão apagados de vez ${texto}. Não há como desfazer, a não ser restaurando um backup.\n\nVocê já exportou um backup?`, "Apagar mesmo assim"))) return;
    setOcupado(true);
    try {
      if (Platform.OS !== "web") {
        const a = await confirmarComSenhaDoAparelho("Confirme com a senha do aparelho para apagar os dados");
        if (!a.ok) {
          // sem tela de bloqueio no aparelho nao ha como pedir a senha: a frase digitada e a confirmacao
          if (a.disponivel) return setErro(a.motivo);
        }
      }
      const r = await api.apagarDados(escopo);
      setEscopo(null);
      setFrase("");
      toast({ texto: `Dados apagados (${r.linhas} registro(s)).` });
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Cartao titulo="Zerar os dados do aplicativo">
      <Texto suave pequeno>Para recomeçar do zero. Antes de apagar, exporte um backup cifrado: ele é a única forma de voltar atrás.</Texto>
      <Botao rotulo="Exportar backup agora" pequeno secundario onPress={() => router.push("/seguranca")} />
      {escopo === null ? (
        <View style={{ gap: 8 }}>
          <Botao rotulo="Apagar lançamentos, documentos e investimentos" perigo onPress={() => setEscopo("movimentacoes")} />
          <Texto suave pequeno>Mantém cartões, regras de classificação aprendidas, orçamento, metas, eventos e recorrências.</Texto>
          <Botao rotulo="Apagar absolutamente tudo" perigo onPress={() => setEscopo("tudo")} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Aviso tipo="erro">{escopo === "tudo" ? "Vai apagar TODOS os dados do aplicativo." : "Vai apagar todos os lançamentos, documentos e extratos de investimento."} {Platform.OS === "web" ? "" : "O iPhone pedirá Face ID ou o código do aparelho."}</Aviso>
          <Campo rotulo="Digite APAGAR para confirmar" value={frase} onChangeText={setFrase} autoCapitalize="characters" autoCorrect={false} />
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Botao rotulo="Apagar" perigo onPress={apagar} carregando={ocupado} desabilitado={frase.trim().toUpperCase() !== "APAGAR"} />
          <Botao rotulo="Cancelar" secundario onPress={() => { setEscopo(null); setFrase(""); setErro(null); }} />
        </View>
      )}
      {escopo === null && erro ? <Text style={{ color: t.perigo }}>{erro}</Text> : null}
    </Cartao>
  );
}

/** Aba "Ajustar" da tela de documentos: corrigir o que foi importado (excluir, mover de mês, por arquivo ou pelo mês inteiro). */
export function AjustarDocumentos() {
  const [mes, setMes] = useState(mesAtual());
  const { dados, erro, recarregar } = useDados(async () => ({ docs: await api.documentos(mes), manuais: await api.manuaisDoMes(mes) }), [mes]);

  return (
    <>
      <Cartao titulo="Mês">
        <SeletorMes mes={mes} onChange={setMes} />
        <Texto suave pequeno>Mostra os documentos que têm lançamentos neste mês (ou extrato de investimento do mês).</Texto>
      </Cartao>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {dados && dados.docs.length === 0 ? <Cartao><Texto suave>Nenhum documento importado com lançamentos em {nomeMes(mes)}.</Texto></Cartao> : null}
      {(dados?.docs ?? []).map((d) => <Documento key={`${d.fonte}-${d.id}`} d={d} mes={mes} aoMudar={recarregar} />)}
      {dados && dados.manuais.quantidade > 0 ? (
        <Cartao titulo="Lançamentos digitados">
          <Texto>{dados.manuais.quantidade} lançamento(s) sem arquivo de origem neste mês (digitados, de mensagem ou de recorrência) · saídas {formatarBRL(dados.manuais.saidas_centavos)}</Texto>
          <Texto suave pequeno>Edite ou exclua cada um no Extrato, ou use "O mês inteiro" abaixo.</Texto>
        </Cartao>
      ) : null}
      <MesInteiro mes={mes} aoMudar={recarregar} />
      <ZerarDados aoMudar={recarregar} />
    </>
  );
}
