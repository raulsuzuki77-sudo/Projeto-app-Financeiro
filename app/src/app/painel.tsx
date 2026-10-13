import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { Barras } from "../components/barras";
import { SeletorMes } from "../components/seletor-mes";
import { useTema } from "../components/tema";
import { Aviso, Cartao, Texto } from "../components/ui";
import { api, type ResumoMensal } from "../lib/api";
import { formatarBRL, mesAtual } from "../lib/format";

function Indicador({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 140, gap: 2 }} accessible accessibilityLabel={`${rotulo}: ${valor}`}>
      <Texto suave>{rotulo}</Texto>
      <Texto forte cor={cor}>{valor}</Texto>
    </View>
  );
}

export default function Painel() {
  const t = useTema();
  const [mes, setMes] = useState(mesAtual());
  const [r, setR] = useState<ResumoMensal | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setErro(null);
      setR(await api.resumo(mes));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    }
  }, [mes]);
  useFocusEffect(useCallback(() => void carregar(), [carregar]));

  return (
    <ScrollView style={{ backgroundColor: t.fundo }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <SeletorMes mes={mes} onChange={setMes} />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {r ? (
        <>
          <Cartao titulo="Visao do mes">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
              <Indicador rotulo="Receitas" valor={formatarBRL(r.receitas_centavos)} cor={t.ok} />
              <Indicador rotulo="Despesas" valor={formatarBRL(r.despesas_centavos)} cor={t.perigo} />
              <Indicador rotulo="Investimentos" valor={formatarBRL(r.investimentos_centavos)} />
              <Indicador rotulo="Saldo" valor={formatarBRL(r.saldo_centavos)} cor={r.saldo_centavos < 0 ? t.perigo : t.ok} />
              <Indicador rotulo="Taxa de poupanca" valor={r.taxa_poupanca === null ? "sem receitas" : `${(r.taxa_poupanca * 100).toFixed(1).replace(".", ",")}%`} />
            </View>
            {r.pendentes > 0 ? <Aviso tipo="info">{`${r.pendentes} lancamento(s) pendente(s) de revisao entram nestes totais; confirme na aba Revisar.`}</Aviso> : null}
            <Texto suave>Transferencias (como o pagamento da fatura) nao contam como despesa.</Texto>
          </Cartao>
          <Cartao titulo="Despesas por categoria">
            {r.por_categoria.length ? <Barras dados={r.por_categoria.map((c) => ({ rotulo: c.categoria, valor: c.total_centavos }))} /> : <Texto suave>Sem despesas no mes.</Texto>}
          </Cartao>
          <Cartao titulo="Despesas por natureza">
            {r.por_natureza.length ? <Barras dados={r.por_natureza.map((c) => ({ rotulo: c.natureza, valor: c.total_centavos }))} /> : <Texto suave>Sem despesas no mes.</Texto>}
          </Cartao>
        </>
      ) : null}
    </ScrollView>
  );
}
