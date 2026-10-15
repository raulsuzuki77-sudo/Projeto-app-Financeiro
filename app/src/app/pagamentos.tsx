import { useState } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from "react-native";
import { SeletorMes } from "../components/seletor-mes";
import { useTema } from "../components/tema";
import { useToast } from "../components/toast";
import { Aviso, Botao, Campo, CampoValor, Cartao, Chip, GrupoChips, Texto } from "../components/ui";
import { useBotaoAtualizar, useDados } from "../hooks/useDados";
import { api, type CompromissoApp } from "../lib/api";
import { confirmar } from "../lib/confirmar";
import { dataBR, dataParaISO, formatarBRL, mascaraDeCentavos, mesAtual, nomeMes, reaisParaCentavos } from "../lib/format";

const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const ESTADO = { planejado: "Planejado", lancado: "Boleto lançado", pago: "Pago" } as const;

function Item({ c, aoMudar }: { c: CompromissoApp; aoMudar: () => void }) {
  const t = useTema();
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(mascaraDeCentavos(c.valor_real_centavos ?? c.valor_planejado_centavos));
  const [venc, setVenc] = useState(c.vencimento ? dataBR(c.vencimento) : "");
  const [erro, setErro] = useState<string | null>(null);
  const atrasado = c.estado !== "pago" && c.vencimento !== null && c.vencimento < hojeISO();
  const pago = c.estado === "pago";

  async function salvar() {
    const v = reaisParaCentavos(valor);
    if (v === null || v <= 0) return setErro("Informe o valor do boleto, por exemplo 687,71.");
    let iso: string | null | undefined = undefined;
    if (venc.trim()) {
      iso = dataParaISO(venc, new Date().getFullYear());
      if (!iso) return setErro("Vencimento inválido. Use dd/mm/aaaa.");
    } else iso = null;
    setErro(null);
    try {
      await api.lancarValorReal(c.id, { valor_real_centavos: v, vencimento: iso });
      setEditando(false);
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  }
  async function alternarPago() {
    await api.marcarPago(c.id, !pago);
    toast({ texto: pago ? `${c.descricao}: marcação de pago desfeita.` : `${c.descricao} marcado como pago. Quando você importar o extrato, ele é conferido.` });
    aoMudar();
  }
  async function remover() {
    if (!(await confirmar("Remover do controle", `${c.descricao} sai da lista deste mês (os lançamentos importados não são afetados).`, "Remover"))) return;
    await api.removerCompromisso(c.id);
    aoMudar();
  }

  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: pago ? "#C9A800" : atrasado ? t.perigo : t.borda, backgroundColor: pago ? "#F5D84A33" : t.cartao, padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.texto, fontSize: 16, fontWeight: "700" }}>{c.descricao}</Text>
          <Text style={{ color: atrasado ? t.perigo : t.suave, fontSize: 13 }}>
            {c.vencimento ? `Vence em ${dataBR(c.vencimento)}` : "Sem vencimento"}{atrasado ? " (em atraso)" : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: t.texto, fontSize: 16, fontWeight: "800" }}>{formatarBRL(c.valor_real_centavos ?? c.valor_planejado_centavos)}</Text>
          <Text style={{ color: t.suave, fontSize: 12 }}>{c.valor_real_centavos === null ? "previsto" : c.valor_real_centavos !== c.valor_planejado_centavos ? `previsto ${formatarBRL(c.valor_planejado_centavos)}` : "valor do boleto"}</Text>
        </View>
      </View>
      <Text style={{ color: pago ? "#7A6500" : t.suave, fontSize: 13, fontWeight: "700" }}>
        {ESTADO[c.estado]}{pago && c.pago_em ? ` em ${dataBR(c.pago_em)}` : ""}
        {pago ? (c.lancamento_id !== null ? (c.divergencia_centavos !== null ? " · confere com o extrato, mas o valor difere" : " · conferido no extrato") : c.pago_manual ? " · marcado por você, ainda não conferido no extrato" : "") : ""}
      </Text>
      {c.divergencia_centavos !== null ? <Aviso tipo="erro">{`O extrato mostrou ${formatarBRL(Math.abs(c.divergencia_centavos))} ${c.divergencia_centavos > 0 ? "a mais" : "a menos"} do que o valor registrado aqui. Confira o boleto pago.`}</Aviso> : null}
      {editando ? (
        <View style={{ gap: 8 }}>
          <CampoValor rotulo="Valor do boleto ou da fatura" value={valor} onChangeText={setValor} />
          <Campo rotulo="Vencimento (dd/mm/aaaa)" value={venc} onChangeText={setVenc} placeholder="Ex.: 10/10/2026" keyboardType="numbers-and-punctuation" />
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Botao rotulo="Salvar" pequeno onPress={salvar} /></View>
            <View style={{ flex: 1 }}><Botao rotulo="Cancelar" pequeno secundario onPress={() => setEditando(false)} /></View>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Botao rotulo={pago ? "Desmarcar pago" : "Marcar como pago"} pequeno secundario={pago} onPress={alternarPago} />
          <Botao rotulo={c.valor_real_centavos === null ? "Informar valor do boleto" : "Editar valor e vencimento"} pequeno secundario onPress={() => setEditando(true)} />
          <Botao rotulo="Remover" pequeno perigo onPress={remover} />
        </View>
      )}
    </View>
  );
}

