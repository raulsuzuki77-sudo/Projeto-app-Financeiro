import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from "react-native";
import { rotuloCategoria, type Sugestao } from "../../../../core/src/index";
import { BotaoRevisao } from "../../components/botao-revisao";
import { Pizza } from "../../components/pizza";
import { SeletorCategoria } from "../../components/seletor-categoria";
import { SeletorMes } from "../../components/seletor-mes";
import { useTema } from "../../components/tema";
import { useToast } from "../../components/toast";
import { Aviso, Botao, Campo, CampoValor, Cartao, Chip, GrupoChips, Segmentado, Texto } from "../../components/ui";
import { useBotaoAtualizar, useDados } from "../../hooks/useDados";
import { api, type Cartao as CartaoLocal } from "../../lib/api";
import { dataBR, dataParaISO, formatarBRL, mesAtual, nomeMes, reaisParaCentavos } from "../../lib/format";

type Tipo = "despesa" | "receita" | "investimento";
type Forma = "pix" | "debito" | "credito" | "dinheiro";
type Quando = "hoje" | "ontem" | "outra";

const FORMAS: { id: Forma; rotulo: string }[] = [
  { id: "pix", rotulo: "Pix" },
  { id: "debito", rotulo: "Débito" },
  { id: "credito", rotulo: "Crédito" },
  { id: "dinheiro", rotulo: "Dinheiro" },
];

function isoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Inicio() {
  const t = useTema();
  const router = useRouter();
  const toast = useToast();
  const [mes, setMes] = useState(mesAtual());
  const [visao, setVisao] = useState<"categoria" | "grupo" | "classe">("categoria");

  const { dados, erro, carregando, recarregar } = useDados(async () => {
    await api.gerarRecorrencias();
    const [resumo, cartoes, orcamento, viagens, recorrentes, visoes, pendentes, pagamentos] = await Promise.all([api.resumo(mes), api.cartoes(), api.orcamento(mes), api.viagensSemEvento(), api.recorrentesDetectadas(), api.visoesDespesa(mes), api.contarPendentes(), api.pagamentosProximos()]);
    return { resumo, cartoes, orcamento, viagens, recorrentes, visoes, pendentes, pagamentos };
  }, [mes]);
  useBotaoAtualizar(recarregar);

  // formulário
  const [tipo, setTipo] = useState<Tipo>("despesa");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [forma, setForma] = useState<Forma | null>(null);
  const [cartaoId, setCartaoId] = useState<number | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [quando, setQuando] = useState<Quando>("hoje");
  const [outraData, setOutraData] = useState("");
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [seletor, setSeletor] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [rapido, setRapido] = useState(false);
  const [texto, setTexto] = useState("");
  const [parcelas, setParcelas] = useState("1");
  const [valorInformado, setValorInformado] = useState<"total" | "parcela">("total");

  // sugestões de categoria enquanto o detalhamento é digitado
  const seq = useRef(0);
  useEffect(() => {
    if (descricao.trim().length < 3) {
      setSugestoes([]);
      return;
    }
    const minha = ++seq.current;
    const espera = setTimeout(() => {
      api.sugestoes(descricao, tipo).then((s) => minha === seq.current && setSugestoes(s), () => undefined);
    }, 250);
    return () => clearTimeout(espera);
  }, [descricao, tipo]);

  const cartoes: CartaoLocal[] = dados?.cartoes ?? [];
  // As três visões vêm do núcleo e somam exatamente o mesmo total (só muda o agrupamento); "Sem categoria" aparece em todas.
  const pizza = useMemo(() => (dados?.visoes[visao] ?? []).map((f) => ({ id: f.id, rotulo: f.rotulo, valor: f.total_centavos })), [dados, visao]);
  const avisos = useMemo(() => {
    const lista: { texto: string; rotulo: string; rota: string }[] = [];
    const estouros = dados?.orcamento.alertas.filter((a) => a.tipo === "estourou").length ?? 0;
    if (estouros > 0) lista.push({ texto: `${estouros} item(ns) do orçamento acima do planejado em ${nomeMes(mes)}.`, rotulo: "Ver orçamento", rota: "/orcamento" });
    const pg = dados?.pagamentos;
    if (pg && (pg.atrasados > 0 || pg.proximos > 0)) lista.push({ texto: `${pg.atrasados > 0 ? `${pg.atrasados} pagamento(s) em atraso` : ""}${pg.atrasados > 0 && pg.proximos > 0 ? " e " : ""}${pg.proximos > 0 ? `${pg.proximos} vencendo nos próximos 7 dias` : ""}.`, rotulo: "Ver a pagar", rota: "/pagamentos" });
    const viagens = dados?.viagens.length ?? 0;
    if (viagens > 0) lista.push({ texto: `${viagens} gasto(s) de viagem sem período definido. Informe quando a viagem ocorreu.`, rotulo: "Informar período", rota: "/eventos" });
    const novas = (dados?.recorrentes ?? []).filter((r) => !r.cadastrada && !r.encerrada).length;
    if (novas > 0) lista.push({ texto: `${novas} gasto(s) se repetem todo mês e ainda não estão cadastrados como recorrentes.`, rotulo: "Ver recorrentes", rota: "/recorrentes" });
    return lista;
  }, [dados, mes]);
  const semCategoria = dados?.resumo.por_categoria.find((c) => c.categoria === "nao_classificado")?.total_centavos ?? 0;
  const totalDespesas = dados?.visoes.total_centavos ?? 0;

  async function registrar() {
    setErroForm(null);
    const centavos = reaisParaCentavos(valor);
    if (centavos === null || centavos <= 0) return setErroForm("Informe o valor, por exemplo 42,90.");
    if (!descricao.trim()) return setErroForm("Informe o detalhamento, por exemplo: almoço, mercado, aluguel.");
    let data: string | undefined;
    if (quando === "ontem") {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      data = isoDe(d);
    } else if (quando === "outra") {
      const iso = dataParaISO(outraData, new Date().getFullYear());
      if (!iso) return setErroForm("Data inválida. Use o formato dd/mm/aaaa.");
      data = iso;
    }
    const nParcelas = tipo === "despesa" ? Number(parcelas || "1") : 1;
    if (!Number.isInteger(nParcelas) || nParcelas < 1 || nParcelas > 48) return setErroForm("O número de parcelas deve estar entre 1 e 48.");
    setEnviando(true);
    try {
      const r = await api.lancar({ tipo, valor_centavos: centavos, parcelas: nParcelas > 1 ? nParcelas : undefined, valor_informado: nParcelas > 1 ? valorInformado : undefined, descricao, forma_pagamento: forma, cartao_id: forma === "credito" || forma === "debito" ? cartaoId : null, categoria: categoria ?? undefined, data_local: data });
      setValor("");
      setDescricao("");
      setCategoria(null);
      setParcelas("1");
      setSugestoes([]);
      if (r.resultado === "criado") {
        const l = r.lancamento;
        const pend = l.status === "pendente";
        toast({
          texto: pend ? `Registrado (sem categoria): ${l.descricao}, ${formatarBRL(l.valor_centavos)}. Classifique no botão de revisão (canto da tela).` : `Registrado: ${l.descricao}, ${formatarBRL(l.valor_centavos)} em ${rotuloCategoria(l.categoria)}.`,
          acao: { rotulo: "Desfazer", fazer: async () => { await api.excluir(l.id); await recarregar(); } },
        });
      } else {
        toast({ texto: "Este lançamento já existia; nada foi duplicado." });
      }
      await recarregar();
    } catch (e) {
      setErroForm(e instanceof Error ? e.message : "Não foi possível registrar.");
    } finally {
      setEnviando(false);
    }
  }

  async function enviarTexto() {
    if (!texto.trim()) return;
    try {
      const r = await api.enviarMensagem(texto);
      toast({ texto: r.resposta || "Mensagem já processada." });
      setTexto("");
      await recarregar();
    } catch (e) {
      setErroForm(e instanceof Error ? e.message : "Falha ao registrar.");
    }
  }

  async function fotografar() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setErroForm("Permissão da câmera negada. Habilite em Ajustes do iPhone.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.9 });
    const a = r.canceled ? null : r.assets[0];
    if (a) router.push({ pathname: "/importar", params: { uri: a.uri, nome: "foto-comprovante.jpg", tipo: "comprovante" } });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}>
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

        <Cartao titulo="Gastos do mês">
          <SeletorMes mes={mes} onChange={setMes} />
          <Segmentado rotulo="Ver por" valor={visao} onChange={setVisao} opcoes={[{ id: "categoria", rotulo: "Categoria" }, { id: "grupo", rotulo: "Grupo" }, { id: "classe", rotulo: "Classe" }]} />
          {pizza.length > 0 ? (
            <Pizza dados={pizza} tamanho={180} legenda={4} />
          ) : (
            <Texto suave>Ainda não há gastos categorizados neste mês.{mes === mesAtual() ? " Registre um lançamento abaixo." : ""}</Texto>
          )}
          {semCategoria > 0 || (dados?.resumo.pendentes ?? 0) > 0 ? (
            <View style={{ gap: 8 }}>
              <Aviso tipo="info">{`${dados?.resumo.pendentes ?? 0} item(ns) deste mês aguardam revisão${semCategoria > 0 ? `; ${formatarBRL(semCategoria)} estão como "Sem categoria" no gráfico` : ""}.`}</Aviso>
              <Botao rotulo="Revisar agora" onPress={() => router.push("/revisar")} secundario pequeno />
            </View>
          ) : null}
          {pizza.length > 0 ? <Texto suave pequeno>Total de despesas no mês: {formatarBRL(totalDespesas)}, o mesmo nas três visões. Aportes e transferências ficam de fora. Toque numa fatia para ver o valor.</Texto> : null}
        </Cartao>

        {avisos.length > 0 ? (
          <Cartao titulo="Avisos">
            {avisos.map((a) => (
              <View key={a.rota} style={{ gap: 8 }}>
                <Aviso tipo="info">{a.texto}</Aviso>
                <Botao rotulo={a.rotulo} onPress={() => router.push(a.rota as never)} secundario pequeno />
              </View>
            ))}
          </Cartao>
        ) : null}

        <Cartao titulo="Novo lançamento">
          <Segmentado
            rotulo="Tipo do lançamento"
            valor={tipo}
            onChange={(v) => {
              setTipo(v);
              setCategoria(null);
            }}
            opcoes={[{ id: "despesa", rotulo: "Saída" }, { id: "receita", rotulo: "Entrada" }, { id: "investimento", rotulo: "Investimento" }]}
          />
          <CampoValor rotulo="Valor" value={valor} onChangeText={setValor} />
          <Campo rotulo="Detalhamento" value={descricao} onChangeText={setDescricao} placeholder={tipo === "receita" ? "Ex.: salário, reembolso" : "Ex.: almoço, mercado, farmácia"} autoCapitalize="sentences" />

          <View style={{ gap: 8 }}>
            <Text style={{ color: t.suave, fontSize: 13 }}>Categoria{categoria ? "" : " (automática, se você não escolher)"}</Text>
            <GrupoChips>
              {categoria ? <Chip rotulo={`${rotuloCategoria(categoria)}  ×`} ativo onPress={() => setCategoria(null)} /> : sugestoes.map((s) => <Chip key={s.categoria} rotulo={rotuloCategoria(s.categoria)} onPress={() => setCategoria(s.categoria)} />)}
              <Chip rotulo="Outra..." destaque onPress={() => setSeletor(true)} />
            </GrupoChips>
          </View>

          {tipo === "despesa" ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: t.suave, fontSize: 13 }}>Forma de pagamento</Text>
              <GrupoChips>
                {FORMAS.map((f) => <Chip key={f.id} rotulo={f.rotulo} ativo={forma === f.id} onPress={() => setForma(forma === f.id ? null : f.id)} />)}
              </GrupoChips>
              {(forma === "credito" || forma === "debito") && cartoes.length > 0 ? (
                <GrupoChips>
                  {cartoes.map((c) => <Chip key={c.id} rotulo={c.apelido} ativo={cartaoId === c.id} onPress={() => setCartaoId(cartaoId === c.id ? null : c.id)} />)}
                </GrupoChips>
              ) : null}
            </View>
          ) : null}

          {tipo === "despesa" ? (
            <View style={{ gap: 8 }}>
              <Campo rotulo="Parcelas (1 = à vista)" value={parcelas} onChangeText={(v) => setParcelas(v.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" placeholder="1" maxLength={2} />
              {Number(parcelas) > 1 ? (
                <>
                  <Segmentado rotulo="O valor informado é" valor={valorInformado} onChange={setValorInformado} opcoes={[{ id: "total", rotulo: "Da compra inteira" }, { id: "parcela", rotulo: "De cada parcela" }]} />
                  <Texto suave pequeno>Cada mês entra com a sua parcela (fluxo de caixa); as parcelas dos meses seguintes ficam previstas até a fatura chegar.</Texto>
                </>
              ) : null}
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            <Text style={{ color: t.suave, fontSize: 13 }}>Data</Text>
            <GrupoChips>
              <Chip rotulo="Hoje" ativo={quando === "hoje"} onPress={() => setQuando("hoje")} />
              <Chip rotulo="Ontem" ativo={quando === "ontem"} onPress={() => setQuando("ontem")} />
              <Chip rotulo="Outra data" ativo={quando === "outra"} onPress={() => setQuando("outra")} />
            </GrupoChips>
            {quando === "outra" ? <Campo rotulo="Data (dd/mm/aaaa)" value={outraData} onChangeText={setOutraData} keyboardType="numbers-and-punctuation" placeholder={dataBR(isoDe(new Date()))} /> : null}
          </View>

          {erroForm ? <Aviso tipo="erro">{erroForm}</Aviso> : null}
          <Botao rotulo="Registrar" onPress={registrar} carregando={enviando} />
        </Cartao>

        <Cartao titulo="Importar" >
          <Botao rotulo="Fotografar comprovante" icone="camera" onPress={fotografar} secundario />
          <Botao rotulo="Fatura, extrato ou PDF" icone="importar" onPress={() => router.push("/importar")} secundario />
        </Cartao>

        <Cartao titulo="Lançamento rápido por texto" acao={<Chip rotulo={rapido ? "Ocultar" : "Mostrar"} onPress={() => setRapido(!rapido)} />}>
          {rapido ? (
            <>
              <Campo rotulo="Descreva a compra" value={texto} onChangeText={setTexto} placeholder="mercado 187,40 crédito nomad" autoCapitalize="none" returnKeyType="send" onSubmitEditing={enviarTexto} />
              <Botao rotulo="Registrar por texto" onPress={enviarTexto} desabilitado={!texto.trim()} secundario />
              <Texto suave pequeno>Exemplos: "almoço 42,90 débito ontem 13h", "notebook 3000 em 10x nomad", "recebi 5000 salário".</Texto>
            </>
          ) : (
            <Texto suave pequeno>Escreva tudo em uma frase, no estilo de uma mensagem.</Texto>
          )}
        </Cartao>
      </ScrollView>
      <SeletorCategoria visivel={seletor} selecionada={categoria} onEscolher={(id) => { setCategoria(id); setSeletor(false); }} onFechar={() => setSeletor(false)} />
      <BotaoRevisao pendentes={dados?.pendentes ?? 0} aoTocar={() => router.push("/revisar")} />
    </KeyboardAvoidingView>
  );
}
