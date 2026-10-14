import { useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CLASSES, ITEM_RECEITA, classePadraoDaCategoria, type ClasseId } from "../../../core/src/index";
import { api } from "../lib/api";
import { formatarBRL, mascaraDeCentavos, nomeMes, reaisParaCentavos } from "../lib/format";
import { useTema } from "./tema";
import { Aviso, Botao, BotaoIcone, Campo, CampoValor, Chip, GrupoChips, Segmentado, Texto } from "./ui";

export type ClasseDoItem = ClasseId | "sem_classe";

/** Item do orçamento que está sendo editado (categoria ou receita). */
export interface AlvoEdicao {
  item: string;
  rotulo: string;
  planejado: number;
  realizado: number;
  origem: "mes" | "padrao" | null;
  classe: ClasseDoItem | null;
}

const rotuloClasse = (id: ClasseDoItem | null | undefined) => (id && id !== "sem_classe" ? CLASSES.find((c) => c.id === id)?.rotulo ?? id : "Sem classe");
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível concluir a operação.");

/** Folha de tela cheia com título e botão de fechar. */
function Folha({ visivel, titulo, onFechar, children }: { visivel: boolean; titulo: string; onFechar: () => void; children: ReactNode }) {
  const t = useTema();
  return (
    <Modal visible={visivel} animationType="slide" presentationStyle="pageSheet" onRequestClose={onFechar} supportedOrientations={["portrait", "landscape"]}>
      <View style={[estilos.raiz, { backgroundColor: t.fundo }]}>
        <View style={estilos.topo}>
          <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 20, fontWeight: "700", flex: 1 }}>{titulo}</Text>
          <BotaoIcone icone="fechar" rotulo="Fechar" onPress={onFechar} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

function descricaoOrigem(origem: AlvoEdicao["origem"]): string {
  if (origem === "mes") return "valor deste mês";
  if (origem === "padrao") return "padrão de todos os meses";
  return "sem valor planejado";
}

/** Editor do valor planejado de um item (ou da receita), com escopo explícito e mudança de classe da categoria. */
export function EditorItem({ alvo, mes, onFechar, onConcluir }: { alvo: AlvoEdicao | null; mes: string; onFechar: () => void; onConcluir: (mensagem: string) => void }) {
  return (
    <Folha visivel={alvo !== null} titulo={alvo?.item === ITEM_RECEITA ? "Receita planejada" : "Valor planejado"} onFechar={onFechar}>
      {alvo ? <ConteudoEditor key={alvo.item} alvo={alvo} mes={mes} onConcluir={onConcluir} /> : null}
    </Folha>
  );
}

