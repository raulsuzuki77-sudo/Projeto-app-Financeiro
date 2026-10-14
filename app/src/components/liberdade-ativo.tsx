import { useState } from "react";
import { Text, View } from "react-native";
import { ROTULO_EXPOSICAO, ROTULO_CLASSE, type Exposicao } from "../../../core/src/index";
import { useTema } from "./tema";
import { Aviso, Botao, Campo, Chip, GrupoChips, Segmentado, Texto } from "./ui";
import type { DadosLiberdade } from "../lib/api";
import { dataBR, formatarBRL } from "../lib/format";
import { formatarMoeda, formatarPreco, formatarQuantidade, lerPrecoUnitario, mesCurto, pctDoDocumento, percentualTexto, ROTULO_TIPO_MOVIMENTO } from "../lib/investimentos";

export type ItemDaCarteira = DadosLiberdade["carteira"]["itens"][number];

const ORIGEM: Record<string, string> = { extrato: "do extrato", informado: "informado por você", informada: "informada por você", padrao: "padrão (editável)" };

function Linha({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  const t = useTema();
  return (
    <View accessible accessibilityLabel={`${rotulo}: ${valor}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, minHeight: 22 }}>
      <Text style={{ color: t.suave, fontSize: 13, flexShrink: 1 }}>{rotulo}</Text>
      <Text style={{ color: cor ?? t.texto, fontSize: 13, fontWeight: "600", textAlign: "right", flexShrink: 1 }}>{valor}</Text>
    </View>
  );
}

/** Detalhe de um ativo: dados do extrato, movimentos do mês e edição do cadastro (preço médio, espécie, setor, exposição, Meta). */
export function LiberdadeAtivo({ item, aoSalvar, aoRemover }: { item: ItemDaCarteira; aoSalvar: (chave: string, alteracao: Record<string, unknown>) => Promise<void>; aoRemover?: () => void }) {
  const t = useTema();
  const usd = item.moeda === "USD";
  const d = item.detalhe;
  const editavel = item.classe_ativo !== "transito";
  const podeMeta = item.classe_ativo === "renda_fixa";
  const [preco, setPreco] = useState(item.preco_medio_origem === "informado" && item.preco_medio !== null ? String(item.preco_medio).replace(".", ",") : "");
  const [especie, setEspecie] = useState(item.especie_origem === "informada" ? item.especie : "");
  const [setor, setSetor] = useState(item.setor_origem === "informado" ? (item.setor ?? "") : "");
  const [exposicao, setExposicao] = useState<"padrao" | Exposicao>(item.exposicao_origem === "informada" ? item.exposicao : "padrao");
  const [meta, setMeta] = useState(item.meta);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const precoLido = lerPrecoUnitario(preco);
  const precoInvalido = preco.trim() !== "" && precoLido === null;
  const mostraPreco = item.classe_ativo !== "caixa" && item.classe_ativo !== "transito" && item.classe_ativo !== "previdencia";

  async function salvar() {
    if (precoInvalido) return setErro("Preço médio inválido. Use números como 111,31 (maior que zero).");
    setSalvando(true);
    setErro(null);
    try {
      const alteracao: Record<string, unknown> = { nome: item.ativo, especie: especie.trim() === "" ? null : especie, setor: setor.trim() === "" ? null : setor, exposicao: exposicao === "padrao" ? null : exposicao };
      if (mostraPreco) alteracao.preco_medio = precoLido;
      if (podeMeta) alteracao.meta = meta;
      await aoSalvar(item.chave, alteracao);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const resultadoTexto =
    item.resultado_original_centavos === null
      ? item.preco_medio === null && mostraPreco
        ? "não calculado (preço médio não informado)"
        : "—"
      : `${item.resultado_original_centavos > 0 ? "+" : ""}${formatarMoeda(item.resultado_original_centavos, item.moeda, formatarBRL)}${item.resultado_pct !== null ? ` (${percentualTexto(item.resultado_pct)})` : ""}`;

  return (
    <View style={{ gap: 12, paddingLeft: 24, paddingVertical: 8 }}>
      <View style={{ gap: 2 }}>
        {item.codigo && item.classe_ativo !== "previdencia" ? <Linha rotulo="Código" valor={item.codigo} /> : null}
        {item.cnpj ? <Linha rotulo="CNPJ" valor={item.cnpj} /> : null}
        <Linha rotulo="Gênero e espécie" valor={`${ROTULO_CLASSE[item.classe_ativo]} › ${item.especie} (${ORIGEM[item.especie_origem]})`} />
        {item.quantidade !== null ? <Linha rotulo={item.classe_ativo === "previdencia" ? "Cotas" : "Quantidade"} valor={formatarQuantidade(item.quantidade)} /> : null}
        {item.preco_fechamento !== null ? <Linha rotulo={item.classe_ativo === "previdencia" ? "Cotação atual" : "Preço de fechamento / mercado"} valor={`${formatarPreco(item.preco_fechamento, item.moeda)}${item.fator_preco !== 1 ? " (por 100 de face)" : ""}`} /> : null}
        {mostraPreco ? <Linha rotulo="Preço médio" valor={item.preco_medio === null ? "não informado" : `${formatarPreco(item.preco_medio, item.moeda)} (${item.preco_medio_origem ? ORIGEM[item.preco_medio_origem] : ""})`} /> : null}
        <Linha rotulo="Saldo bruto" valor={formatarMoeda(item.saldo_original_centavos, item.moeda, formatarBRL)} />
        {usd ? <Linha rotulo="Saldo bruto em reais" valor={item.saldo_centavos === null ? "sem câmbio" : formatarBRL(item.saldo_centavos)} /> : null}
        {mostraPreco ? <Linha rotulo="Resultado (saldo − quantidade × preço médio)" valor={resultadoTexto} cor={item.resultado_original_centavos === null ? undefined : item.resultado_original_centavos < 0 ? t.perigo : t.ok} /> : null}
        {d.valor_liquido_centavos !== undefined ? <Linha rotulo="Valor líquido (após IR)" valor={formatarBRL(d.valor_liquido_centavos)} /> : null}
        {d.ir_centavos !== undefined ? <Linha rotulo="IR retido estimado no extrato" valor={formatarBRL(d.ir_centavos)} /> : null}
        {d.aliquotas && d.aliquotas.length > 0 ? <Linha rotulo="Alíquota de IR" valor={d.aliquotas.map((a) => `${String(a.aliquota).replace(".", ",")}%`).join(", ")} /> : null}
        {d.regime ? <Linha rotulo="Regime tributário" valor={d.regime === "regressivo" ? "Regressivo" : d.regime} /> : null}
        {d.vencimento ? <Linha rotulo="Vencimento" valor={dataBR(d.vencimento)} /> : null}
        {d.cupom !== undefined ? <Linha rotulo="Cupom" valor={`${String(d.cupom).replace(".", ",")}% a.a.`} /> : null}
        {item.custo_total_original_centavos != null ? <Linha rotulo="Custo total (extrato)" valor={formatarMoeda(item.custo_total_original_centavos, item.moeda, formatarBRL)} /> : usd && mostraPreco ? <Linha rotulo="Custo (extrato)" valor="não informado (0,00 no extrato)" /> : null}
        {item.setor || item.classe_ativo === "renda_variavel" ? <Linha rotulo="Setor" valor={item.setor ? `${item.setor} (${ORIGEM[item.setor_origem ?? "padrao"]})` : "Sem setor"} /> : null}
        <Linha rotulo="Exposição" valor={`${ROTULO_EXPOSICAO[item.exposicao]} (${ORIGEM[item.exposicao_origem]})`} />
        <Linha rotulo="Instituição" valor={item.conta ? `${item.instituicao}, conta final ${item.conta}` : item.instituicao} />
        {item.defasado ? <Linha rotulo="Posição de" valor={`${mesCurto(item.mes_snapshot)} (defasada)`} /> : null}
        {d.data_liquidacao ? <Linha rotulo="Liquidação" valor={dataBR(d.data_liquidacao)} /> : null}
      </View>

      {d.rentabilidade ? (
        <View style={{ gap: 2 }}>
          <Texto suave pequeno>{`Rentabilidade do fundo, comparada ao benchmark${d.rentabilidade.benchmark ? ` (${d.rentabilidade.benchmark})` : ""}, como no extrato`}</Texto>
          <Linha rotulo="No mês" valor={`${pctDoDocumento(d.rentabilidade.fundo_mes)} (benchmark ${pctDoDocumento(d.rentabilidade.benchmark_mes)})`} />
          <Linha rotulo="No ano" valor={`${pctDoDocumento(d.rentabilidade.fundo_ano)} (benchmark ${pctDoDocumento(d.rentabilidade.benchmark_ano)})`} />
          <Linha rotulo="Em 12 meses" valor={`${pctDoDocumento(d.rentabilidade.fundo_12m)} (benchmark ${pctDoDocumento(d.rentabilidade.benchmark_12m)})`} />
        </View>
      ) : null}

      <View style={{ gap: 2 }}>
        <Texto suave pequeno>Movimentos do mês neste ativo</Texto>
        {item.movimentos.length === 0 ? (
          <Texto suave pequeno>Nenhum movimento no extrato.</Texto>
        ) : (
          item.movimentos.map((m) => {
            const valor = formatarMoeda(m.valor_centavos, item.moeda, formatarBRL);
            const partes = [dataBR(m.data_local), ROTULO_TIPO_MOVIMENTO[m.tipo] ?? m.tipo, m.quantidade !== null ? `${formatarQuantidade(m.quantidade)} un.` : null, m.preco !== null ? `a ${formatarPreco(m.preco, item.moeda)}` : null, m.em_transito ? "em trânsito" : null].filter(Boolean).join(" · ");
            return <Linha key={m.id} rotulo={partes} valor={valor} />;
          })
        )}
      </View>

      {editavel ? (
        <View style={{ gap: 10 }}>
          <Texto suave pequeno>Cadastro do ativo (vale para este código em todos os extratos)</Texto>
          {mostraPreco ? <Campo rotulo={`Preço médio informado${item.preco_medio_origem === "extrato" ? " (o do extrato prevalece enquanto ele informar)" : ""}`} prefixo={usd ? "US$" : "R$"} placeholder="não informado" keyboardType="decimal-pad" value={preco} onChangeText={setPreco} /> : null}
          <Campo rotulo="Espécie (vazio = a do extrato)" value={especie} onChangeText={setEspecie} placeholder={item.especie_origem === "informada" ? "" : item.especie} maxLength={60} />
          <Campo rotulo="Setor (vazio = o do extrato ou padrão)" value={setor} onChangeText={setSetor} placeholder={item.setor ?? "Sem setor"} maxLength={60} />
          <Segmentado
            rotulo="Exposição"
            valor={exposicao}
            onChange={setExposicao}
            opcoes={[{ id: "padrao", rotulo: "Padrão" }, { id: "nacional", rotulo: "Nacional" }, { id: "estrangeira", rotulo: "Estrangeira" }]}
          />
          {podeMeta ? (
            <View style={{ gap: 6 }}>
              <GrupoChips><Chip rotulo={meta ? "Marcado como Meta" : "Marcar como Meta"} ativo={meta} onPress={() => setMeta(!meta)} /></GrupoChips>
              <Texto suave pequeno>Meta é reserva ou provisão que você saca quando o fato provisionado ocorre. Fica fora da liberdade financeira e aparece separada no patrimônio.</Texto>
            </View>
          ) : null}
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Botao rotulo="Salvar cadastro do ativo" pequeno onPress={salvar} carregando={salvando} />
        </View>
      ) : null}
      {aoRemover ? <Botao rotulo="Remover esta posição manual" pequeno perigo onPress={aoRemover} /> : null}
    </View>
  );
}
