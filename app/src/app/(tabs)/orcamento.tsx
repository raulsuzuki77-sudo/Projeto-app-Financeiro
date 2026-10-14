import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { ITEM_RECEITA } from "../../../../core/src/index";
import { BarraProgresso } from "../../components/barra-progresso";
import { Icone } from "../../components/icone";
import { EditorItem, EscolherCategoria, SugestaoMedia, type AlvoEdicao } from "../../components/orcamento-folhas";
import { ParticipacaoClasses } from "../../components/participacao-classes";
import { SeletorMes } from "../../components/seletor-mes";
import { useTema } from "../../components/tema";
import { useToast } from "../../components/toast";
import { Aviso, Botao, Cartao, Texto } from "../../components/ui";
import { useBotaoAtualizar, useDados } from "../../hooks/useDados";
import { api, type PainelOrcamento } from "../../lib/api";
import { formatarBRL, formatarPercentual, mesAtual, mudarMes, nomeMes } from "../../lib/format";

type Classe = PainelOrcamento["classes"][number];
type Item = Classe["itens"][number];
type Sugestao = { item: string; rotulo: string; valor_centavos: number };

const ORIGEM = { mes: "valor deste mês", padrao: "padrão de todos os meses" } as const;
const ROTULO_ALERTA = { estourou: "Estourou", atencao: "Atenção", sem_plano: "Sem plano" } as const;

function Par({ rotulo, valor, cor, vazio }: { rotulo: string; valor: string; cor?: string; vazio?: boolean }) {
  const t = useTema();
  return (
    <View style={{ flex: 1, gap: 1 }}>
      <Text style={{ color: t.suave, fontSize: 12 }}>{rotulo}</Text>
      {vazio ? <Text style={{ color: t.suave, fontSize: 14, fontStyle: "italic" }}>{valor}</Text> : <Text style={{ color: cor ?? t.texto, fontSize: 15, fontWeight: "700" }}>{valor}</Text>}
    </View>
  );
}

function LinhaResumo({ rotulo, planejado, realizado, corReal, corPlan }: { rotulo: string; planejado: string; realizado: string; corReal?: string; corPlan?: string }) {
  const t = useTema();
  return (
    <View accessible accessibilityLabel={`${rotulo}: planejado ${planejado}, realizado ${realizado}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ flex: 1.1, color: t.texto, fontSize: 14, fontWeight: "600" }}>{rotulo}</Text>
      <Text style={{ flex: 1, textAlign: "right", color: corPlan ?? t.texto, fontSize: 14, fontWeight: "700" }}>{planejado}</Text>
      <Text style={{ flex: 1, textAlign: "right", color: corReal ?? t.texto, fontSize: 14, fontWeight: "700" }}>{realizado}</Text>
    </View>
  );
}

function LinhaItem({ item, onPress }: { item: Item; onPress: () => void }) {
  const t = useTema();
  const semPlano = item.planejado_centavos <= 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.rotulo}: realizado ${formatarBRL(item.realizado_centavos)}, ${semPlano ? "sem valor planejado" : `planejado ${formatarBRL(item.planejado_centavos)}`}. Toque para editar.`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 44, paddingVertical: 8, gap: 6, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, color: t.texto, fontSize: 15, fontWeight: "600" }}>{item.rotulo}</Text>
        <Icone nome="editar" cor={t.suave} tamanho={16} />
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Par rotulo="Realizado" valor={formatarBRL(item.realizado_centavos)} />
        <Par rotulo="Planejado" valor={semPlano ? "sem valor planejado" : formatarBRL(item.planejado_centavos)} vazio={semPlano} />
      </View>
      <BarraProgresso planejado={item.planejado_centavos} realizado={item.realizado_centavos} />
      {item.aplicado_centavos !== undefined ? (
        <Text style={{ color: t.suave, fontSize: 12 }}>
          {`Caixinhas: aplicado ${formatarBRL(item.aplicado_centavos)}, resgatado ${formatarBRL(item.resgatado_centavos ?? 0)}. O resgate é uso do que foi provisionado e não reduz o realizado abaixo de zero.`}
        </Text>
      ) : null}
      <Text style={{ color: t.suave, fontSize: 12 }}>
        {item.origem_plano ? `Origem do valor: ${ORIGEM[item.origem_plano]}` : "Origem do valor: não definida"}
        {item.pendentes > 0 ? ` · ${item.pendentes} pendente(s) de revisão` : ""}
      </Text>
    </Pressable>
  );
}

