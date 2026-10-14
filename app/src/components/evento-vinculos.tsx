import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { rotuloCompleto } from "../../../core/src/index";
import { api } from "../lib/api";
import { dataBR, formatarBRL } from "../lib/format";
import { useTema } from "./tema";
import { Aviso, Botao, BotaoIcone, Campo, Cartao, Texto } from "./ui";

type Gasto = Awaited<ReturnType<typeof api.candidatosParaEvento>>[number];

const FORMAS: Record<string, string> = { credito: "cartão de crédito", debito: "débito", pix: "Pix", boleto: "boleto", dinheiro: "dinheiro", transferencia: "transferência" };

/** Uma linha de gasto com tudo o que identifica a compra: descrição inteira, data e hora, categoria, forma de pagamento, cartão, parcela e o texto original do extrato. */
function Linha({ g, marcado, aoAlternar }: { g: Gasto; marcado: boolean; aoAlternar: () => void }) {
  const t = useTema();
  const dist = g.distancia_dias > 0 ? `${g.distancia_dias} dia(s) fora do período` : "dentro do período";
  const forma = g.forma_pagamento ? FORMAS[g.forma_pagamento] ?? g.forma_pagamento : null;
  const meio = [forma, g.cartao ? `cartão ${g.cartao}` : null, g.parcela_total ? `parcela ${g.parcela_atual ?? "?"}/${g.parcela_total}` : null].filter(Boolean).join(" · ");
  // O texto original so aparece quando acrescenta algo a descricao simplificada.
  const original = g.texto_bruto && g.texto_bruto.trim() !== g.descricao.trim() ? g.texto_bruto.trim() : null;
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: marcado }} accessibilityLabel={`${g.descricao}, ${formatarBRL(g.valor_centavos)}, ${dataBR(g.data_local)}`} onPress={aoAlternar} style={[estilos.linha, { borderColor: marcado ? t.primaria : t.borda, backgroundColor: marcado ? t.suave2 : "transparent" }]}>
      <View style={[estilos.caixa, { borderColor: marcado ? t.primaria : t.suave, backgroundColor: marcado ? t.primaria : "transparent" }]}>
        {marcado ? <Text style={{ color: t.sobrePrimaria, fontSize: 14, fontWeight: "800" }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>{g.descricao}</Text>
        <Text style={{ color: t.suave, fontSize: 13 }}>{dataBR(g.data_local)}{g.hora_local !== null ? ` às ${String(g.hora_local).padStart(2, "0")}h` : ""} · {dist}</Text>
        <Text style={{ color: t.suave, fontSize: 13 }}>{rotuloCompleto(g.categoria)}</Text>
        {meio ? <Text style={{ color: t.suave, fontSize: 13 }}>{meio}</Text> : null}
        {original ? <Text style={{ color: t.suave, fontSize: 12, fontStyle: "italic" }} numberOfLines={4}>No extrato: {original}</Text> : null}
        {g.evento_id ? <Text style={{ color: t.alerta, fontSize: 12, fontWeight: "600" }}>Já está em outro evento: marcar o move para este.</Text> : null}
      </View>
      <Text style={{ color: t.texto, fontSize: 15, fontWeight: "700" }}>{formatarBRL(g.valor_centavos)}</Text>
    </Pressable>
  );
}

/**
 * Gastos do período que não entraram sozinhos no evento (mercado, compras, saúde...): o usuário confere e inclui os que
 * foram da viagem. Contas da casa, entradas, assinaturas e parcelas nunca aparecem aqui.
 */
export function SugestoesDoPeriodo({ eventoId, aoVincular, versao }: { eventoId: number; aoVincular: (n: number) => void; versao: number }) {
  const [lista, setLista] = useState<Gasto[]>([]);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  useEffect(() => {
    api.sugestoesDoPeriodo(eventoId).then((l) => { setLista(l); setMarcados(new Set()); }, () => setLista([]));
  }, [eventoId, versao]);
  if (lista.length === 0) return null;
  const alterna = (id: number) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Cartao titulo={`Conferir gastos do período (${lista.length})`}>
      <Texto suave pequeno>Estes gastos aconteceram durante o evento, mas não foram vinculados sozinhos porque podem ser do dia a dia (mercado, compras, saúde). Marque os que foram do evento. Contas da casa, entradas, assinaturas e parcelas não são sugeridas.</Texto>
      {lista.map((g) => <Linha key={g.id} g={g} marcado={marcados.has(g.id)} aoAlternar={() => alterna(g.id)} />)}
      <Botao rotulo={marcados.size > 0 ? `Incluir ${marcados.size} no evento` : "Marque os gastos do evento"} desabilitado={marcados.size === 0} onPress={async () => aoVincular(await api.vincularLancamentos(eventoId, [...marcados]))} />
    </Cartao>
  );
}

/** Vincular a mão gastos de qualquer data (reserva de hotel feita antes, passagem comprada com antecedência). */
export function VincularGastos({ visivel, eventoId, aoFechar, aoVincular }: { visivel: boolean; eventoId: number; aoFechar: () => void; aoVincular: (n: number) => void }) {
  const t = useTema();
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<Gasto[]>([]);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!visivel) return;
    const espera = setTimeout(() => api.candidatosParaEvento(eventoId, busca).then((l) => { setLista(l); setErro(null); }, (e) => setErro(e instanceof Error ? e.message : "Falha ao buscar.")), 200);
    return () => clearTimeout(espera);
  }, [visivel, eventoId, busca]);
  const alterna = (id: number) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Modal visible={visivel} animationType="slide" presentationStyle="pageSheet" onRequestClose={aoFechar}>
      <View style={[estilos.raiz, { backgroundColor: t.fundo }]}>
        <View style={estilos.topo}>
          <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 20, fontWeight: "700", flex: 1 }}>Vincular gastos ao evento</Text>
          <BotaoIcone icone="fechar" rotulo="Fechar" onPress={aoFechar} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <Texto suave pequeno>Qualquer gasto pode ser vinculado, mesmo de outra data: a reserva do hotel ou a passagem comprada antes da viagem. Primeiro aparecem os gastos de viagem sem evento; depois, os mais próximos do período.</Texto>
          <Campo rotulo="Buscar por descrição" value={busca} onChangeText={setBusca} placeholder="Ex.: hotel, passagem, azul" autoCorrect={false} />
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        </View>
        <FlatList
          data={lista}
          keyExtractor={(g) => String(g.id)}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 100 }}
          renderItem={({ item }) => <Linha g={item} marcado={marcados.has(item.id)} aoAlternar={() => alterna(item.id)} />}
          ListEmptyComponent={<Texto suave>Nenhum gasto encontrado.</Texto>}
        />
        <View style={[estilos.rodape, { backgroundColor: t.cartao, borderTopColor: t.borda }]}>
          <Botao
            rotulo={marcados.size > 0 ? `Vincular ${marcados.size} gasto(s)` : "Marque os gastos a vincular"}
            desabilitado={marcados.size === 0}
            onPress={async () => {
              const n = await api.vincularLancamentos(eventoId, [...marcados]);
              setMarcados(new Set());
              aoVincular(n);
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, paddingTop: 12 },
  topo: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 8 },
  linha: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 56 },
  caixa: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  rodape: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, borderTopWidth: 1 },
});
