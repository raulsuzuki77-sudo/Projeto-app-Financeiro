import { useState } from "react";
import { Text, View } from "react-native";
import { useTema } from "./tema";
import { useToast } from "./toast";
import { Aviso, Botao, BotaoIcone, Campo, Cartao, Texto } from "./ui";
import { api, type DadosLiberdade } from "../lib/api";
import { nomeMes } from "../lib/format";
import { lerTaxaCambio, textoTaxa } from "../lib/investimentos";

/** Taxa para converter dólar em reais, por mês, informada pelo usuário. */
export function LiberdadeCambio({ mes, cambios, temMoedaEstrangeira, aoMudar }: { mes: string; cambios: DadosLiberdade["cambios"]; temMoedaEstrangeira: boolean; aoMudar: () => void }) {
  const t = useTema();
  const toast = useToast();
  const doMes = cambios.find((c) => c.mes === mes && c.moeda === "USD");
  const [taxa, setTaxa] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  if (!temMoedaEstrangeira && cambios.length === 0) return null;

  async function salvar() {
    const n = lerTaxaCambio(taxa);
    if (n === null) return setErro("Taxa inválida. Use números como 5,4321.");
    try {
      setErro(null);
      await api.definirCambio(mes, "USD", n);
      setTaxa("");
      toast({ texto: `Taxa do dólar de ${nomeMes(mes)} salva.` });
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar a taxa.");
    }
  }

  return (
    <Cartao titulo="Câmbio">
      <Texto suave>Taxa do dólar que você considera para converter as contas em dólar em reais (por exemplo, a do último dia do mês).</Texto>
      <Text style={{ color: t.texto, fontSize: 15 }} accessibilityLabel={doMes ? `Taxa de ${nomeMes(mes)}: ${textoTaxa(doMes.taxa_x10000)} reais por dólar` : `Sem taxa informada para ${nomeMes(mes)}`}>
        {doMes ? `${nomeMes(mes)}: R$ ${textoTaxa(doMes.taxa_x10000)} por dólar` : `${nomeMes(mes)}: sem taxa informada`}
      </Text>
      <Campo rotulo={`Taxa do dólar em ${nomeMes(mes)}`} prefixo="R$" placeholder={doMes ? textoTaxa(doMes.taxa_x10000) : "0,0000"} keyboardType="decimal-pad" value={taxa} onChangeText={setTaxa} />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <Botao rotulo={doMes ? "Alterar taxa do mês" : "Salvar taxa do mês"} onPress={salvar} />
      {cambios.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Texto suave pequeno>Taxas informadas</Texto>
          {cambios.map((c) => (
            <View key={`${c.mes}-${c.moeda}`} style={{ flexDirection: "row", alignItems: "center", minHeight: 44, gap: 8 }}>
              <Text style={{ flex: 1, color: t.texto, fontSize: 14 }}>{`${nomeMes(c.mes)}: ${c.moeda} a R$ ${textoTaxa(c.taxa_x10000)}`}</Text>
              <BotaoIcone
                icone="lixeira"
                rotulo={`Remover taxa de ${nomeMes(c.mes)}`}
                cor={t.perigo}
                onPress={async () => {
                  await api.removerCambio(c.mes, c.moeda);
                  aoMudar();
                }}
              />
            </View>
          ))}
        </View>
      ) : null}
    </Cartao>
  );
}