function ConteudoEditor({ alvo, mes, onConcluir }: { alvo: AlvoEdicao; mes: string; onConcluir: (m: string) => void }) {
  const t = useTema();
  const receita = alvo.item === ITEM_RECEITA;
  const [valor, setValor] = useState(alvo.planejado > 0 ? mascaraDeCentavos(alvo.planejado) : "");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmaRemocao, setConfirmaRemocao] = useState(false);
  const [classeSel, setClasseSel] = useState<ClasseId | "padrao" | null>(null);

  const vigente = alvo.classe === "sem_classe" ? null : alvo.classe;
  const padrao = receita ? null : classePadraoDaCategoria(alvo.item);
  const podeVoltarAoPadrao = !receita && padrao !== vigente;

  async function executar(fn: () => Promise<void>, mensagem: string) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      onConcluir(mensagem);
    } catch (e) {
      setErro(msgErro(e));
      setOcupado(false);
    }
  }

  function lerValor(): number | null {
    const c = reaisParaCentavos(valor);
    if (c === null) {
      setErro("Informe o valor em reais, por exemplo 1.250,00.");
      return null;
    }
    if (c <= 0) {
      setErro("Informe um valor maior que zero. Para retirar o item do orçamento, use \"Remover valor\".");
      return null;
    }
    return c;
  }

  function salvar(escopo: "mes" | "padrao") {
    const c = lerValor();
    if (c === null) return;
    const alvoNome = receita ? "Receita planejada" : alvo.rotulo;
    if (escopo === "mes") void executar(() => api.definirOrcamento(mes, alvo.item, c), `${alvoNome}: ${formatarBRL(c)} para ${nomeMes(mes)}.`);
    else {
      const aviso = alvo.origem === "mes" ? " Este mês mantém o valor próprio." : "";
      void executar(() => api.definirOrcamento("*", alvo.item, c), `${alvoNome}: ${formatarBRL(c)} como padrão de todos os meses.${aviso}`);
    }
  }

  function remover() {
    if (alvo.origem === null) return;
    if (alvo.origem === "padrao" && !confirmaRemocao) {
      setConfirmaRemocao(true);
      return;
    }
    const escopo = alvo.origem === "mes" ? mes : "*";
    const msg = alvo.origem === "mes" ? "Valor deste mês removido; o mês volta a usar o padrão, se houver." : "Valor padrão removido de todos os meses sem valor próprio.";
    void executar(() => api.removerOrcamento(escopo, alvo.item), msg);
  }

  function aplicarClasse() {
    if (classeSel === null) return;
    const destino = classeSel === "padrao" ? null : classeSel;
    const nome = classeSel === "padrao" ? rotuloClasse(padrao ?? "sem_classe") : rotuloClasse(classeSel);
    void executar(() => api.definirClasse(alvo.item, destino), `${alvo.rotulo} agora está em ${nome}.`);
  }

  return (
    <>
      <View style={{ gap: 4 }}>
        <Text style={{ color: t.texto, fontSize: 18, fontWeight: "700" }}>{alvo.rotulo}</Text>
        {!receita ? <Texto suave pequeno>{`Classe em vigor: ${rotuloClasse(alvo.classe)}`}</Texto> : null}
        <Texto suave pequeno>{`${receita ? "Receita realizada" : "Realizado"} em ${nomeMes(mes)}: ${formatarBRL(alvo.realizado)}`}</Texto>
        <Texto suave pequeno>{alvo.origem ? `Valor atual: ${formatarBRL(alvo.planejado)} (${descricaoOrigem(alvo.origem)})` : "Valor atual: sem valor planejado"}</Texto>
      </View>

      <CampoValor rotulo={receita ? "Receita planejada" : "Valor planejado"} value={valor} onChangeText={setValor} accessibilityHint="Digite apenas números; a vírgula é inserida automaticamente" />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      <View style={{ gap: 10 }}>
        <Botao rotulo="Salvar para este mês" onPress={() => salvar("mes")} carregando={ocupado} />
        <Texto suave pequeno>{`Vale só para ${nomeMes(mes)} e prevalece sobre o padrão.`}</Texto>
        <Botao rotulo="Salvar como padrão de todos os meses" secundario onPress={() => salvar("padrao")} desabilitado={ocupado} />
        <Texto suave pequeno>{alvo.origem === "mes" ? "Este mês tem valor próprio e continua com ele; o padrão vale para os demais meses sem valor próprio." : "Vale para todos os meses que não tiverem valor próprio."}</Texto>
      </View>

      {alvo.origem !== null ? (
        <View style={{ gap: 10 }}>
          {confirmaRemocao ? <Aviso tipo="info">Remover o padrão afeta todos os meses sem valor próprio. Toque novamente para confirmar.</Aviso> : null}
          <Botao rotulo={confirmaRemocao ? "Confirmar remoção do padrão" : "Remover valor"} perigo onPress={remover} desabilitado={ocupado} />
          <Texto suave pequeno>{alvo.origem === "mes" ? `Remove o valor próprio de ${nomeMes(mes)}.` : "Remove o padrão de todos os meses (este mês não tem valor próprio)."}</Texto>
        </View>
      ) : null}

      {!receita ? (
        <View style={[estilos.bloco, { borderTopColor: t.borda }]}>
          <Text accessibilityRole="header" style={{ color: t.primaria, fontSize: 16, fontWeight: "700" }}>Mudar classe da categoria</Text>
          <Texto suave pequeno>A classe vale para todos os meses e muda o agrupamento desta categoria no orçamento.</Texto>
          <GrupoChips>
            {CLASSES.map((c) => (
              <Chip key={c.id} rotulo={c.rotulo} ativo={classeSel === null ? vigente === c.id : classeSel === c.id} onPress={() => setClasseSel(c.id === vigente ? null : c.id)} />
            ))}
            {podeVoltarAoPadrao ? <Chip rotulo={`Voltar ao padrão (${rotuloClasse(padrao ?? "sem_classe")})`} destaque ativo={classeSel === "padrao"} onPress={() => setClasseSel("padrao")} /> : null}
          </GrupoChips>
          {classeSel !== null ? <Botao rotulo="Aplicar classe" secundario onPress={aplicarClasse} carregando={ocupado} /> : null}
        </View>
      ) : null}
    </>
  );
}

