import { useColorScheme } from "react-native";

const CLARO = { fundo: "#F4F5F7", cartao: "#FFFFFF", texto: "#14181F", suave: "#5B6472", borda: "#DDE1E7", primaria: "#1F5FBF", sobrePrimaria: "#FFFFFF", alerta: "#B45309", perigo: "#B42318", ok: "#1B7F4B", barra: "#1F5FBF", suave2: "#EEF1F6", receita: "#1B7F4B", despesa: "#B42318" };
const ESCURO = { fundo: "#0E1116", cartao: "#171B22", texto: "#EEF1F5", suave: "#9AA4B2", borda: "#2A313B", primaria: "#6EA2F5", sobrePrimaria: "#0E1116", alerta: "#F5B25E", perigo: "#F28B82", ok: "#6CCB97", barra: "#6EA2F5", suave2: "#222833", receita: "#6CCB97", despesa: "#F28B82" };

export type Tema = typeof CLARO;

export function useTema(): Tema {
  return useColorScheme() === "dark" ? ESCURO : CLARO;
}