function SecaoClasse({ classe, aberta, onAlternar, onItem }: { classe: Classe; aberta: boolean; onAlternar: () => void; onItem: (i: Item) => void }) {
  const t = useTema();
  return (
    <Cartao>
      <View style={{ gap: 6 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: aberta }} accessibilityLabel={`${classe.rotulo}: ${aberta ? "recolher" : "expandir"} (${classe.itens.length} item(ns))`} onPress={onAlternar} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
          <Text accessibilityRole="header" style={{ color: t.primaria, fontSize: 18, fontWeight: "800", flex: 1 }}>{classe.rotulo}</Text>
          <Text style={{ color: t.suave, fontSize: 13, marginRight: 8 }}>{classe.itens.length} item(ns)</Text>
          <View style={{ transform: [{ rotate: aberta ? "90deg" : "0deg" }] }}><Icone nome="seta" cor={t.suave} tamanho={20} /></View>
        </Pressable>
        {classe.itens.length > 0 ? (
          <>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Par rotulo="Total realizado" valor={formatarBRL(classe.realizado_centavos)} />
              <Par rotulo="Total planejado" valor={classe.planejado_centavos > 0 ? formatarBRL(classe.planejado_centavos) : "sem valor planejado"} vazio={classe.planejado_centavos <= 0} />
              <Par rotulo="Na receita" valor={formatarPercentual(classe.percentual_receita)} cor={classe.acima_do_limite ? t.perigo : undefined} vazio={classe.percentual_receita === null} />
            </View>
            {classe.limite_percentual !== null ? <Text style={{ color: classe.acima_do_limite ? t.perigo : t.suave, fontSize: 12 }}>{classe.acima_do_limite ? `Acima do limite de ${formatarPercentual(classe.limite_percentual, 0)} da receita.` : `Dentro do limite de ${formatarPercentual(classe.limite_percentual, 0)} da receita.`}</Text> : null}
            <BarraProgresso planejado={classe.planejado_centavos} realizado={classe.realizado_centavos} />
          </>
        ) : (
          <Texto suave pequeno>{`Sem itens neste mês. ${classe.exemplos}.`}</Texto>
        )}
      </View>
      {aberta && classe.itens.length > 0 ? (
        <View style={{ marginLeft: 14, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: t.borda, gap: 4 }}>
          {classe.itens.map((i, k) => (
            <View key={i.categoria} style={k > 0 ? { borderTopWidth: 1, borderTopColor: t.borda } : undefined}>
              <LinhaItem item={i} onPress={() => onItem(i)} />
            </View>
          ))}
        </View>
      ) : null}
    </Cartao>
  );
}

