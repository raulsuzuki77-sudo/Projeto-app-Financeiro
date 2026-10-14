import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from "react-native";
import { rotuloCategoria, type Sugestao } from "../../../../core/src/index";
import { Pizza } from "../../components/pizza";
import { SeletorCategoria } from "../../components/seletor-categoria";
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
  const mes = mesAtual();

  const { dados, erro, carregando, recarregar } = useDados(async () => {
    await api.gerarRecorrencias();
    const [resumo, cartoes] = await Promise.all([api.resumo(mes), api.cartoes()]);
    return { resumo, cartoes };
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
  const pizza = useMemo(
    () => (dados?.resumo.por_categoria ?? []).filter((c) => c.categoria !== "nao_classificado").map((c) => ({ id: c.categoria, rotulo: rotuloCategoria(c.categoria), valor: c.total_centavos })),
    [dados],
  );
  const semCategoria = dados?.resumo.por_categoria.find((c) => c.categoria === "nao_classificado")?.total_centavos ?? 0;
  const totalDespesas = dados?.resumo.despesas_centavos ?? 0;

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
    setEnviando(true);
    try {
      const r = await api.lancar({ tipo, valor_centavos: centavos, descricao, forma_pagamento: forma, cartao_id: forma === "credito" || forma === "debito" ? cartaoId : null, categoria: categoria ?? undefined, data_local: data });
      setValor("");
      setDescricao("");
      setCategoria(null);
      setSugestoes([]);
      if (r.resultado === "criado") {
        const l = r.lancamento;
        const pend = l.status === "pendente";
        toast({
          texto: pend ? `Registrado (sem categoria): ${l.descricao}, ${formatarBRL(l.valor_centavos)}. Classifique em Revisar.` : `Registrado: ${l.descricao}, ${formatarBRL(l.valor_centavos)} em ${rotuloCategoria(l.categoria)}.`,
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

        <Cartao titulo={`Gastos de ${nomeMes(mes)}`}>
          {pizza.length > 0 ? (
            <Pizza dados={pizza} tamanho={180} legenda={4} />
          ) : (
            <Texto suave>Ainda não há gastos categorizados neste mês. Registre um lançamento abaixo.</Texto>
          )}
          {semCategoria > 0 || (dados?.resumo.pendentes ?? 0) > 0 ? (
            <View style={{ gap: 8 }}>
              <Aviso tipo="info">{`${dados?.resumo.pendentes ?? 0} item(ns) aguardam revisão${semCategoria > 0 ? `, incluindo ${formatarBRL(semCategoria)} sem categoria que não aparecem na pizza` : ""}.`}</Aviso>
              <Botao rotulo="Revisar agora" onPress={() => router.push("/revisar")} secundario pequeno />
            </View>
          ) : null}
          {pizza.length > 0 ? <Texto suave pequeno>Total de despesas no mês: {formatarBRL(totalDespesas)}. Toque numa fatia para ver o valor.</Texto> : null}
        </Cartao>

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
    </KeyboardAvoidingView>
  );
}
