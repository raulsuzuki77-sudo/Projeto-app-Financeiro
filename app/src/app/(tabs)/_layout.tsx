import { Tabs } from "expo-router";
import { Icone, type NomeIcone } from "../../components/icone";
import { usePainelLateral } from "../../components/painel-lateral";
import { useTema } from "../../components/tema";
import { BotaoIcone } from "../../components/ui";

const icone = (nome: NomeIcone) =>
  function Aba({ color }: { color: unknown }) {
    return <Icone nome={nome} cor={String(color)} />;
  };

export default function LayoutAbas() {
  const t = useTema();
  const { abrir } = usePainelLateral();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.cartao },
        headerTitleStyle: { color: t.texto },
        headerLeft: () => <BotaoIcone icone="menu" rotulo="Abrir menu" onPress={abrir} />,
        tabBarStyle: { backgroundColor: t.cartao, borderTopColor: t.borda },
        tabBarActiveTintColor: t.primaria,
        tabBarInactiveTintColor: t.suave,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        sceneStyle: { backgroundColor: t.fundo },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Início", tabBarIcon: icone("inicio") }} />
      <Tabs.Screen name="extrato" options={{ title: "Extrato", tabBarIcon: icone("extrato") }} />
      <Tabs.Screen name="revisar" options={{ title: "Revisar", tabBarIcon: icone("revisar") }} />
      <Tabs.Screen name="painel" options={{ title: "Painel", tabBarIcon: icone("painel") }} />
    </Tabs>
  );
}
