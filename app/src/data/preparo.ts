import { api } from "../lib/api";
import { iniciarBanco } from "./banco";

/** Abre o banco e gera os lançamentos das recorrências que já venceram. Chamada ao iniciar o aplicativo. */
export async function prepararDados(): Promise<void> {
  await iniciarBanco();
  await api.gerarRecorrencias();
}
