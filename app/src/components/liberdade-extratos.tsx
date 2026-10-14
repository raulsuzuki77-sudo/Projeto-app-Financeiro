import { Platform, Text, View, Alert } from "react-native";
import { useTema } from "./tema";
import { useToast } from "./toast";
import { BotaoIcone, Cartao, Texto } from "./ui";
import { api, type DadosLiberdade } from "../lib/api";
import { dataBR, formatarBRL } from "../lib/format";
import { formatarMoeda, nomeDaConta } from "../lib/investimentos";

/** Extratos importados, com a conferência de cada um e a opção de removê-lo. */
export function LiberdadeExtratos({ extratos, aoMudar }: { extratos: DadosLiberdade["extratos"]; aoMudar: () => void }) {
  const t = useTema();
  const toast = useToast();
  if (extratos.length === 0) return null;

  function remover(x: DadosLiberdade["extratos"][number]) {
    const msg = `Remover o extrato de ${nomeDaConta(x)} (${dataBR(x.periodo_inicio)} a ${dataBR(x.periodo_fim)})? As posições e os movimentos dele saem do patrimônio. Você poderá importá-lo de novo.`;
    const feito = async () => {
      await api.removerExtratoInvestimento(x.id);
      toast({ texto: "Extrato removido." });
      aoMudar();
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(msg)) void feito();
      return;
    }
    Alert.alert("Remover extrato", msg, [{ text: "Cancelar", style: "cancel" }, { text: "Remover", style: "destructive", onPress: feito }]);
  }

  return (
    <Cartao titulo="Extratos importados">
      {extratos.map((x) => {
        const dif = x.total_declarado_centavos === null ? null : x.soma_posicoes_centavos - x.total_declarado_centavos;
        const situacao = dif === null ? "total declarado não localizado" : dif === 0 ? "soma confere com o total declarado" : `soma difere do total declarado em ${formatarMoeda(dif, x.moeda, formatarBRL)}`;
        return (
          <View key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56 }}>
            <View style={{ flex: 1 }} accessible accessibilityLabel={`${nomeDaConta(x)}, ${dataBR(x.periodo_inicio)} a ${dataBR(x.periodo_fim)}: ${situacao}`}>
              <Text style={{ color: t.texto, fontSize: 14, fontWeight: "600" }}>{nomeDaConta(x)}</Text>
              <Text style={{ color: t.suave, fontSize: 12 }}>{`${dataBR(x.periodo_inicio)} a ${dataBR(x.periodo_fim)} · ${x.posicoes} posições · ${x.movimentos} movimentos`}</Text>
              <Text style={{ color: dif === 0 ? t.ok : dif === null ? t.suave : t.perigo, fontSize: 12 }}>{`Soma ${formatarMoeda(x.soma_posicoes_centavos, x.moeda, formatarBRL)}: ${situacao}`}</Text>
            </View>
            <BotaoIcone icone="lixeira" rotulo={`Remover extrato de ${nomeDaConta(x)}, ${dataBR(x.periodo_fim)}`} cor={t.perigo} onPress={() => remover(x)} />
          </View>
        );
      })}
      <Texto suave pequeno>Cada extrato é identificado pelo conteúdo do arquivo: importar o mesmo PDF de novo não duplica nada.</Texto>
    </Cartao>
  );
}
