import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icone } from "./icone";
import { LiberdadeAtivo, type ItemDaCarteira } from "./liberdade-ativo";
import { useTema } from "./tema";
import { Cartao, Texto } from "./ui";
import type { DadosLiberdade } from "../lib/api";
import { formatarBRL, nomeMes } from "../lib/format";
import { formatarMoeda, formatarPreco, formatarQuantidade, formatarUSD, percentualTexto } from "../lib/investimentos";

type Carteira = DadosLiberdade["carteira"];

function Cabecalho({ aberto, onPress, titulo, valor, detalhe, nivel }: { aberto: boolean; onPress: () => void; titulo: string; valor: string; detalhe?: string; nivel: 1 | 2 | 3 }) {
  const t = useTema();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: aberto }}
      accessibilityLabel={`${titulo}: ${valor}${detalhe ? `. ${detalhe}` : ""}. ${aberto ? "Recolher" : "Expandir"}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: nivel === 3 ? 56 : 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: nivel === 1 ? 0 : nivel === 2 ? 14 : 28, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ transform: [{ rotate: aberto ? "90deg" : "0deg" }] }}><Icone nome="seta" cor={t.suave} tamanho={nivel === 3 ? 14 : 18} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.texto, fontSize: nivel === 1 ? 16 : 14, fontWeight: nivel === 3 ? "500" : nivel === 1 ? "700" : "600" }}>{titulo}</Text>
        {detalhe ? <Text style={{ color: t.suave, fontSize: 12 }}>{detalhe}</Text> : null}
      </View>
      <Text style={{ color: t.texto, fontSize: nivel === 1 ? 16 : 14, fontWeight: "700" }}>{valor}</Text>
    </Pressable>
  );
}

/** Linha de resumo de um ativo: quantidade, preço médio, preço atual e resultado, sempre com texto (a cor não é o único sinal). */
function resumo(i: ItemDaCarteira): string {
  if (i.classe_ativo === "transito" || i.classe_ativo === "caixa") return [i.defasado ? `posição de ${i.mes_snapshot.slice(5)}/${i.mes_snapshot.slice(0, 4)}` : null, i.moeda === "USD" && i.saldo_centavos !== null ? formatarUSD(i.saldo_original_centavos) : null].filter(Boolean).join(" · ");
  const partes: (string | null)[] = [
    i.codigo && i.classe_ativo !== "previdencia" ? i.codigo : null,
    i.quantidade !== null ? `${formatarQuantidade(i.quantidade)} ${i.classe_ativo === "previdencia" ? "cotas" : "un."}` : null,
    i.classe_ativo === "previdencia" ? null : `PM ${i.preco_medio === null ? "não informado" : formatarPreco(i.preco_medio, i.moeda)}`,
    i.preco_fechamento !== null ? `${i.classe_ativo === "previdencia" ? "cota" : "atual"} ${formatarPreco(i.preco_fechamento, i.moeda)}` : null,
    i.moeda === "USD" ? formatarUSD(i.saldo_original_centavos) : null,
  ];
  return partes.filter(Boolean).join(" · ");
}

function resultado(i: ItemDaCarteira): string | null {
  if (i.resultado_original_centavos === null) return null;
  const v = formatarMoeda(i.resultado_original_centavos, i.moeda, formatarBRL);
  return `Resultado ${i.resultado_original_centavos > 0 ? "+" : ""}${v}${i.resultado_pct !== null ? ` (${percentualTexto(i.resultado_pct)})` : ""}`;
}

function LinhaAtivo({ item, aberto, onPress, total, aoSalvar, aoRemover }: { item: ItemDaCarteira; aberto: boolean; onPress: () => void; total: number; aoSalvar: (chave: string, alteracao: Record<string, unknown>) => Promise<void>; aoRemover: (item: ItemDaCarteira) => void }) {
  const t = useTema();
  const saldo = item.saldo_centavos === null ? "sem câmbio" : formatarBRL(item.saldo_centavos);
  const res = resultado(item);
  const pct = item.saldo_centavos !== null && total > 0 ? ` · ${((item.saldo_centavos / total) * 100).toFixed(1).replace(".", ",")}% do patrimônio` : "";
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: aberto }}
        accessibilityLabel={`${item.ativo}: saldo bruto ${saldo}. ${resumo(item)}. ${res ?? ""} ${aberto ? "Recolher" : "Ver detalhes"}`}
        onPress={onPress}
        style={({ pressed }) => ({ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 28, paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ transform: [{ rotate: aberto ? "90deg" : "0deg" }] }}><Icone nome="seta" cor={t.suave} tamanho={14} /></View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ color: t.texto, fontSize: 14, fontWeight: "500" }}>{item.ativo}</Text>
          <Text style={{ color: t.suave, fontSize: 12 }}>{resumo(item) + pct}</Text>
          {res ? <Text style={{ color: item.resultado_original_centavos! < 0 ? t.perigo : t.ok, fontSize: 12, fontWeight: "600" }}>{res}</Text> : null}
        </View>
        <Text style={{ color: item.saldo_centavos === null ? t.perigo : t.texto, fontSize: 14, fontWeight: "700" }}>{saldo}</Text>
      </Pressable>
      {aberto ? <LiberdadeAtivo item={item} aoSalvar={aoSalvar} aoRemover={item.origem === "manual" ? () => aoRemover(item) : undefined} /> : null}
    </View>
  );
}

/**
 * Carteira em hierarquia: gênero (recolhível) > espécie > ativo. Os totais de cada nível somam o patrimônio; o que foi marcado como Meta
 * (reserva ou provisão) aparece como gênero à parte. Toque em um ativo para ver o detalhe, os movimentos do mês e editar o cadastro.
 */
export function LiberdadeCarteira({ carteira: c, mes, aoSalvarCadastro, aoRemoverPosicao }: { carteira: Carteira; mes: string; aoSalvarCadastro: (chave: string, alteracao: Record<string, unknown>) => Promise<void>; aoRemoverPosicao: (item: ItemDaCarteira) => void }) {
  const t = useTema();
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const alternar = (k: string) => setAbertos((a) => ({ ...a, [k]: !a[k] }));
  const somaGeneros = c.generos.reduce((s, g) => s + g.total_centavos, 0);
  const pct = (v: number) => (c.total_centavos !== 0 ? `${((v / c.total_centavos) * 100).toFixed(1).replace(".", ",")}% do patrimônio` : "");
  return (
    <Cartao titulo="Carteira por gênero, espécie e ativo">
      {c.generos.length === 0 ? (
        <Texto suave>{`Nenhuma posição até ${nomeMes(mes)}.`}</Texto>
      ) : (
        <View>
          {c.generos.map((g) => (
            <View key={g.id} style={{ borderTopWidth: 1, borderTopColor: t.borda }}>
              <Cabecalho nivel={1} aberto={!!abertos[g.id]} onPress={() => alternar(g.id)} titulo={g.rotulo} valor={formatarBRL(g.total_centavos)} detalhe={`${g.especies.reduce((s, e) => s + e.itens.length, 0)} item(ns) · ${pct(g.total_centavos)}`} />
              {abertos[g.id]
                ? g.especies.map((e) => {
                    const k = `${g.id}|${e.especie}`;
                    return (
                      <View key={k}>
                        <Cabecalho nivel={2} aberto={!!abertos[k]} onPress={() => alternar(k)} titulo={e.especie} valor={formatarBRL(e.total_centavos)} detalhe={`${e.itens.length} ativo(s)`} />
                        {abertos[k] ? e.itens.map((i) => <LinhaAtivo key={i.id} item={i} aberto={!!abertos[`a${i.id}`]} onPress={() => alternar(`a${i.id}`)} total={c.total_centavos} aoSalvar={aoSalvarCadastro} aoRemover={aoRemoverPosicao} />) : null}
                      </View>
                    );
                  })
                : null}
            </View>
          ))}
          <View accessible accessibilityLabel={`Soma dos gêneros ${formatarBRL(somaGeneros)}; patrimônio ${formatarBRL(c.total_centavos)}`} style={{ borderTopWidth: 1, borderTopColor: t.borda, paddingTop: 8, flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>Patrimônio total</Text>
            <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>{formatarBRL(somaGeneros)}</Text>
          </View>
          <Texto suave pequeno>{somaGeneros === c.total_centavos ? "A soma dos gêneros é igual ao patrimônio. Valores em trânsito (compras a liquidar, proventos a receber, contribuições a creditar) estão em um gênero próprio e podem ser negativos." : `Atenção: a soma dos gêneros (${formatarBRL(somaGeneros)}) difere do patrimônio (${formatarBRL(c.total_centavos)}).`}</Texto>
        </View>
      )}
      {c.sem_cambio.length > 0 ? <Texto suave pequeno>{`${c.sem_cambio.length} item(ns) em dólar sem taxa de câmbio aparecem na lista, mas ficam fora dos totais. Informe a taxa em Câmbio.`}</Texto> : null}
      <Texto suave pequeno>Toque em um gênero, depois na espécie e no ativo. PM = preço médio ("não informado" quando o extrato mostra "-", como nos ativos depositados: informe no detalhe do ativo).</Texto>
    </Cartao>
  );
}