/** Controle de pagamentos do mês: planejado, boleto lançado e pago (marcado à mão e conferido quando o extrato é importado). */
export default function Pagamentos() {
  const t = useTema();
  const toast = useToast();
  const [mes, setMes] = useState(mesAtual());
  const [novo, setNovo] = useState(false);
  const [desc, setDesc] = useState("");
  const [valor, setValor] = useState("");
  const [venc, setVenc] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const { dados, erro: erroCarga, carregando, recarregar } = useDados(() => api.pagamentos(mes), [mes]);
  useBotaoAtualizar(recarregar);
  const r = dados?.resumo;
  const abertos = (dados?.itens ?? []).filter((c) => c.estado !== "pago");
  const pagos = (dados?.itens ?? []).filter((c) => c.estado === "pago");

  async function criar() {
    const v = reaisParaCentavos(valor);
    if (!desc.trim()) return setErro("Informe o que é (por exemplo, IPTU).");
    if (v === null || v < 0) return setErro("Informe o valor previsto.");
    let iso: string | null = null;
    if (venc.trim()) {
      iso = dataParaISO(venc, Number(mes.slice(0, 4)));
      if (!iso) return setErro("Vencimento inválido. Use dd/mm/aaaa.");
    }
    setErro(null);
    try {
      await api.criarCompromisso({ mes, descricao: desc, valor_planejado_centavos: v, vencimento: iso });
      setDesc(""); setValor(""); setVenc(""); setNovo(false);
      toast({ texto: "Compromisso adicionado." });
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível adicionar.");
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}>
        <SeletorMes mes={mes} onChange={setMes} />
        {erroCarga ? <Aviso tipo="erro">{erroCarga}</Aviso> : null}
        {r ? (
          <Cartao titulo={`Resumo de ${nomeMes(mes)}`}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
              <View style={{ minWidth: 140, gap: 2 }}><Texto suave pequeno>Previsto no mês</Texto><Texto forte>{formatarBRL(r.previsto_centavos)}</Texto></View>
              <View style={{ minWidth: 140, gap: 2 }}><Texto suave pequeno>Já pago ({r.pagos})</Texto><Texto forte>{formatarBRL(r.pago_centavos)}</Texto></View>
              <View style={{ minWidth: 140, gap: 2 }}><Texto suave pequeno>Ainda a pagar ({r.a_pagar})</Texto><Texto forte>{formatarBRL(r.a_pagar_centavos)}</Texto></View>
              <View style={{ minWidth: 140, gap: 2 }}><Texto suave pequeno>Em atraso ({r.em_atraso})</Texto><Text style={{ color: r.em_atraso ? t.perigo : t.texto, fontSize: 16, fontWeight: "700" }}>{formatarBRL(r.em_atraso_centavos)}</Text></View>
            </View>
            <Texto suave pequeno>Os compromissos do mês vêm das suas recorrências. Quando o boleto chegar, informe o valor; ao pagar, marque como pago (fica amarelo). Ao importar o extrato do mês, cada pagamento é conferido com o lançamento real, sem contar nada duas vezes.</Texto>
          </Cartao>
        ) : null}

        {abertos.length > 0 ? <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 18, fontWeight: "700" }}>A pagar</Text> : null}
        {abertos.map((c) => <Item key={c.id} c={c} aoMudar={recarregar} />)}
        {pagos.length > 0 ? <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 18, fontWeight: "700" }}>Pagos</Text> : null}
        {pagos.map((c) => <Item key={c.id} c={c} aoMudar={recarregar} />)}
        {dados && dados.itens.length === 0 ? <Cartao><Texto suave>Nenhum compromisso neste mês. Cadastre as contas fixas em Gastos recorrentes (aparecem aqui sozinhas) ou adicione um abaixo.</Texto></Cartao> : null}

        <Cartao titulo="Adicionar compromisso">
          {novo ? (
            <View style={{ gap: 8 }}>
              <Campo rotulo="O que é" value={desc} onChangeText={setDesc} placeholder="Ex.: IPTU, fatura do cartão" />
              <CampoValor rotulo="Valor previsto" value={valor} onChangeText={setValor} />
              <Campo rotulo="Vencimento (dd/mm/aaaa, opcional)" value={venc} onChangeText={setVenc} keyboardType="numbers-and-punctuation" />
              {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
              <GrupoChips><Chip rotulo="Adicionar" destaque onPress={criar} /><Chip rotulo="Cancelar" onPress={() => { setNovo(false); setErro(null); }} /></GrupoChips>
            </View>
          ) : (
            <Botao rotulo="Novo compromisso do mês" secundario onPress={() => setNovo(true)} />
          )}
        </Cartao>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