export default function Orcamento() {
  const t = useTema();
  const router = useRouter();
  const toast = useToast();
  const [mes, setMes] = useState(mesAtual());
  const [alvo, setAlvo] = useState<AlvoEdicao | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [sugestoes, setSugestoes] = useState<Sugestao[] | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmaCopia, setConfirmaCopia] = useState(false);
  const [todosAlertas, setTodosAlertas] = useState(false);
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});

  const { dados, erro, carregando, recarregar } = useDados(async () => {
    const [painel, vs, parcelas] = await Promise.all([api.orcamento(mes), api.orcamentoVsMetas(mes), api.parcelasFuturas(mesAtual(), 6)]);
    return { painel, vs, parcelas };
  }, [mes]);
  useBotaoAtualizar(recarregar);

  const painel = dados && dados.painel.mes === mes ? dados.painel : null;
  const vs = painel && dados ? dados.vs : null;
  const anterior = mudarMes(mes, -1);

  const todosItens = useMemo(() => (painel ? painel.classes.flatMap((c) => c.itens.map((i) => ({ i, classe: c.id }))) : []), [painel]);

  const atuais = useMemo(() => {
    const m = new Map<string, { valor: number; origem: "mes" | "padrao" | null }>();
    if (!painel) return m;
    for (const { i } of todosItens) m.set(i.categoria, { valor: i.planejado_centavos, origem: i.origem_plano });
    m.set(ITEM_RECEITA, { valor: painel.receita.planejada_centavos, origem: painel.receita.origem_plano });
    return m;
  }, [painel, todosItens]);

  const planejados = useMemo(() => new Map(todosItens.filter((x) => x.i.planejado_centavos > 0).map((x) => [x.i.categoria, x.i.planejado_centavos])), [todosItens]);
  const proprios = todosItens.filter((x) => x.i.origem_plano === "mes").length + (painel?.receita.origem_plano === "mes" ? 1 : 0);

  function alvoDoItem(i: Item, classe: Classe["id"]): AlvoEdicao {
    return { item: i.categoria, rotulo: i.rotulo, planejado: i.planejado_centavos, realizado: i.realizado_centavos, origem: i.origem_plano, classe };
  }

  function editarReceita() {
    if (!painel) return;
    const r = painel.receita;
    setAlvo({ item: ITEM_RECEITA, rotulo: "Receita do mês", planejado: r.planejada_centavos, realizado: r.realizada_centavos, origem: r.origem_plano, classe: null });
  }

  function editarAlerta(item: string) {
    const achado = todosItens.find((x) => x.i.categoria === item);
    if (achado) setAlvo(alvoDoItem(achado.i, achado.classe));
  }

  function escolherCategoria(id: string) {
    if (!painel) return;
    setEscolhendo(false);
    const achado = todosItens.find((x) => x.i.categoria === id);
    const cat = painel.categorias.find((c) => c.id === id);
    const proximo: AlvoEdicao | null = achado ? alvoDoItem(achado.i, achado.classe) : cat ? { item: cat.id, rotulo: cat.rotulo, planejado: 0, realizado: 0, origem: null, classe: cat.classe } : null;
    setTimeout(() => setAlvo(proximo), Platform.OS === "ios" ? 450 : 0);
  }

  function concluido(mensagem: string) {
    setAlvo(null);
    setSugestoes(null);
    setEscolhendo(false);
    void recarregar();
    toast({ texto: mensagem });
  }

  async function copiar() {
    setOcupado(true);
    setErroAcao(null);
    setConfirmaCopia(false);
    try {
      const n = await api.copiarOrcamento(anterior, mes);
      await recarregar();
      toast({ texto: n > 0 ? `${n} item(ns) copiado(s) de ${nomeMes(anterior)} para ${nomeMes(mes)}.` : `${nomeMes(anterior)} não tem valores planejados; nada foi copiado.` });
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : "Não foi possível copiar o orçamento.");
    } finally {
      setOcupado(false);
    }
  }

  async function sugerir() {
    setOcupado(true);
    setErroAcao(null);
    try {
      setSugestoes(await api.sugerirOrcamento(mes));
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : "Não foi possível calcular a sugestão.");
    } finally {
      setOcupado(false);
    }
  }

  const semOrcamento = !!painel && painel.despesa.planejada_centavos <= 0 && painel.receita.planejada_centavos <= 0;
  const alertas = painel?.alertas ?? [];
  const alertasVistos = todosAlertas ? alertas : alertas.slice(0, 5);

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}>
        <SeletorMes mes={mes} onChange={(m) => { setMes(m); setConfirmaCopia(false); setTodosAlertas(false); setErroAcao(null); }} />
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        {erroAcao ? <Aviso tipo="erro">{erroAcao}</Aviso> : null}
        {!painel && !erro ? <Texto suave>Carregando o orçamento...</Texto> : null}

        {painel ? (
          <>
            <Cartao titulo={`Resumo de ${nomeMes(mes)}`}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1.1 }} />
                <Text style={{ flex: 1, textAlign: "right", color: t.suave, fontSize: 12 }}>Planejado</Text>
                <Text style={{ flex: 1, textAlign: "right", color: t.suave, fontSize: 12 }}>Realizado</Text>
              </View>
              <LinhaResumo rotulo="Receita" planejado={formatarBRL(painel.receita.planejada_centavos)} realizado={formatarBRL(painel.receita.realizada_centavos)} />
              <LinhaResumo rotulo="Despesas e aportes" planejado={formatarBRL(painel.despesa.planejada_centavos)} realizado={formatarBRL(painel.despesa.realizada_centavos)} />
              <LinhaResumo
                rotulo="Superávit"
                planejado={formatarBRL(painel.superavit.planejado_centavos)}
                realizado={formatarBRL(painel.superavit.realizado_centavos)}
                corPlan={painel.superavit.planejado_centavos < 0 ? t.despesa : t.receita}
                corReal={painel.superavit.realizado_centavos < 0 ? t.despesa : t.receita}
              />
              <Texto suave pequeno>{`Superávit diário planejado: ${formatarBRL(painel.superavit_diario_planejado_centavos)} por dia.`}</Texto>
              {painel.receita.planejada_centavos <= 0 ? (
                <View style={{ gap: 8 }}>
                  <Texto>Informe a receita planejada do mês para calcular o superávit planejado.</Texto>
                  <Botao rotulo="Informar receita planejada" pequeno onPress={editarReceita} />
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Texto suave pequeno>{`Receita planejada: ${painel.receita.origem_plano ? ORIGEM[painel.receita.origem_plano] : ""}`}</Texto>
                  </View>
                  <Botao rotulo="Editar receita" secundario pequeno onPress={editarReceita} />
                </View>
              )}
              {painel.pendentes > 0 ? <Aviso tipo="info">{`${painel.pendentes} lançamento(s) pendente(s) de revisão entram nos totais realizados; confirme no botão de revisão do Início.`}</Aviso> : null}
            </Cartao>

            <ParticipacaoClasses painel={painel} aoMudar={recarregar} />

            {semOrcamento ? (
              <Cartao titulo="Orçamento ainda não definido">
                <Texto>{`Não há valores planejados para ${nomeMes(mes)}. Defina quanto pretende gastar em cada categoria e a receita esperada para acompanhar o mês.`}</Texto>
                <Texto suave pequeno>Você pode partir da média dos três meses anteriores ou montar item a item; nada é gravado sem a sua confirmação.</Texto>
                <Botao rotulo="Preencher pela média dos 3 meses anteriores" onPress={() => void sugerir()} carregando={ocupado} />
                <Botao rotulo="Adicionar item ao orçamento" secundario onPress={() => setEscolhendo(true)} />
              </Cartao>
            ) : null}

            {alertas.length > 0 ? (
              <Cartao titulo={`Alertas do orçamento (${alertas.length})`}>
                <Texto suave pequeno>Estourou: acima do planejado. Atenção: a partir de 80% do planejado. Sem plano: há gasto sem valor planejado.</Texto>
                {alertasVistos.map((a) => {
                  const cor = a.tipo === "atencao" ? t.alerta : t.perigo;
                  const detalhe = a.tipo === "sem_plano" ? `Realizado ${formatarBRL(a.realizado_centavos)}; sem valor planejado` : `Realizado ${formatarBRL(a.realizado_centavos)} de ${formatarBRL(a.planejado_centavos)} planejado`;
                  return (
                    <Pressable key={`${a.tipo}-${a.item}`} accessibilityRole="button" accessibilityLabel={`${ROTULO_ALERTA[a.tipo]}: ${a.rotulo}. ${detalhe}. Toque para editar.`} onPress={() => editarAlerta(a.item)} style={({ pressed }) => ({ minHeight: 44, gap: 2, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
                        <Text style={{ color: cor, fontSize: 13, fontWeight: "800", minWidth: 68 }}>{ROTULO_ALERTA[a.tipo]}</Text>
                        <Text style={{ color: t.texto, fontSize: 15, fontWeight: "600", flex: 1 }}>{a.rotulo}</Text>
                      </View>
                      <Text style={{ color: t.suave, fontSize: 13, marginLeft: 76 }}>{detalhe}</Text>
                    </Pressable>
                  );
                })}
                {alertas.length > 5 ? <Botao rotulo={todosAlertas ? "Mostrar menos" : `Mostrar todos (${alertas.length})`} secundario pequeno onPress={() => setTodosAlertas((v) => !v)} /> : null}
              </Cartao>
            ) : null}

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 18, fontWeight: "700", flex: 1 }}>Por classe</Text>
              <Botao rotulo={painel.classes.every((c) => abertas[c.id]) ? "Recolher tudo" : "Expandir tudo"} pequeno secundario onPress={() => setAbertas(painel.classes.every((c) => abertas[c.id]) ? {} : Object.fromEntries(painel.classes.map((c) => [c.id, true])))} />
              <Botao rotulo="Adicionar item" icone="mais" pequeno secundario onPress={() => setEscolhendo(true)} />
            </View>
            {painel.classes.map((c) => <SecaoClasse key={c.id} classe={c} aberta={Boolean(abertas[c.id])} onAlternar={() => setAbertas({ ...abertas, [c.id]: !abertas[c.id] })} onItem={(i) => setAlvo(alvoDoItem(i, c.id))} />)}

            {dados && dados.parcelas.length > 0 ? (
              <Cartao titulo="Parcelas já comprometidas (fluxo de caixa)">
                <Texto suave pequeno>Compras parceladas: cada mês entra com a sua parcela. Valores previstos até a fatura do mês chegar.</Texto>
                {dados.parcelas.map((p) => (
                  <View key={p.mes} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                    <Text style={{ color: t.texto, fontSize: 15 }}>{nomeMes(p.mes)} ({p.quantidade} parcela(s))</Text>
                    <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>{formatarBRL(p.total_centavos)}</Text>
                  </View>
                ))}
              </Cartao>
            ) : null}

            <Cartao titulo="Ações do mês">
              {confirmaCopia ? (
                <View style={{ gap: 10 }}>
                  <Aviso tipo="info">{`${nomeMes(mes)} já tem ${proprios} valor(es) próprio(s). Copiar de ${nomeMes(anterior)} substitui os valores dos itens em comum.`}</Aviso>
                  <Botao rotulo="Confirmar cópia" onPress={() => void copiar()} carregando={ocupado} />
                  <Botao rotulo="Cancelar" secundario onPress={() => setConfirmaCopia(false)} desabilitado={ocupado} />
                </View>
              ) : (
                <>
                  <Botao rotulo="Copiar do mês anterior" secundario onPress={() => (proprios > 0 ? setConfirmaCopia(true) : void copiar())} desabilitado={ocupado} />
                  <Texto suave pequeno>{`Copia os valores em vigor em ${nomeMes(anterior)} (próprios ou padrão) como valores próprios de ${nomeMes(mes)}.`}</Texto>
                </>
              )}
              <Botao rotulo="Preencher pela média dos 3 meses anteriores" secundario onPress={() => void sugerir()} carregando={ocupado} />
              <Texto suave pequeno>Mostra uma sugestão para revisar; só grava depois da sua confirmação.</Texto>
            </Cartao>

            {vs ? (
              <Cartao titulo="Metas e orçamento">
                {vs.metas.length === 0 ? (
                  <Texto>Você ainda não tem metas ativas. Crie metas para comparar o aporte mensal que elas exigem com o valor que o orçamento reserva para Liberdade financeira.</Texto>
                ) : (
                  <>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <Par rotulo="Planejado em Liberdade financeira" valor={formatarBRL(vs.planejado_liberdade_centavos)} />
                      <Par rotulo="Aporte mensal exigido pelas metas" valor={formatarBRL(vs.aporte_necessario_metas_centavos)} />
                    </View>
                    {vs.metas.map((m) => (
                      <View key={m.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                        <Text style={{ flex: 1, color: t.suave, fontSize: 13 }}>{`${m.nome} (${m.perfil})`}</Text>
                        <Text style={{ color: t.suave, fontSize: 13 }}>{`${formatarBRL(m.aporte_mensal_necessario_centavos)}/mês`}</Text>
                      </View>
                    ))}
                    <Texto>{vs.lacuna_liberdade_centavos > 0 ? `Só com a Liberdade financeira, faltam ${formatarBRL(vs.lacuna_liberdade_centavos)} por mês para o aporte exigido.` : vs.lacuna_liberdade_centavos < 0 ? `Só com a Liberdade financeira, sobram ${formatarBRL(-vs.lacuna_liberdade_centavos)} por mês em relação ao aporte exigido.` : "O planejado em Liberdade financeira é igual ao aporte exigido."}</Texto>
                    <Texto cor={vs.lacuna_com_superavit_centavos > 0 ? t.alerta : t.ok} forte>
                      {vs.lacuna_com_superavit_centavos <= 0
                        ? `Somando o superávit planejado (${formatarBRL(Math.max(vs.superavit_planejado_centavos, 0))}), o orçamento cobre o aporte exigido.`
                        : `Mesmo somando o superávit planejado (${formatarBRL(Math.max(vs.superavit_planejado_centavos, 0))}), faltam ${formatarBRL(vs.lacuna_com_superavit_centavos)} por mês.`}
                    </Texto>
                    {vs.superavit_planejado_centavos < 0 ? <Texto suave pequeno>O superávit planejado é negativo e, por isso, não entra na soma.</Texto> : null}
                  </>
                )}
                <Texto suave pequeno>Simulação educacional, com premissas editáveis em Metas. Não é recomendação de investimento.</Texto>
                <Botao rotulo="Abrir metas" secundario icone="meta" onPress={() => router.push("/metas")} />
              </Cartao>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <EditorItem alvo={alvo} mes={mes} onFechar={() => setAlvo(null)} onConcluir={concluido} />
      <EscolherCategoria visivel={escolhendo} categorias={painel?.categorias ?? []} planejados={planejados} onEscolher={escolherCategoria} onFechar={() => setEscolhendo(false)} />
      <SugestaoMedia visivel={sugestoes !== null} mes={mes} sugestoes={sugestoes ?? []} atuais={atuais} onFechar={() => setSugestoes(null)} onConcluir={concluido} />
    </>
  );
}
