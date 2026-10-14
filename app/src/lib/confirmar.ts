import { Alert, Platform } from "react-native";

/** Pergunta sim ou nao ao usuario (Alert no iPhone, janela de confirmacao no navegador). */
export function confirmar(titulo: string, mensagem: string, rotulo = "Confirmar", destrutivo = true): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(typeof window !== "undefined" && window.confirm(`${titulo}\n\n${mensagem}`));
  return new Promise((resolve) => {
    Alert.alert(titulo, mensagem, [
      { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
      { text: rotulo, style: destrutivo ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