/** Lista de categorias por classe, para escolher qual item acrescentar ao orçamento. */
export function EscolherCategoria({ visivel, categorias, planejados, onEscolher, onFechar }: { visivel: boolean; categorias: { id: string; rotulo: string; classe: ClasseId }[]; planejados: Map<string, number>; onEscolher: (id: string) => void; onFechar: () => void }) {
  const t = useTema();
  const [busca, setBusca] = useState("");
  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return CLASSES.map((c) => ({ ...c, cats: categorias.filter((x) => x.classe === c.id && (!q || x.rotulo.toLowerCase().includes(q) || c.rotulo.toLowerCase().includes(q))) })).filter((g) => g.cats.length > 0);
  }, [categorias, busca]);
  return (
    <Folha visivel={visivel} titulo="Adicionar item ao orçamento" onFechar={onFechar}>
      <Texto suave pequeno>Escolha a categoria. Categorias que já têm valor planejado aparecem marcadas; escolhê-las abre o valor atual para edição.</Texto>
      <Campo rotulo="Buscar categoria" value={busca} onChangeText={setBusca} placeholder="Buscar categoria" autoCorrect={false} />
      {grupos.length === 0 ? <Texto suave>Nenhuma categoria encontrada.</Texto> : null}
      {grupos.map((g) => (
        <View key={g.id} style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={{ color: t.primaria, fontSize: 17, fontWeight: "800" }}>{g.rotulo}</Text>
          <View style={{ marginLeft: 16, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: t.borda }}>
            {g.cats.map((c) => {
              const v = planejados.get(c.id) ?? 0;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={v > 0 ? `${c.rotulo}, já planejada em ${formatarBRL(v)}` : `${c.rotulo}, sem valor planejado`}
                  accessibilityState={{ selected: v > 0 }}
                  onPress={() => {
                    setBusca("");
                    onEscolher(c.id);
                  }}
                  style={({ pressed }) => [estilos.linhaCat, { backgroundColor: pressed ? t.suave2 : "transparent" }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.texto, fontSize: 16 }}>{c.rotulo}</Text>
                    {v > 0 ? <Text style={{ color: t.suave, fontSize: 12 }}>{`Já planejada: ${formatarBRL(v)}`}</Text> : null}
                  </View>
                  {v > 0 ? <Text style={{ color: t.ok, fontWeight: "700", fontSize: 13 }}>Planejada</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </Folha>
  );
}

interface LinhaSugestao {
  item: string;
  rotulo: string;
  incluir: boolean;
  valor: string;
}

/** Sugestão pela média dos meses anteriores: seleção e valores editáveis; só grava depois da confirmação. */
export function SugestaoMedia({ visivel, mes, sugestoes, atuais, onFechar, onConcluir }: { visivel: boolean; mes: string; sugestoes: { item: string; rotulo: string; valor_centavos: number }[]; atuais: Map<string, { valor: number; origem: "mes" | "padrao" | null }>; onFechar: () => void; onConcluir: (m: string) => void }) {
  return (
    <Folha visivel={visivel} titulo="Preencher pela média" onFechar={onFechar}>
      {visivel ? <ConteudoSugestao key={sugestoes.map((s) => s.item).join("|")} mes={mes} sugestoes={sugestoes} atuais={atuais} onConcluir={onConcluir} /> : null}
    </Folha>
  );
}

function ConteudoSugestao({ mes, sugestoes, atuais, onConcluir }: { mes: string; sugestoes: { item: string; rotulo: string; valor_centavos: number }[]; atuais: Map<string, { valor: number; origem: "mes" | "padrao" | null }>; onConcluir: (m: string) => void }) {
  const t = useTema();
  const [linhas, setLinhas] = useState<LinhaSugestao[]>(() => sugestoes.map((s) => ({ item: s.item, rotulo: s.rotulo, incluir: true, valor: mascaraDeCentavos(s.valor_centavos) })));
  const [escopo, setEscopo] = useState<"padrao" | "mes">("padrao");
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const marcadas = linhas.filter((l) => l.incluir);
  const alvoTexto = escopo === "padrao" ? "padrão de todos os meses" : nomeMes(mes);
  const comValorProprio = escopo === "padrao" ? marcadas.filter((l) => atuais.get(l.item)?.origem === "mes").length : 0;
  const sobrescreve = marcadas.filter((l) => {
    const a = atuais.get(l.item);
    return a && a.valor > 0 && (escopo === "mes" || a.origem === "padrao");
  }).length;

  function atualizar(item: string, parte: Partial<LinhaSugestao>) {
    setConfirmando(false);
    setLinhas((ls) => ls.map((l) => (l.item === item ? { ...l, ...parte } : l)));
  }

  function revisar() {
    setErro(null);
    if (marcadas.length === 0) return setErro("Marque ao menos um item para gravar.");
    const ruim = marcadas.find((l) => (reaisParaCentavos(l.valor) ?? 0) <= 0);
    if (ruim) return setErro(`Informe um valor maior que zero em "${ruim.rotulo}" ou desmarque o item.`);
    setConfirmando(true);
  }

  async function gravar() {
    setOcupado(true);
    setErro(null);
    let feitos = 0;
    try {
      for (const l of marcadas) {
        await api.definirOrcamento(escopo === "padrao" ? "*" : mes, l.item, reaisParaCentavos(l.valor) ?? 0);
        feitos++;
      }
      onConcluir(`${feitos} valor(es) gravado(s) como ${escopo === "padrao" ? "padrão de todos os meses" : `valores de ${nomeMes(mes)}`}.`);
    } catch (e) {
      setErro(`${msgErro(e)} Foram gravados ${feitos} de ${marcadas.length} itens antes da falha.`);
      setOcupado(false);
      setConfirmando(false);
    }
  }

  if (linhas.length === 0) {
    return <Texto suave>Não há gastos nos 3 meses anteriores a {nomeMes(mes)} para sugerir valores.</Texto>;
  }

  return (
    <>
      <Texto suave pequeno>Cada valor é a soma dos gastos dos 3 meses anteriores dividida por 3, arredondada para R$ 10. Meses sem lançamentos contam como zero. Revise, ajuste e escolha onde gravar; nada é gravado antes da sua confirmação.</Texto>
      <Segmentado rotulo="Onde gravar" valor={escopo} onChange={(v) => { setConfirmando(false); setEscopo(v); }} opcoes={[{ id: "padrao", rotulo: "Padrão de todos os meses" }, { id: "mes", rotulo: "Só neste mês" }]} />
      {linhas.map((l) => {
        const a = atuais.get(l.item);
        return (
          <View key={l.item} style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, opacity: l.incluir ? 1 : 0.5 }}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel={`Incluir ${l.rotulo}`} accessibilityState={{ checked: l.incluir }} onPress={() => atualizar(l.item, { incluir: !l.incluir })} style={estilos.caixaMarca} hitSlop={4}>
              <View style={[estilos.marca, { borderColor: l.incluir ? t.primaria : t.suave, backgroundColor: l.incluir ? t.primaria : "transparent" }]}>
                {l.incluir ? <View style={[estilos.visto, { borderColor: t.sobrePrimaria }]} /> : null}
              </View>
            </Pressable>
            <View style={{ flex: 1, gap: 2 }}>
              <CampoValor rotulo={l.rotulo} value={l.valor} onChangeText={(v) => atualizar(l.item, { valor: v })} editable={l.incluir} />
              <Text style={{ color: t.suave, fontSize: 12 }}>{a && a.valor > 0 ? `Hoje: ${formatarBRL(a.valor)} (${descricaoOrigem(a.origem)})` : "Hoje: sem valor planejado"}</Text>
            </View>
          </View>
        );
      })}
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {comValorProprio > 0 ? <Aviso tipo="info">{`${comValorProprio} item(ns) têm valor próprio em ${nomeMes(mes)} e continuarão com ele; o padrão vale para os demais meses.`}</Aviso> : null}
      {confirmando ? (
        <View style={{ gap: 10 }}>
          <Aviso tipo="info">{`Gravar ${marcadas.length} valor(es) como ${alvoTexto}?${sobrescreve > 0 ? ` ${sobrescreve} substituirá(ão) valor já existente.` : ""}`}</Aviso>
          <Botao rotulo="Confirmar e gravar" onPress={() => void gravar()} carregando={ocupado} />
          <Botao rotulo="Voltar e revisar" secundario onPress={() => setConfirmando(false)} desabilitado={ocupado} />
        </View>
      ) : (
        <Botao rotulo={`Revisar e gravar (${marcadas.length})`} onPress={revisar} />
      )}
    </>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, paddingTop: 12 },
  topo: { flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 8 },
  bloco: { gap: 10, borderTopWidth: 1, paddingTop: 16, marginTop: 4 },
  linhaCat: { minHeight: 48, paddingVertical: 6, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  caixaMarca: { width: 44, height: 48, marginTop: 22, alignItems: "center", justifyContent: "center" },
  visto: { width: 6, height: 12, borderRightWidth: 2.5, borderBottomWidth: 2.5, transform: [{ rotate: "45deg" }], marginTop: -2 },
  marca: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
