import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CLASSES } from "../../../core/src/index";
import { api, type PainelOrcamento } from "../lib/api";
import { formatarBRL, formatarPercentual, nomeMes, percentualParaFracao } from "../lib/format";
import { PALETA } from "../lib/pizza";
import { Pizza } from "./pizza";
import { useTema } from "./tema";
import { Aviso, Botao, Campo, Cartao, Texto } from "./ui";

type Classe = PainelOrcamento["classes"][number];

const COR_DA_CLASSE = new Map<string, string>([...CLASSES.map((c, i) => [c.id as string, PALETA[i % PALETA.length]!] as [string, string]), ["sem_classe", "#8C8C8C"]]);

/** Barra de participação: a faixa cheia é o realizado; o traço vertical, o limite máximo definido pelo usuário. */
function Barra({ fracao, limite, cor, escala }: { fracao: number | null; limite: number | null; cor: string; escala: number }) {
  const t = useTema();
  const pct = fracao === null ? 0 : Math.max(0, Math.min(fracao / escala, 1)) * 100;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ height: 10, borderRadius: 5, backgroundColor: t.suave2, borderWidth: 1, borderColor: t.borda }}>
      <View style={{ height: 8, borderRadius: 4, width: `${pct}%`, backgroundColor: cor }} />
      {limite !== null ? <View style={{ position: "absolute", top: -3, bottom: -3, left: `${Math.min(limite / escala, 1) * 100}%`, width: 2, backgroundColor: t.texto }} /> : null}
    </View>
  );
}

function LinhaClasse({ c, escala, aoEditar, aoTocar }: { c: Classe; escala: number; aoEditar?: () => void; aoTocar?: () => void }) {
  const t = useTema();
  const cor = COR_DA_CLASSE.get(c.id) ?? t.primaria;
  const estado = c.limite_percentual === null ? "" : c.acima_do_limite ? ` · acima do limite de ${formatarPercentual(c.limite_percentual, 0)}` : ` · limite ${formatarPercentual(c.limite_percentual, 0)}`;
  return (
    <View style={{ gap: 4, minHeight: 48, justifyContent: "center" }}>
    <Pressable accessibilityRole={aoTocar ? "button" : "text"} accessibilityLabel={`${c.rotulo}: ${formatarPercentual(c.percentual_receita)} da receita, ${formatarBRL(c.realizado_centavos)}${estado}${aoTocar ? ". Toque para ver os lançamentos." : ""}`} onPress={aoTocar ?? aoEditar} style={({ pressed }) => ({ gap: 4, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: cor }} />
        <Text style={{ flex: 1, color: t.texto, fontSize: 15, fontWeight: "600" }}>{c.rotulo}</Text>
        <Text style={{ color: c.acima_do_limite ? t.perigo : t.texto, fontSize: 15, fontWeight: "800" }}>{formatarPercentual(c.percentual_receita)}</Text>
        <Text style={{ color: t.suave, fontSize: 13, minWidth: 96, textAlign: "right" }}>{formatarBRL(c.realizado_centavos)}</Text>
      </View>
      <Barra fracao={c.percentual_receita} limite={c.limite_percentual} cor={c.acima_do_limite ? t.perigo : cor} escala={escala} />
      {estado ? <Text style={{ color: c.acima_do_limite ? t.perigo : t.suave, fontSize: 12 }}>{estado.slice(3)}</Text> : null}
    </Pressable>
    {aoTocar && aoEditar ? <Pressable accessibilityRole="button" accessibilityLabel={`Editar o limite de ${c.rotulo}`} onPress={aoEditar} style={{ minHeight: 32, justifyContent: "center" }}><Text style={{ color: t.primaria, fontSize: 12, fontWeight: "600" }}>Editar limite</Text></Pressable> : null}
    </View>
  );
}

function EditorLimite({ c, aoConcluir }: { c: Classe; aoConcluir: () => void }) {
  const [texto, setTexto] = useState(c.limite_percentual !== null ? String(+(c.limite_percentual * 100).toFixed(1)).replace(".", ",") : "");
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    const f = percentualParaFracao(texto);
    if (f === null || f <= 0) return setErro("Informe um percentual entre 0 e 100, por exemplo 30.");
    try {
      await api.definirLimiteClasse(c.id as never, f);
      aoConcluir();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar o limite.");
    }
  }
  return (
    <View style={{ gap: 8, paddingLeft: 20 }}>
      <Campo rotulo={`Limite máximo de ${c.rotulo} (% da receita)`} value={texto} onChangeText={setTexto} keyboardType="decimal-pad" placeholder="Ex.: 30" />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Botao rotulo="Salvar limite" pequeno onPress={salvar} /></View>
        <View style={{ flex: 1 }}><Botao rotulo="Voltar ao padrão" pequeno secundario onPress={async () => { await api.definirLimiteClasse(c.id as never, null); aoConcluir(); }} /></View>
      </View>
      <Texto suave pequeno>Como na sua planilha, o limite é a fatia máxima da receita para a classe (o Custo fixo vem com 30%). O traço na barra marca o limite.</Texto>
    </View>
  );
}

/**
 * Participação de cada classe na receita do mês, como na planilha de acompanhamento (percentual sobre o salário), com o limite
 * máximo de cada classe. `pizza` mostra também o gráfico de pizza.
 */
export function ParticipacaoClasses({ painel, titulo, pizza, aoMudar, aoTocarClasse }: { painel: PainelOrcamento; titulo?: string; pizza?: boolean; aoMudar: () => void; aoTocarClasse?: (c: Classe) => void }) {
  const [editando, setEditando] = useState<string | null>(null);
  const classes = painel.classes.filter((c) => c.itens.length > 0 || c.id !== "sem_classe");
  const escala = Math.max(0.5, ...classes.map((c) => c.percentual_receita ?? 0), ...classes.map((c) => c.limite_percentual ?? 0));
  const total = classes.reduce((s, c) => s + c.realizado_centavos, 0);
  return (
    <Cartao titulo={titulo ?? `Classes sobre a receita, ${nomeMes(painel.mes)}`}>
      <Texto suave pequeno>{painel.base.centavos > 0 ? `Base (100%): ${formatarBRL(painel.base.centavos)}. ${painel.base.descricao}` : painel.base.descricao}</Texto>
      {pizza && total > 0 ? <Pizza dados={classes.map((c) => ({ id: c.id, rotulo: c.rotulo, valor: Math.max(0, c.realizado_centavos), cor: COR_DA_CLASSE.get(c.id) }))} tamanho={180} legenda={8} max={8} aoTocar={aoTocarClasse ? (id) => { const c = classes.find((x) => x.id === id); if (c) aoTocarClasse(c); } : undefined} /> : null}
      {classes.map((c) => (
        <View key={c.id} style={{ gap: 6 }}>
          <LinhaClasse c={c} escala={escala} aoEditar={c.id === "sem_classe" ? undefined : () => setEditando(editando === c.id ? null : c.id)} aoTocar={aoTocarClasse ? () => aoTocarClasse(c) : undefined} />
          {editando === c.id ? <EditorLimite c={c} aoConcluir={() => { setEditando(null); aoMudar(); }} /> : null}
        </View>
      ))}
      <Texto suave pequeno>Toque numa classe para ver os lançamentos dela; "Editar limite" define o limite máximo. Despesas e aportes do mês somam {formatarBRL(total)}{painel.base.centavos > 0 ? `, ou ${formatarPercentual(total / painel.base.centavos)} da base` : ""}.</Texto>
    </Cartao>
  );
}
