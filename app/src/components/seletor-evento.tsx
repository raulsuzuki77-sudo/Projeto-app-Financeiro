import { Text, View } from "react-native";
import { useTema } from "./tema";
import { Aviso, Botao, Chip, GrupoChips, Texto } from "./ui";

/** Campo "Evento" do lançamento: escolhe a que viagem ou férias o gasto pertence (segunda classificação, além da categoria). */
export function SeletorEvento({ eventos, valor, onChange, categoria, onNovo }: { eventos: { id: number; nome: string }[]; valor: number | null; onChange: (id: number | null) => void; categoria: string; onNovo: () => void }) {
  const t = useTema();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: t.suave, fontSize: 13 }}>Evento (viagem, férias)</Text>
      <GrupoChips>
        <Chip rotulo="Nenhum" ativo={valor === null} onPress={() => onChange(null)} />
        {eventos.map((e) => <Chip key={e.id} rotulo={e.nome} ativo={valor === e.id} onPress={() => onChange(e.id)} />)}
        <Chip rotulo="Novo evento..." destaque onPress={onNovo} />
      </GrupoChips>
      <Texto suave pequeno>O gasto conta no evento e continua na categoria, sem duplicar os totais de cada visão. A mudança vale ao salvar.</Texto>
      {categoria === "viagem" && valor === null ? (
        <>
          <Aviso tipo="info">Este gasto é de viagem e não pertence a nenhum evento. Informe o período da viagem para vincular os gastos do intervalo.</Aviso>
          <Botao rotulo="Informar o período da viagem" secundario pequeno onPress={onNovo} />
        </>
      ) : null}
    </View>
  );
}
