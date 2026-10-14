import { Redirect } from "expo-router";

/** O extrato agora é a última seção do Painel, ligada aos gráficos; esta rota só leva para lá. */
export default function Extrato() {
  return <Redirect href="/painel?secao=extrato" />;
}
