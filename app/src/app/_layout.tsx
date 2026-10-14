import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Bloqueio } from "../components/bloqueio";
import { PainelLateralProvider } from "../components/painel-lateral";
import { useTema } from "../components/tema";
import { ToastProvider } from "../components/toast";
import { Aviso } from "../components/ui";
import { prepararDados } from "../data/preparo";

export default function LayoutRaiz() {
  const t = useTema();
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    prepararDados().then(
      () => setPronto(true),
      (e) => setErro(e instanceof Error ? e.message : "Não foi possível abrir o banco de dados."),
    );
  }, []);

  if (erro) {
    return (
      <View style={{ flex: 1, backgroundColor: t.fundo, padding: 24, justifyContent: "center" }}>
        <Aviso tipo="erro">{erro}</Aviso>
      </View>
    );
  }
  if (!pronto) {
    return (
      <View style={{ flex: 1, backgroundColor: t.fundo, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={t.primaria} />
      </View>
    );
  }

  return (
    <Bloqueio>
      <ToastProvider>
        <PainelLateralProvider>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: t.cartao },
              headerTitleStyle: { color: t.texto },
              headerTintColor: t.primaria,
              headerBackButtonDisplayMode: "minimal",
              contentStyle: { backgroundColor: t.fundo },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="lancamento/[id]" options={{ title: "Editar lançamento" }} />
            <Stack.Screen name="importar" options={{ title: "Importar documento" }} />
            <Stack.Screen name="eventos" options={{ title: "Viagens e eventos" }} />
            <Stack.Screen name="evento/[id]" options={{ title: "Evento" }} />
            <Stack.Screen name="recorrentes" options={{ title: "Gastos recorrentes" }} />
            <Stack.Screen name="metas" options={{ title: "Metas e cenários" }} />
            <Stack.Screen name="cartoes" options={{ title: "Cartões" }} />
            <Stack.Screen name="seguranca" options={{ title: "Backup e segurança" }} />
          </Stack>
        </PainelLateralProvider>
      </ToastProvider>
    </Bloqueio>
  );
}
