import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ROTULO_CLASSE, type ClasseAtivo } from "../../../core/src/index";
import { Icone } from "./icone";
import { useTema } from "./tema";
import { BotaoIcone, Cartao, Texto } from "./ui";
import type { DadosLiberdade } from "../lib/api";
import { formatarBRL, nomeMes } from "../lib/format";
import { formatarUSD, mesCurto } from "../lib/investimentos";

type Posicao = DadosLiberdade["patrimonio"]["posicoes"][number];

function Cabecalho({ aberto, onPress, titulo, valor, detalhe, nivel }: { aberto: boolean; onPress: () => void; titulo: string; valor: string; detalhe?: string; nivel: 1 | 2 }) {
  const t = useTema();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: aberto }}
      accessibilityLabel={`${titulo}: ${valor}. ${aberto ? "Recolher" : "Expandir"}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: nivel === 2 ? 14 : 0, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ transform: [{ rotate: aberto ? "90deg" : "0deg" }] }}><Icone nome="seta" cor={t.suave} tamanho={18} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.texto, fontSize: nivel === 1 ? 16 : 14, fontWeight: nivel === 1 ? "700" : "600" }}>{titulo}</Text>
        {detalhe ? <Text style={{ color: t.suave, fontSize: 12 }}>{detalhe}</Text> : null}
      </View>
      <Text style={{ color: t.texto, fontSize: nivel === 1 ? 16 : 14, fontWeight: "700" }}>{valor}</Text>
    </Pressable>
  );
}

function LinhaPosicao({ p, aoRemover }: { p: Posicao; aoRemover: (p: Posicao) => void }) {
  const t = useTema();
  const usd = p.moeda === "USD";
  const brl = p.valor_centavos === null ? "sem câmbio" : formatarBRL(p.valor_centavos);
  const detalhes = [p.codigo, p.quantidade !== null ? `${String(p.quantidade).replace(".", ",")} un.` : null, usd ? formatarUSD(p.valor_original_centavos) : null, p.defasado ? `posição de ${mesCurto(p.mes_snapshot)}` : null, p.origem === "manual" ? "lançada manualmente" : null].filter(Boolean).join(" · ");
  return (
    <View accessible accessibilityLabel={`${p.ativo}: ${brl}${detalhes ? `. ${detalhes}` : ""}`} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 40, paddingVertical: 4 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.texto, fontSize: 14 }}>{p.ativo}</Text>
        {detalhes ? <Text style={{ color: t.suave, fontSize: 12 }}>{detalhes}</Text> : null}
      </View>
      <Text style={{ color: p.valor_centavos === null ? t.perigo : t.texto, fontSize: 14, fontWeight: "600" }}>{brl}</Text>
      {p.origem === "manual" ? <BotaoIcone icone="lixeira" rotulo={`Remover posição ${p.ativo}`} cor={t.perigo} onPress={() => aoRemover(p)} /> : null}
    </View>
  );
}

/** Posições do mês agrupadas por instituição e classe; recolhidas, mostram só o total. */
export function LiberdadePosicoes({ patrimonio: p, mes, aoRemover }: { patrimonio: DadosLiberdade["patrimonio"]; mes: string; aoRemover: (p: Posicao) => void }) {
  const t = useTema();
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const alternar = (k: string) => setAbertos((a) => ({ ...a, [k]: !a[k] }));
  const grupos = useMemo(() => {
    const porInst = new Map<string, Map<ClasseAtivo, Posicao[]>>();
    for (const x of p.posicoes) {
      const m = porInst.get(x.instituicao) ?? new Map<ClasseAtivo, Posicao[]>();
      m.set(x.classe_ativo, [...(m.get(x.classe_ativo) ?? []), x]);
      porInst.set(x.instituicao, m);
    }
    const soma = (ps: Posicao[]) => ps.reduce((s, x) => s + (x.valor_centavos ?? 0), 0);
    return [...porInst.entries()]
      .map(([inst, classes]) => ({
        inst,
        total: soma([...classes.values()].flat()),
        qtd: [...classes.values()].flat().length,
        classes: [...classes.entries()]
          .map(([classe, ps]) => ({ classe, total: soma(ps), posicoes: [...ps].sort((a, b) => (b.valor_centavos ?? -Infinity) - (a.valor_centavos ?? -Infinity)) }))
          .sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.total - a.total);
  }, [p.posicoes]);

  return (
    <Cartao titulo="Posições">
      {grupos.length === 0 ? (
        <Texto suave>{`Nenhuma posição até ${nomeMes(mes)}.`}</Texto>
      ) : (
        <View>
          {grupos.map((g) => (
            <View key={g.inst} style={{ borderTopWidth: 1, borderTopColor: t.borda }}>
              <Cabecalho nivel={1} aberto={!!abertos[g.inst]} onPress={() => alternar(g.inst)} titulo={g.inst} valor={formatarBRL(g.total)} detalhe={`${g.qtd} posição(ões)`} />
              {abertos[g.inst]
                ? g.classes.map((c) => {
                    const k = `${g.inst}|${c.classe}`;
                    return (
                      <View key={k}>
                        <Cabecalho nivel={2} aberto={!!abertos[k]} onPress={() => alternar(k)} titulo={ROTULO_CLASSE[c.classe]} valor={formatarBRL(c.total)} detalhe={`${c.posicoes.length} posição(ões)`} />
                        {abertos[k] ? c.posicoes.map((x) => <LinhaPosicao key={x.id} p={x} aoRemover={aoRemover} />) : null}
                      </View>
                    );
                  })
                : null}
            </View>
          ))}
        </View>
      )}
      <Texto suave pequeno>Toque em uma instituição ou classe para ver as posições, em ordem decrescente de valor.</Texto>
    </Cartao>
  );
}
