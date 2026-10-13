import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTema } from "../components/tema";
import { Aviso, Botao, Campo, Cartao, Texto } from "../components/ui";
import { api, type CenariosDaMeta, type Meta, type Reserva } from "../lib/api";
import { formatarBRL, reaisParaCentavos } from "../lib/format";

const TIPOS: { id: string; rotulo: string }[] = [
  { id: "reserva_emergencia", rotulo: "Reserva de emergencia" },
  { id: "curto_prazo", rotulo: "Curto prazo" },
  { id: "medio_prazo", rotulo: "Medio prazo" },
  { id: "longo_prazo", rotulo: "Longo prazo" },
];
const NOME_CENARIO = { conservador: "Conservador", moderado: "Moderado", arrojado: "Arrojado" } as const;
const pct = (x: number) => `${(x * 100).toFixed(2).replace(".", ",")}%`;

export default function Metas() {
  const t = useTema();
  const [metas, setMetas] = useState<Meta[]>([]);
  const [reserva, setReserva] = useState<Reserva | null>(null);
  const [sobra, setSobra] = useState<number | null>(null);
  const [aberta, setAberta] = useState<CenariosDaMeta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [f, setF] = useState({ nome: "", valor: "", prazo: "", inicial: "", tipo: "curto_prazo" });

  const carregar = useCallback(async () => {
    try {
      setErro(null);
      const [m, r, p] = await Promise.all([api.metas(), api.reserva(6), api.poupanca()]);
      setMetas(m);
      setReserva(r);
      setSobra(p.sobra_media_mensal_centavos);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    }
  }, []);
  useFocusEffect(useCallback(() => void carregar(), [carregar]));

  async function criar() {
    const valor = reaisParaCentavos(f.valor);
    const inicial = f.inicial.trim() ? reaisParaCentavos(f.inicial) : 0;
    const prazo = Number(f.prazo);
    if (!f.nome.trim() || valor === null || inicial === null || !Number.isInteger(prazo) || prazo < 1) return setErro("Preencha nome, valor (ex.: 20000), prazo em meses e, se houver, o valor inicial.");
    try {
      setErro(null);
      await api.criarMeta({ nome: f.nome.trim(), tipo: f.tipo, valor_alvo_centavos: valor, aporte_inicial_centavos: inicial, prazo_meses: prazo });
      setF({ nome: "", valor: "", prazo: "", inicial: "", tipo: "curto_prazo" });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao criar a meta.");
    }
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
        <Texto>Reserva de emergencia (6 meses): {reserva ? formatarBRL(reserva.valor_alvo_centavos) : "..."}</Texto>
        <Texto suave>{reserva ? `Despesa essencial media: ${formatarBRL(reserva.media_mensal_centavos)} por mes.` : ""}</Texto>
        <Texto>Sobra media mensal confirmada: {sobra === null ? "..." : formatarBRL(sobra)}</Texto>
        {reserva && reserva.meses_sem_dados.length > 0 ? <Aviso tipo="info">{`Sem lancamentos essenciais confirmados em: ${reserva.meses_sem_dados.join(", ")}. A estimativa pode estar baixa; confirme os pendentes.`}</Aviso> : null}
      </Cartao>

      {metas.map((m) => (
        <Cartao key={m.id}>
          <Texto forte>{m.nome}</Texto>
          <Texto suave>{formatarBRL(m.valor_alvo_centavos)} em {m.prazo_meses} meses (valores de hoje)</Texto>
          <Botao rotulo="Simular cenarios" onPress={() => ver(m)} secundario />
          <Botao rotulo="Excluir meta" onPress={async () => { await api.removerMeta(m.id); setAberta(null); await carregar(); }} secundario />
          {aberta?.meta.id === m.id ? (
            <View style={{ gap: 12 }}>
              {aberta.premissas_padrao ? <Aviso tipo="info">Premissas de rentabilidade ainda sao valores ilustrativos do sistema, nao taxas atuais de mercado. Atualize-as com fontes oficiais antes de decidir.</Aviso> : null}
              {aberta.cenarios.map((c) => (
                <View key={c.cenario} style={{ gap: 2, borderTopWidth: 1, borderTopColor: t.borda, paddingTop: 8 }} accessible>
                  <Texto forte>{NOME_CENARIO[c.cenario]} (retorno assumido {pct(c.retorno_nominal_aa)} a.a.; real {pct(c.taxa_real_aa)})</Texto>
                  <Texto>{c.atingida_sem_aportes ? "O valor inicial ja basta para a meta." : `Aporte necessario: ${formatarBRL(c.aporte_mensal_necessario_centavos)} por mes`}</Texto>
                  <Texto suave>Meta corrigida pelo IPCA ({pct(aberta.ipca_aa)}): {formatarBRL(c.valor_alvo_nominal_centavos)}. Total aportado: {formatarBRL(c.total_aportado_centavos)}. IR estimado: {formatarBRL(c.ir_estimado_centavos)}.</Texto>
                  {c.prazo_com_aporte_meses !== undefined ? <Texto suave>{c.prazo_com_aporte_meses === null ? "Com a sua sobra media atual, a meta nao e atingida em 100 anos." : `Com a sua sobra media atual, a meta seria atingida em ${c.prazo_com_aporte_meses} meses.`}</Texto> : null}
                </View>
              ))}
              <Aviso tipo="info">{aberta.aviso}</Aviso>
            </View>
          ) : null}
        </Cartao>
      ))}

      <Cartao titulo="Nova meta">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {TIPOS.map((x) => (
            <Pressable key={x.id} accessibilityRole="button" accessibilityState={{ selected: f.tipo === x.id }} onPress={() => setF({ ...f, tipo: x.id })} style={{ borderWidth: 1, borderColor: f.tipo === x.id ? t.primaria : t.borda, borderRadius: 16, minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}>
              <Text style={{ color: f.tipo === x.id ? t.primaria : t.texto, fontWeight: f.tipo === x.id ? "700" : "400" }}>{x.rotulo}</Text>
            </Pressable>
          ))}
        </View>
        <Campo rotulo="Nome da meta" value={f.nome} onChangeText={(v) => setF({ ...f, nome: v })} />
        <Campo rotulo="Valor da meta em reais de hoje" value={f.valor} onChangeText={(v) => setF({ ...f, valor: v })} keyboardType="decimal-pad" placeholder="20000" />
        <Campo rotulo="Prazo em meses" value={f.prazo} onChangeText={(v) => setF({ ...f, prazo: v })} keyboardType="number-pad" placeholder="24" />
        <Campo rotulo="Valor ja guardado (opcional)" value={f.inicial} onChangeText={(v) => setF({ ...f, inicial: v })} keyboardType="decimal-pad" placeholder="0" />
        <Botao rotulo="Criar meta" onPress={criar} />
      </Cartao>
    </ScrollView>
  );
}
