import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { DeviceEventEmitter, RefreshControl, ScrollView, Text, View } from "react-native";
import { grupoDaCategoria, rotuloCategoria } from "../../../../core/src/index";
import { Barras } from "../../components/barras";
import { ExtratoLista, type FiltroDoPainel } from "../../components/extrato-lista";
import { FecharMes } from "../../components/fechar-mes";
import { ParticipacaoClasses } from "../../components/participacao-classes";
import { SeletorMes } from "../../components/seletor-mes";
import { useTema } from "../../components/tema";
import { Aviso, Cartao, Segmentado, Texto } from "../../components/ui";
import { EVENTO_DADOS_MUDARAM, useBotaoAtualizar, useDados } from "../../hooks/useDados";
import { api } from "../../lib/api";
import { DIAS_SEMANA, formatarBRL, intensidade, mesAtual } from "../../lib/format";

type Secao = "resumo" | "calendario" | "extrato";

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

const ROTULO_NATUREZA = (n: string) => rotuloCategoria(n);

export default function Painel() {
  const t = useTema();
  const params = useLocalSearchParams<{ secao?: string }>();
  const [mes, setMes] = useState(mesAtual());
  const [secao, setSecao] = useState<Secao>(params.secao === "extrato" ? "extrato" : "resumo");
  /** Filtro escolhido num gráfico do resumo: a seção Extrato mostra só os lançamentos dele, sem sair do Painel. */
  const [filtro, setFiltro] = useState<FiltroDoPainel | null>(null);

  const { dados, erro, carregando, recarregar } = useDados(async () => {
    const [resumo, dias, orcamento] = await Promise.all([api.resumo(mes), api.calendario(mes), api.orcamento(mes)]);
    return { resumo, dias, orcamento };
  }, [mes]);
  // O botão do cabeçalho atualiza o Painel e a lista de lançamentos (que ouve o mesmo evento).
  useBotaoAtualizar(() => DeviceEventEmitter.emit(EVENTO_DADOS_MUDARAM));

  const r = dados?.resumo;
  const porData = useMemo(() => new Map((dados?.dias ?? []).map((d) => [d.data, d])), [dados]);
  const maxDia = Math.max(0, ...(dados?.dias ?? []).map((d) => d.total_centavos));
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const celulasMes = [...Array<null>(new Date(a, m - 1, 1).getDay()).fill(null), ...Array.from({ length: new Date(a, m, 0).getDate() }, (_, i) => i + 1)];

  function ver(f: FiltroDoPainel) {
    setFiltro(f);
    setSecao("extrato");
  }
  const categoriasDoGrupo = (g: string) => (r?.por_categoria ?? []).map((c) => c.categoria).filter((c) => grupoDaCategoria(c) === g);

  const cabecalho = (
    <View style={{ gap: 16 }}>
      <SeletorMes mes={mes} onChange={setMes} />
      <Segmentado rotulo="Seção do painel" valor={secao} onChange={(s) => { setSecao(s); if (s !== "extrato") setFiltro(null); }} opcoes={[{ id: "resumo", rotulo: "Resumo" }, { id: "calendario", rotulo: "Calendário" }, { id: "extrato", rotulo: "Extrato" }]} />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </View>
  );

  if (secao === "extrato") {
    return <ExtratoLista mes={mes} filtroPainel={filtro} aoLimparFiltroPainel={() => setFiltro(null)} topo={cabecalho} />;
  }

  const fechamento = r ? r.receitas_centavos + r.resgates_centavos - r.despesas_centavos - r.investimentos_centavos : 0;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}>
      {cabecalho}

      {secao === "resumo" && r ? (
        <>
          <Cartao titulo="Visão do mês">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
              <Indicador rotulo="Receitas" valor={formatarBRL(r.receitas_centavos)} cor={t.receita} />
              <Indicador rotulo="Despesas" valor={formatarBRL(r.despesas_centavos)} cor={t.despesa} />
              <Indicador rotulo="Investimentos (aportes)" valor={formatarBRL(r.investimentos_centavos)} />
              <Indicador rotulo="Resgates de investimentos e caixinhas" valor={formatarBRL(r.resgates_centavos)} />
              <Indicador rotulo="Sobra do mês (deve ficar perto do que você deixa na conta)" valor={formatarBRL(r.saldo_centavos)} cor={r.saldo_centavos < 0 ? t.despesa : t.receita} />
              <Indicador rotulo="Taxa de poupança" valor={r.taxa_poupanca === null ? "sem receitas" : `${(r.taxa_poupanca * 100).toFixed(1).replace(".", ",")}%`} />
            </View>
            <Texto suave pequeno>{`Conta de fechamento: receitas ${formatarBRL(r.receitas_centavos)} + resgates ${formatarBRL(r.resgates_centavos)} - despesas ${formatarBRL(r.despesas_centavos)} - aportes ${formatarBRL(r.investimentos_centavos)} = ${formatarBRL(fechamento)}.`}</Texto>
            {r.transferencias_recebidas_centavos > 0 ? (
              <Aviso tipo="info">{`${formatarBRL(r.transferencias_recebidas_centavos)} chegaram por Pix de contas suas e estão como transferência, fora das receitas. Se for o seu custo de vida mensal (como a transferência do C6), reclassifique um deles como "Custo de vida" no Extrato: ele passa a contar como entrada e o mês fecha.`}</Aviso>
            ) : null}
            {r.pendentes > 0 ? <Aviso tipo="info">{`${r.pendentes} lançamento(s) pendente(s) entram nestes totais; confirme no botão de revisão do Início.`}</Aviso> : null}
            <Texto suave pequeno>Transferências (como o pagamento da fatura) não contam como despesa. Toque numa barra ou numa fatia dos gráficos para ver os lançamentos.</Texto>
          </Cartao>
          <FecharMes mes={mes} versao={dados?.resumo.saldo_centavos ?? 0} aoVer={ver} />
          {dados?.orcamento && dados.orcamento.mes === mes ? (
            <ParticipacaoClasses
              painel={dados.orcamento}
              pizza
              aoMudar={recarregar}
              aoTocarClasse={(c) => ver({ rotulo: `Classe: ${c.rotulo}`, categorias: c.itens.map((i) => i.categoria) })}
            />
          ) : null}
          <Cartao titulo="Despesas por categoria">
            {r.por_categoria.length ? <Barras dados={r.por_categoria.map((c) => ({ rotulo: c.categoria, valor: c.total_centavos }))} aoTocar={(c) => ver({ rotulo: `Categoria: ${rotuloCategoria(c)}`, categoria: c })} /> : <Texto suave>Sem despesas no mês.</Texto>}
          </Cartao>
          <Cartao titulo="Despesas por natureza">
            {r.por_natureza.length ? <Barras dados={r.por_natureza.map((c) => ({ rotulo: c.natureza, valor: c.total_centavos }))} aoTocar={(n) => ver({ rotulo: `Natureza: ${ROTULO_NATUREZA(n)}`, natureza: n })} /> : <Texto suave>Sem despesas no mês.</Texto>}
          </Cartao>
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
    </ScrollView>
  );
}
