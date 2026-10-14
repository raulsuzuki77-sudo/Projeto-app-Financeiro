import { useEffect, useState } from "react";
import { View } from "react-native";
import { CLASSES_ATIVO, ROTULO_CLASSE, type ClasseAtivo } from "../../../core/src/index";
import { SeletorMes } from "./seletor-mes";
import { useToast } from "./toast";
import { Aviso, Botao, Campo, CampoValor, Cartao, Chip, GrupoChips, Texto } from "./ui";
import { api } from "../lib/api";
import { nomeMes, reaisParaCentavos } from "../lib/format";

const CLASSES = CLASSES_ATIVO.filter((c) => c !== "transito");

/** Posição lançada à mão (instituição sem leitura de extrato): vale para o mês escolhido e, depois, até haver outra para a mesma instituição. */
export function LiberdadeManual({ mes, aoSalvar }: { mes: string; aoSalvar: (mes: string) => void }) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [mesPos, setMesPos] = useState(mes);
  const [instituicao, setInstituicao] = useState("");
  const [classe, setClasse] = useState<ClasseAtivo>("renda_fixa");
  const [ativo, setAtivo] = useState("");
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => setMesPos(mes), [mes]);

  async function salvar() {
    const centavos = reaisParaCentavos(valor);
    if (!instituicao.trim() || !ativo.trim() || centavos === null || centavos <= 0) return setErro("Informe instituição, descrição e um valor maior que zero.");
    setSalvando(true);
    setErro(null);
    try {
      await api.adicionarPosicaoInvestimento({ mes: mesPos, instituicao, classe_ativo: classe, ativo, valor_centavos: centavos });
      toast({ texto: `Posição adicionada em ${nomeMes(mesPos)}.` });
      setAtivo("");
      setValor("");
      aoSalvar(mesPos);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar a posição.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo="Posição manual">
      {!aberto ? (
        <>
          <Texto suave>Para instituições sem extrato lido, informe o saldo de cada posição. Vale para o mês escolhido e, depois, até que se informe outro mês para a mesma instituição.</Texto>
          <Botao rotulo="Adicionar posição manual" icone="mais" secundario onPress={() => setAberto(true)} />
        </>
      ) : (
        <View style={{ gap: 12 }}>
          <SeletorMes mes={mesPos} onChange={setMesPos} />
          <Campo rotulo="Instituição" value={instituicao} onChangeText={setInstituicao} placeholder="Ex.: nome do banco ou corretora" maxLength={60} />
          <View style={{ gap: 6 }}>
            <Texto suave pequeno>Classe de ativo</Texto>
            <GrupoChips>{CLASSES.map((c) => <Chip key={c} rotulo={ROTULO_CLASSE[c]} ativo={classe === c} onPress={() => setClasse(c)} />)}</GrupoChips>
          </View>
          <Campo rotulo="Descrição" value={ativo} onChangeText={setAtivo} placeholder="Ex.: título, fundo ou conta" maxLength={80} />
          <CampoValor rotulo={`Valor em ${nomeMes(mesPos)}`} value={valor} onChangeText={setValor} />
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Botao rotulo="Salvar posição" onPress={salvar} carregando={salvando} />
          <Botao rotulo="Fechar" secundario onPress={() => setAberto(false)} />
        </View>
      )}
    </Cartao>
  );
}
