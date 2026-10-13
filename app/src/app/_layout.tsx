import { Tabs } from "expo-router";
import { useTema } from "../components/tema";

export default function LayoutRaiz() {
  const t = useTema();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.cartao },
        headerTitleStyle: { color: t.texto },
        tabBarStyle: { backgroundColor: t.cartao, borderTopColor: t.borda },
        tabBarActiveTintColor: t.primaria,
        tabBarInactiveTintColor: t.suave,
        tabBarLabelStyle: { fontSize: 13, fontWeight: "600" },
        tabBarIconStyle: { display: "none" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Lancar", tabBarLabel: "Lancar" }} />
      <Tabs.Screen name="pendentes" options={{ title: "Revisar", tabBarLabel: "Revisar" }} />
      <Tabs.Screen name="painel" options={{ title: "Painel", tabBarLabel: "Painel" }} />
      <Tabs.Screen name="calendario" options={{ title: "Calendario", tabBarLabel: "Gastos" }} />
      <Tabs.Screen name="ajustes" options={{ title: "Ajustes", tabBarLabel: "Ajustes" }} />
    </Tabs>
  );
}
