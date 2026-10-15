import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api } from "../lib/api";
import { formatarBRL, mascaraDeCentavos, nomeMes, reaisParaCentavos } from "../lib/format";
import type { FiltroDoPainel } from "./extrato-lista";
import { useTema } from "./tema";
import { Aviso, Botao, Cartao, CampoValor, Texto } from "./ui";

type Fechamento = Awaited<ReturnType<typeof api.fechamento>>;

/**
 * "Fechar o mês": mostra a conta de fechamento (receitas + resgates - despesas - aportes), compara a sobra com a que o usuário
 * espera deixar na conta e lista, com atalho, o que impede o mês de fechar. A diferença que sobra aparece como diferença.
 */
export function FecharMes({ mes, versao, aoVer }: { mes: string; versao: number; aoVer: (f: FiltroDoPainel) => void }) {
  const t = useTema();
  const router = useRouter();
  const [f, setF] = useState<Fechamento | null>(null);
  const [aberto, setAberto] = useState(false);
  const [sobra, setSobra] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.fechamento(mes).then((x) => { setF(x); setSobra(mascaraDeCentavos(x.sobra_esperada_centavos)); }, () => setF(null));
  }, [mes, versao]);
  if (!f) return null;

  async function salvarSobra() {
    const c = reaisParaCentavos(sobra);
    if (c === null || c < 0) return setErro("Informe um valor, por exemplo 250,00.");
    setErro(null);
    await api.definirSobraEsperada(c);
    setF(await api.fechamento(mes));
  }
  function abrir(acao: Fechamento["pendencias"][number]["acao"]) {
    if (acao === "sem_categoria") aoVer({ rotulo: "Sem categoria", categoria: "nao_classificado" });
    else if (acao === "transferencias_recebidas") aoVer({ rotulo: "Pix recebido de contas suas", tipo: "transferencia", busca: "Pix recebido" });
    else if (acao === "revisar" || acao === "faturas") router.push(acao === "faturas" ? "/importar" : "/revisar");
    else if (acao === "recorrentes_previstos") router.push("/recorrentes");
  }
  const cor = f.fecha ? t.ok : t.alerta;
  return (
    <Cartao titulo={`Fechar o mês, ${nomeMes(mes)}`}>
      <Text style={{ color: cor, fontSize: 16, fontWeight: "800" }}>{f.fecha ? "O mês fecha." : `Falta fechar: ${f.pendencias.filter((p) => p.gravidade === "impede").length} ponto(s) impedem.`}</Text>
      <Texto>{`Receitas ${formatarBRL(f.receitas_centavos)} + resgates ${formatarBRL(f.resgates_centavos)} - despesas ${formatarBRL(f.despesas_centavos)} - aportes ${formatarBRL(f.aportes_centavos)} = sobra de ${formatarBRL(f.sobra_centavos)}.`}</Texto>
      <Texto suave pequeno>{`Sobra esperada na conta: ${formatarBRL(f.sobra_esperada_centavos)}. Diferença não explicada: ${formatarBRL(f.diferenca_centavos)} (tolerância de ${formatarBRL(f.tolerancia_centavos)}).`}</Texto>
      <Botao rotulo={aberto ? "Ocultar a conferência" : "Ver a conferência do mês"} secundario pequeno onPress={() => setAberto(!aberto)} />
      {aberto ? (
        <View style={{ gap: 12 }}>
          {f.pendencias.length === 0 ? <Texto suave>Nenhuma pendência encontrada.</Texto> : null}
          {f.pendencias.map((p) => (
            <View key={p.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: t.borda, paddingTop: 8 }}>
              <Text style={{ color: p.gravidade === "impede" ? t.perigo : t.alerta, fontSize: 12, fontWeight: "800" }}>{p.gravidade === "impede" ? "IMPEDE O FECHAMENTO" : "ATENÇÃO"}</Text>
              <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>{p.titulo}{p.id.startsWith("cartao_") ? "" : ` (${p.id === "diferenca" ? formatarBRL(p.valor_centavos) : `${p.quantidade}${p.valor_centavos ? `, ${formatarBRL(p.valor_centavos)}` : ""}`})`}</Text>
              <Texto suave pequeno>{p.detalhe}</Texto>
              {p.acao && p.acao !== "sobra" ? <Botao rotulo={p.acao === "revisar" ? "Abrir a revisão" : p.acao === "faturas" ? "Importar documentos" : p.acao === "recorrentes_previstos" ? "Ver recorrentes" : "Ver os lançamentos"} pequeno secundario onPress={() => abrir(p.acao)} /> : null}
            </View>
          ))}
          <CampoValor rotulo="Quanto você costuma deixar na conta no fim do mês" value={sobra} onChangeText={setSobra} />
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Botao rotulo="Salvar sobra esperada" pequeno onPress={salvarSobra} />
        </View>
      ) : null}
    </Cartao>
  );
}
