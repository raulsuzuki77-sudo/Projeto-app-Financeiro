import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { nomeSugeridoDoEvento, ROTULO_TIPO_EVENTO, TIPOS_EVENTO, type TipoEvento } from "../../../core/src/index";
import { dataParaISO } from "../lib/format";
import { Aviso, Botao, Campo, Segmentado } from "./ui";

/** Datas em dd/mm/aaaa, como o usuário digita. */
export interface DadosFormularioEvento {
  nome: string;
  tipo: TipoEvento;
  inicio: string;
  fim: string;
}

export interface EventoParaSalvar {
  nome: string;
  tipo: TipoEvento;
  data_inicio: string;
  data_fim: string;
}

/** Digita só os números; as barras entram sozinhas ("10092026" vira "10/09/2026"). */
export function mascaraData(texto: string): string {
  const d = texto.replace(/\D/g, "").slice(0, 8);
  return d.slice(0, 2) + (d.length > 2 ? `/${d.slice(2, 4)}` : "") + (d.length > 4 ? `/${d.slice(4)}` : "");
}

const OPCOES_TIPO = TIPOS_EVENTO.map((id) => ({ id, rotulo: ROTULO_TIPO_EVENTO[id] }));

function nomeSugerido(tipo: TipoEvento, inicio: string): string {
  const iso = inicio.length === 10 ? dataParaISO(inicio, new Date().getFullYear()) : null;
  return iso ? nomeSugeridoDoEvento(tipo, iso) : "";
}

/** Campos de um evento (nome, tipo e período), usados para criar e para editar. Erros do núcleo viram Aviso. */
export function FormularioEvento({ inicial, rotuloBotao, onEnviar, onCancelar, ajuda }: { inicial: DadosFormularioEvento; rotuloBotao: string; onEnviar: (e: EventoParaSalvar) => Promise<void>; onCancelar?: () => void; ajuda?: ReactNode }) {
  const [nome, setNome] = useState(inicial.nome);
  const [tipo, setTipo] = useState<TipoEvento>(inicial.tipo);
  const [inicio, setInicio] = useState(inicial.inicio);
  const [fim, setFim] = useState(inicial.fim);
  // Enquanto o nome estiver vazio ou for o sugerido, acompanha o tipo e a data de início.
  const [nomeAuto, setNomeAuto] = useState(inicial.nome === "" || inicial.nome === nomeSugerido(inicial.tipo, inicial.inicio));
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function mudar(novoTipo: TipoEvento, novoInicio: string) {
    setTipo(novoTipo);
    setInicio(novoInicio);
    if (nomeAuto) {
      const s = nomeSugerido(novoTipo, novoInicio);
      if (s) setNome(s);
    }
  }

  async function enviar() {
    setMsg(null);
    const ano = new Date().getFullYear();
    const di = dataParaISO(inicio, ano);
    const df = dataParaISO(fim, ano);
    if (!nome.trim()) return setMsg("Informe o nome do evento, por exemplo: Férias em Florianópolis.");
    if (!di) return setMsg("Data de início inválida. Use dd/mm/aaaa.");
    if (!df) return setMsg("Data de término inválida. Use dd/mm/aaaa.");
    setSalvando(true);
    try {
      await onEnviar({ nome: nome.trim(), tipo, data_inicio: di, data_fim: df });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível salvar o evento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Campo rotulo="Nome do evento" value={nome} maxLength={80} onChangeText={(v) => { setNome(v); setNomeAuto(v === ""); }} placeholder="Ex.: Férias em Florianópolis" />
      <Segmentado rotulo="Tipo do evento" valor={tipo} onChange={(v) => mudar(v, inicio)} opcoes={OPCOES_TIPO} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}><Campo rotulo="Início (dd/mm/aaaa)" value={inicio} onChangeText={(v) => mudar(tipo, mascaraData(v))} keyboardType="number-pad" placeholder="dd/mm/aaaa" maxLength={10} /></View>
        <View style={{ flex: 1 }}><Campo rotulo="Fim (dd/mm/aaaa)" value={fim} onChangeText={(v) => setFim(mascaraData(v))} keyboardType="number-pad" placeholder="dd/mm/aaaa" maxLength={10} /></View>
      </View>
      {ajuda}
      {msg ? <Aviso tipo="erro">{msg}</Aviso> : null}
      <Botao rotulo={rotuloBotao} onPress={enviar} carregando={salvando} />
      {onCancelar ? <Botao rotulo="Cancelar" secundario onPress={onCancelar} /> : null}
    </View>
  );
}
