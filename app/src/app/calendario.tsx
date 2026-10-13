import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SeletorMes } from "../components/seletor-mes";
import { useTema } from "../components/tema";
import { Aviso, Cartao, Texto } from "../components/ui";
import { api, type MapaCalor } from "../lib/api";
import { DIAS_SEMANA, formatarBRL, intensidade, mesAtual, ultimoDia } from "../lib/format";

type Dia = { data: string; total_centavos: number; quantidade: number };

/** Cor de fundo com opacidade proporcional; o valor também aparece em texto (não depende só de cor). */
function fundo(base: string, nivel: number): string {
  const a = nivel === 0 ? 0 : 0.15 + nivel * 0.75;
  return `${base}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
}

export default function Gastos() {
  const t = useTema();
  const [mes, setMes] = useState(mesAtual());
  const [dias, setDias] = useState<Dia[]>([]);
  const [calor, setCalor] = useState<MapaCalor | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setErro(null);
      const [d, m] = await Promise.all([api.calendario(mes), api.mapaCalor(`${mes}-01`, ultimoDia(mes))]);
      setDias(d);
      setCalor(m);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    }
  }, [mes]);
  useFocusEffect(useCallback(() => void carregar(), [carregar]));

  const porData = useMemo(() => new Map(dias.map((d) => [d.data, d])), [dias]);
  const maxDia = Math.max(0, ...dias.map((d) => d.total_centavos));
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const total = new Date(a, m, 0).getDate();
  const offset = new Date(a, m - 1, 1).getDay();
  const celulasMes = [...Array<null>(offset).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];

  const maiorDia = dias.reduce<Dia | null>((x, d) => (!x || d.total_centavos > x.total_centavos ? d : x), null);
  const porDiaSemana = DIAS_SEMANA.map((_, i) => (calor?.celulas ?? []).filter((c) => c.dia_semana === i).reduce((s, c) => s + c.total_centavos, 0));
  const maxSemana = Math.max(0, ...porDiaSemana);
  const melhorSemana = maxSemana > 0 ? porDiaSemana.indexOf(maxSemana) : -1;
  const faixas = [[0, 6], [6, 12], [12, 18], [18, 24]] as const;
  const porFaixa = faixas.map(([i, f]) => (calor?.celulas ?? []).filter((c) => c.hora >= i && c.hora < f).reduce((s, c) => s + c.total_centavos, 0));
  const maxFaixa = Math.max(0, ...porFaixa);
  const maxCelula = Math.max(0, ...(calor?.celulas ?? []).map((c) => c.total_centavos));
  const celulaMapa = (dia: number, faixa: number) =>
    (calor?.celulas ?? []).filter((c) => c.dia_semana === dia && c.hora >= faixas[faixa]![0] && c.hora < faixas[faixa]![1]).reduce((s, c) => s + c.total_centavos, 0);

  return (
    <ScrollView style={{ backgroundColor: t.fundo }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <SeletorMes mes={mes} onChange={setMes} />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      <Cartao titulo="Gastos por dia">
        <View style={{ flexDirection: "row" }}>
          {DIAS_SEMANA.map((d) => <View key={d} style={{ flex: 1, alignItems: "center" }}><Texto suave>{d}</Texto></View>)}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {celulasMes.map((dia, i) => {
            const info = dia ? porData.get(`${mes}-${String(dia).padStart(2, "0")}`) : undefined;
            return (
              <View key={i} style={{ width: `${100 / 7}%`, padding: 2 }}>
                {dia ? (
                  <View accessible accessibilityLabel={`Dia ${dia}: ${info ? formatarBRL(info.total_centavos) : "sem gastos"}`} style={{ minHeight: 54, borderRadius: 8, borderWidth: 1, borderColor: t.borda, backgroundColor: info ? fundo(t.barra, intensidade(info.total_centavos, maxDia)) : "transparent", padding: 3, alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ color: t.texto, fontSize: 12, fontWeight: "600" }}>{dia}</Text>
                    <Text style={{ color: t.texto, fontSize: 10 }}>{info ? Math.round(info.total_centavos / 100) : ""}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
        <Texto suave>Valores em reais, arredondados. Maior gasto do mes: {maiorDia ? `${maiorDia.data.slice(8)}/${mes.slice(5)} (${formatarBRL(maiorDia.total_centavos)})` : "sem dados"}.</Texto>
      </Cartao>

      <Cartao titulo="Quando voce mais gasta">
        {calor && calor.celulas.length > 0 ? (
          <>
            <Texto>Dia da semana de maior gasto: {melhorSemana >= 0 ? `${DIAS_SEMANA[melhorSemana]} (${formatarBRL(maxSemana)})` : "sem dados"}.</Texto>
            <Texto>Faixa de horario de maior gasto: {maxFaixa > 0 ? `${faixas[porFaixa.indexOf(maxFaixa)]![0]}h as ${faixas[porFaixa.indexOf(maxFaixa)]![1]}h (${formatarBRL(maxFaixa)})` : "sem dados"}.</Texto>
            <View style={{ flexDirection: "row", gap: 2 }}>
              <View style={{ width: 52 }} />
              {faixas.map(([i, f]) => <View key={i} style={{ flex: 1, alignItems: "center" }}><Texto suave>{`${i}-${f}h`}</Texto></View>)}
            </View>
            {DIAS_SEMANA.map((nome, d) => (
              <View key={nome} style={{ flexDirection: "row", gap: 2, alignItems: "center" }}>
                <View style={{ width: 52 }}><Texto suave>{nome}</Texto></View>
                {faixas.map((_, f) => {
                  const v = celulaMapa(d, f);
                  return (
                    <View key={f} accessible accessibilityLabel={`${nome}, ${faixas[f]![0]} a ${faixas[f]![1]} horas: ${formatarBRL(v)}`} style={{ flex: 1, minHeight: 34, borderRadius: 6, borderWidth: 1, borderColor: t.borda, backgroundColor: v ? fundo(t.barra, intensidade(v, maxCelula)) : "transparent", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: t.texto, fontSize: 11 }}>{v ? Math.round(v / 100) : ""}</Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        ) : (
          <Texto suave>Ainda nao ha gastos com horario conhecido neste mes.</Texto>
        )}
        {calor && calor.excluidos_sem_horario > 0 ? <Aviso tipo="info">{`${calor.excluidos_sem_horario} gasto(s) sem horario confiavel (faturas e extratos trazem so a data) ficaram fora desta analise.`}</Aviso> : null}
        <Texto suave>Gastos lancados na hora, pelo aplicativo, tem horario aproximado (o da mensagem).</Texto>
      </Cartao>
    </ScrollView>
  );
}
