import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Barras } from "../../components/barras";
import { SeletorMes } from "../../components/seletor-mes";
import { useTema } from "../../components/tema";
import { Aviso, Cartao, Segmentado, Texto } from "../../components/ui";
import { useBotaoAtualizar, useDados } from "../../hooks/useDados";
import { api, type MapaCalor } from "../../lib/api";
import { DIAS_SEMANA, formatarBRL, intensidade, mesAtual, ultimoDia } from "../../lib/format";

type Secao = "resumo" | "calendario" | "horarios";

function fundo(base: string, nivel: number): string {
  const a = nivel === 0 ? 0 : 0.15 + nivel * 0.75;
  return `${base}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
}

function Indicador({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 140, gap: 2 }} accessible accessibilityLabel={`${rotulo}: ${valor}`}>
      <Texto suave pequeno>{rotulo}</Texto>
      <Texto forte cor={cor}>{valor}</Texto>
    </View>
  );
}

export default function Painel() {
  const t = useTema();
  const [mes, setMes] = useState(mesAtual());
  const [secao, setSecao] = useState<Secao>("resumo");

  const { dados, erro, carregando, recarregar } = useDados(async () => {
    const [resumo, dias, calor] = await Promise.all([api.resumo(mes), api.calendario(mes), api.mapaCalor(`${mes}-01`, ultimoDia(mes))]);
    return { resumo, dias, calor };
  }, [mes]);
  useBotaoAtualizar(recarregar);

  const r = dados?.resumo;
  const calor: MapaCalor | undefined = dados?.calor;
  const porData = useMemo(() => new Map((dados?.dias ?? []).map((d) => [d.data, d])), [dados]);
  const maxDia = Math.max(0, ...(dados?.dias ?? []).map((d) => d.total_centavos));
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const celulasMes = [...Array<null>(new Date(a, m - 1, 1).getDay()).fill(null), ...Array.from({ length: new Date(a, m, 0).getDate() }, (_, i) => i + 1)];
  const faixas = [[0, 6], [6, 12], [12, 18], [18, 24]] as const;
  const celulas = calor?.celulas ?? [];
  const porDiaSemana = DIAS_SEMANA.map((_, i) => celulas.filter((c) => c.dia_semana === i).reduce((s, c) => s + c.total_centavos, 0));
  const maxSemana = Math.max(0, ...porDiaSemana);
  const porFaixa = faixas.map(([i, f]) => celulas.filter((c) => c.hora >= i && c.hora < f).reduce((s, c) => s + c.total_centavos, 0));
  const maxFaixa = Math.max(0, ...porFaixa);
  const celula = (d: number, f: number) => celulas.filter((c) => c.dia_semana === d && c.hora >= faixas[f]![0] && c.hora < faixas[f]![1]).reduce((s, c) => s + c.total_centavos, 0);
  const maxCelula = Math.max(0, ...DIAS_SEMANA.flatMap((_, d) => faixas.map((__, f) => celula(d, f))));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}>
      <SeletorMes mes={mes} onChange={setMes} />
      <Segmentado rotulo="Seção do painel" valor={secao} onChange={setSecao} opcoes={[{ id: "resumo", rotulo: "Resumo" }, { id: "calendario", rotulo: "Calendário" }, { id: "horarios", rotulo: "Horários" }]} />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {secao === "resumo" && r ? (
        <>
          <Cartao titulo="Visão do mês">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
              <Indicador rotulo="Receitas" valor={formatarBRL(r.receitas_centavos)} cor={t.receita} />
              <Indicador rotulo="Despesas" valor={formatarBRL(r.despesas_centavos)} cor={t.despesa} />
              <Indicador rotulo="Investimentos" valor={formatarBRL(r.investimentos_centavos)} />
              <Indicador rotulo="Saldo" valor={formatarBRL(r.saldo_centavos)} cor={r.saldo_centavos < 0 ? t.despesa : t.receita} />
              <Indicador rotulo="Taxa de poupança" valor={r.taxa_poupanca === null ? "sem receitas" : `${(r.taxa_poupanca * 100).toFixed(1).replace(".", ",")}%`} />
            </View>
            {r.pendentes > 0 ? <Aviso tipo="info">{`${r.pendentes} lançamento(s) pendente(s) entram nestes totais; confirme na aba Revisar.`}</Aviso> : null}
            <Texto suave pequeno>Transferências (como o pagamento da fatura) não contam como despesa.</Texto>
          </Cartao>
          <Cartao titulo="Despesas por categoria">{r.por_categoria.length ? <Barras dados={r.por_categoria.map((c) => ({ rotulo: c.categoria, valor: c.total_centavos }))} /> : <Texto suave>Sem despesas no mês.</Texto>}</Cartao>
          <Cartao titulo="Despesas por natureza">{r.por_natureza.length ? <Barras dados={r.por_natureza.map((c) => ({ rotulo: c.natureza, valor: c.total_centavos }))} /> : <Texto suave>Sem despesas no mês.</Texto>}</Cartao>
        </>
      ) : null}

      {secao === "calendario" ? (
        <Cartao titulo="Gastos por dia">
          <View style={{ flexDirection: "row" }}>{DIAS_SEMANA.map((d) => <View key={d} style={{ flex: 1, alignItems: "center" }}><Texto suave pequeno>{d}</Texto></View>)}</View>
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
          <Texto suave pequeno>Valores em reais, arredondados. A intensidade da cor indica o volume gasto no dia.</Texto>
        </Cartao>
      ) : null}

      {secao === "horarios" ? (
        <Cartao titulo="Quando você mais gasta">
          {celulas.length > 0 ? (
            <>
              <Texto>Dia da semana de maior gasto: {maxSemana > 0 ? `${DIAS_SEMANA[porDiaSemana.indexOf(maxSemana)]} (${formatarBRL(maxSemana)})` : "sem dados"}.</Texto>
              <Texto>Faixa de horário de maior gasto: {maxFaixa > 0 ? `${faixas[porFaixa.indexOf(maxFaixa)]![0]}h às ${faixas[porFaixa.indexOf(maxFaixa)]![1]}h (${formatarBRL(maxFaixa)})` : "sem dados"}.</Texto>
              <View style={{ flexDirection: "row", gap: 2 }}>
                <View style={{ width: 52 }} />
                {faixas.map(([i, f]) => <View key={i} style={{ flex: 1, alignItems: "center" }}><Texto suave pequeno>{`${i}-${f}h`}</Texto></View>)}
              </View>
              {DIAS_SEMANA.map((nome, d) => (
                <View key={nome} style={{ flexDirection: "row", gap: 2, alignItems: "center" }}>
                  <View style={{ width: 52 }}><Texto suave pequeno>{nome}</Texto></View>
                  {faixas.map((_, f) => {
                    const v = celula(d, f);
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
            <Texto suave>Ainda não há gastos com horário conhecido neste mês.</Texto>
          )}
          {calor && calor.excluidos_sem_horario > 0 ? <Aviso tipo="info">{`${calor.excluidos_sem_horario} gasto(s) sem horário confiável (faturas e extratos trazem só a data) ficaram fora desta análise.`}</Aviso> : null}
          <Texto suave pequeno>Gastos lançados na hora, pelo aplicativo, têm horário aproximado (o do registro).</Texto>
        </Cartao>
      ) : null}
    </ScrollView>
  );
}
