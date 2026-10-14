import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTema } from "../components/tema";
import { Aviso, Botao, Campo, CampoValor, Cartao, Texto } from "../components/ui";
import { useBotaoAtualizar } from "../hooks/useDados";
import { api, type CenariosDaMeta, type Meta, type PremissaApi, type Reserva } from "../lib/api";
import { formatarBRL, mesAtual, nomeMes, percentualParaFracao, reaisParaCentavos } from "../lib/format";

const TIPOS: { id: string; rotulo: string }[] = [
  { id: "reserva_emergencia", rotulo: "Reserva de emergência" },
  { id: "curto_prazo", rotulo: "Curto prazo" },
  { id: "medio_prazo", rotulo: "Médio prazo" },
  { id: "longo_prazo", rotulo: "Longo prazo" },
];
const PERFIS: { id: Meta["perfil"]; rotulo: string }[] = [
  { id: "conservador", rotulo: "Conservador" },
  { id: "moderado", rotulo: "Moderado" },
  { id: "arrojado", rotulo: "Arrojado" },
];
const NOME_CENARIO = { conservador: "Conservador", moderado: "Moderado", arrojado: "Arrojado" } as const;
const pct = (x: number) => `${(x * 100).toFixed(2).replace(".", ",")}%`;

export default function Metas() {
  const t = useTema();
  const router = useRouter();
  const [vs, setVs] = useState<Awaited<ReturnType<typeof api.orcamentoVsMetas>> | null>(null);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [reserva, setReserva] = useState<Reserva | null>(null);
  const [sobra, setSobra] = useState<number | null>(null);
  const [aberta, setAberta] = useState<CenariosDaMeta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [prem, setPrem] = useState<PremissaApi[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const VAZIO = { nome: "", valor: "", prazo: "", inicial: "", tipo: "curto_prazo", perfil: "moderado" as Meta["perfil"] };
  const [f, setF] = useState(VAZIO);
  const [editando, setEditando] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    try {
      setErro(null);
      const [m, r, p, pr, orc] = await Promise.all([api.metas(), api.reserva(6), api.poupanca(), api.premissas(), api.orcamentoVsMetas(mesAtual())]);
      setVs(orc);
      setPrem(pr.premissas);
      setEdit(Object.fromEntries(pr.premissas.map((x) => [x.chave, String((x.retorno_nominal_aa * 100).toFixed(2)).replace(".", ",")])));
      setMetas(m);
      setReserva(r);
      setSobra(p.sobra_media_mensal_centavos);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    }
  }, []);
  useFocusEffect(useCallback(() => void carregar(), [carregar]));
  useBotaoAtualizar(carregar);

  async function criar() {
    const valor = reaisParaCentavos(f.valor);
    const inicial = f.inicial.trim() ? reaisParaCentavos(f.inicial) : 0;
    const prazo = Number(f.prazo);
    if (!f.nome.trim() || valor === null || inicial === null || !Number.isInteger(prazo) || prazo < 1) return setErro("Preencha nome, valor (ex.: 20000), prazo em meses e, se houver, o valor inicial.");
    try {
      setErro(null);
      const dados = { nome: f.nome.trim(), tipo: f.tipo, valor_alvo_centavos: valor, aporte_inicial_centavos: inicial, prazo_meses: prazo, perfil: f.perfil };
      if (editando !== null) await api.atualizarMeta(editando, dados);
      else await api.criarMeta(dados);
      setF(VAZIO);
      setEditando(null);
      setAberta(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao criar a meta.");
    }
  }

  async function salvarPremissas() {
    try {
      setErro(null);
      for (const p of prem) {
        const v = percentualParaFracao(edit[p.chave] ?? "");
        if (v === null) return setErro(`Percentual inválido em ${p.chave}. Use numeros como 10 ou 10,5.`);
        await api.salvarPremissa({ chave: p.chave, retorno_nominal_aa: v, ir_modo: p.ir_modo, ir_aliquota: p.ir_aliquota });
      }
      setAberta(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar premissas.");
    }
  }

  function editar(m: Meta) {
    const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");
    setEditando(m.id);
    setF({ nome: m.nome, valor: reais(m.valor_alvo_centavos), prazo: String(m.prazo_meses), inicial: reais(m.aporte_inicial_centavos), tipo: m.tipo, perfil: m.perfil });
  }

  async function ver(m: Meta) {
    try {
      setErro(null);
      setAberta(await api.cenarios(m.id, sobra && sobra > 0 ? sobra : undefined));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao simular.");
    }
  }

  return (
    <ScrollView style={{ backgroundColor: t.fundo }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <Cartao titulo="Base real dos seus dados">
        <Texto>Reserva de emergência (6 meses): {reserva ? formatarBRL(reserva.valor_alvo_centavos) : "..."}</Texto>
        <Texto suave>{reserva ? `Despesa essencial média: ${formatarBRL(reserva.media_mensal_centavos)} por mes.` : ""}</Texto>
        <Texto>Sobra média mensal confirmada: {sobra === null ? "..." : formatarBRL(sobra)}</Texto>
        {reserva && reserva.meses_sem_dados.length > 0 ? <Aviso tipo="info">{`Sem lançamentos essenciais confirmados em: ${reserva.meses_sem_dados.join(", ")}. A estimativa pode estar baixa; confirme os pendentes.`}</Aviso> : null}
      </Cartao>

      {vs ? (
        <Cartao titulo={`Metas e orçamento (${nomeMes(vs.mes)})`}>
          <Texto>Reservado no orçamento para Liberdade financeira: {formatarBRL(vs.planejado_liberdade_centavos)} por mês.</Texto>
          <Texto>Aporte que as metas ativas pedem (no perfil de cada uma): {formatarBRL(vs.aporte_necessario_metas_centavos)} por mês.</Texto>
          {vs.metas.length === 0 ? (
            <Texto suave>Crie metas abaixo para comparar com o orçamento.</Texto>
          ) : vs.lacuna_liberdade_centavos > 0 ? (
            <Aviso tipo="info">{`O orçamento reserva ${formatarBRL(vs.lacuna_liberdade_centavos)} a menos por mês do que as metas pedem${vs.superavit_planejado_centavos > 0 ? (vs.lacuna_com_superavit_centavos <= 0 ? `; o superávit planejado (${formatarBRL(vs.superavit_planejado_centavos)}) cobriria a diferença, se fosse destinado às metas` : `; mesmo com o superávit planejado (${formatarBRL(vs.superavit_planejado_centavos)}), faltariam ${formatarBRL(vs.lacuna_com_superavit_centavos)}`) : ""}.`}</Aviso>
          ) : (
            <Texto suave>O valor reservado cobre o aporte que as metas pedem (sobra de {formatarBRL(-vs.lacuna_liberdade_centavos)} por mês).</Texto>
          )}
          <Texto suave pequeno>Comparação de planejamento, baseada em simulação com premissas editáveis; não é recomendação de investimento.</Texto>
          <Botao rotulo="Abrir orçamento" pequeno secundario onPress={() => router.push("/orcamento" as never)} />
        </Cartao>
      ) : null}

      {metas.map((m) => (
        <Cartao key={m.id}>
          <Texto forte>{m.nome}</Texto>
          <Texto suave>{formatarBRL(m.valor_alvo_centavos)} em {m.prazo_meses} meses (valores de hoje)</Texto>
          <Texto suave>Perfil escolhido: {NOME_CENARIO[m.perfil]}</Texto>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Botao rotulo="Simular cenários" pequeno onPress={() => ver(m)} />
            <Botao rotulo="Editar" icone="editar" pequeno secundario onPress={() => editar(m)} />
            <Botao rotulo="Excluir" icone="lixeira" pequeno perigo onPress={async () => { await api.removerMeta(m.id); setAberta(null); await carregar(); }} />
          </View>
          {aberta?.meta.id === m.id ? (
            <View style={{ gap: 12 }}>
              {aberta.premissas_padrao ? <Aviso tipo="info">Premissas de rentabilidade ainda são valores ilustrativos do sistema, não taxas atuais de mercado. Atualize-as com fontes oficiais antes de decidir.</Aviso> : null}
              {aberta.cenarios.map((c) => (
                <View key={c.cenario} style={{ gap: 2, borderTopWidth: 1, borderTopColor: t.borda, paddingTop: 8 }} accessible>
                  <Texto forte>{NOME_CENARIO[c.cenario]}{c.perfil_da_meta ? " · seu perfil" : ""} (retorno assumido {pct(c.retorno_nominal_aa)} a.a.; real {pct(c.taxa_real_aa)})</Texto>
                  <Texto>{c.atingida_sem_aportes ? "O valor inicial já basta para a meta." : `Aporte necessário: ${formatarBRL(c.aporte_mensal_necessario_centavos)} por mes`}</Texto>
                  <Texto suave>Meta corrigida pelo IPCA ({pct(aberta.ipca_aa)}): {formatarBRL(c.valor_alvo_nominal_centavos)}. Total aportado: {formatarBRL(c.total_aportado_centavos)}. IR estimado: {formatarBRL(c.ir_estimado_centavos)}.</Texto>
                  {c.prazo_com_aporte_meses !== undefined ? <Texto suave>{c.prazo_com_aporte_meses === null ? "Com a sua sobra média atual, a meta não é atingida em 100 anos." : `Com a sua sobra média atual, a meta seria atingida em ${c.prazo_com_aporte_meses} meses.`}</Texto> : null}
                </View>
              ))}
              <Aviso tipo="info">{aberta.aviso}</Aviso>
            </View>
          ) : null}
        </Cartao>
      ))}

      <Cartao titulo="Premissas de rentabilidade (percentual ao ano)">
        {prem.some((p) => p.atualizada_em === null) ? <Aviso tipo="info">Valores ilustrativos do sistema, não são taxas atuais de mercado. Informe as suas premissas, com base em fontes oficiais.</Aviso> : null}
        {prem.map((p) => (
          <Campo key={p.chave} rotulo={p.chave === "ipca" ? "Inflação (IPCA) assumida" : `Retorno nominal ${p.chave}`} value={edit[p.chave] ?? ""} onChangeText={(v) => setEdit({ ...edit, [p.chave]: v })} keyboardType="decimal-pad" />
        ))}
        <Botao rotulo="Salvar premissas" onPress={salvarPremissas} secundario />
      </Cartao>

      <Cartao titulo={editando !== null ? "Editar meta" : "Nova meta"}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {TIPOS.map((x) => (
            <Pressable key={x.id} accessibilityRole="button" accessibilityState={{ selected: f.tipo === x.id }} onPress={() => setF({ ...f, tipo: x.id })} style={{ borderWidth: 1, borderColor: f.tipo === x.id ? t.primaria : t.borda, borderRadius: 16, minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}>
              <Text style={{ color: f.tipo === x.id ? t.primaria : t.texto, fontWeight: f.tipo === x.id ? "700" : "400" }}>{x.rotulo}</Text>
            </Pressable>
          ))}
        </View>
        <Texto suave>Perfil de risco desta meta (você escolhe; define qual cenário fica destacado):</Texto>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {PERFIS.map((x) => (
            <Pressable key={x.id} accessibilityRole="button" accessibilityState={{ selected: f.perfil === x.id }} onPress={() => setF({ ...f, perfil: x.id })} style={{ borderWidth: 1, borderColor: f.perfil === x.id ? t.primaria : t.borda, borderRadius: 16, minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}>
              <Text style={{ color: f.perfil === x.id ? t.primaria : t.texto, fontWeight: f.perfil === x.id ? "700" : "400" }}>{x.rotulo}</Text>
            </Pressable>
          ))}
        </View>
        <Campo rotulo="Nome da meta" value={f.nome} onChangeText={(v) => setF({ ...f, nome: v })} />
        <CampoValor rotulo="Valor da meta em reais de hoje" value={f.valor} onChangeText={(v) => setF({ ...f, valor: v })} />
        <Campo rotulo="Prazo em meses" value={f.prazo} onChangeText={(v) => setF({ ...f, prazo: v })} keyboardType="number-pad" placeholder="24" />
        <CampoValor rotulo="Valor já guardado (opcional)" value={f.inicial} onChangeText={(v) => setF({ ...f, inicial: v })} />
        <Botao rotulo={editando !== null ? "Salvar alterações" : "Criar meta"} onPress={criar} />
        {editando !== null ? <Botao rotulo="Cancelar edição" onPress={() => { setEditando(null); setF(VAZIO); }} secundario /> : null}
      </Cartao>
    </ScrollView>
  );
}
