import * as SecureStore from "expo-secure-store";

/**
 * Senhas de PDF de fatura, por cartão, guardadas no Chaveiro do iPhone (nunca no banco de dados, nunca no backup).
 * Na prévia web, onde não há Chaveiro, ficam só em memória.
 */
const memoria = new Map<string, string>();
const chave = (cartaoId: number) => `pdf_senha_${cartaoId}`;

export async function lerSenhaPdf(cartaoId: number): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(chave(cartaoId));
  } catch {
    return memoria.get(chave(cartaoId)) ?? null;
  }
}

export async function salvarSenhaPdf(cartaoId: number, senha: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(chave(cartaoId), senha);
  } catch {
    memoria.set(chave(cartaoId), senha);
  }
}

export async function apagarSenhaPdf(cartaoId: number): Promise<void> {
  memoria.delete(chave(cartaoId));
  try {
    await SecureStore.deleteItemAsync(chave(cartaoId));
  } catch {
    /* sem Chaveiro: nada a apagar */
  }
}
