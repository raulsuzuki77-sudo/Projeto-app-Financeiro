import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const CHAVE = "bloqueio_biometrico";

export async function bloqueioAtivo(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(CHAVE)) === "1";
  } catch {
    return false;
  }
}

export async function biometriaDisponivel(): Promise<boolean> {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

/** Pede Face ID ou Touch ID; se a biometria falhar, o iOS oferece o codigo do aparelho. */
export async function autenticar(motivo = "Desbloquear o Controle Financeiro"): Promise<boolean> {
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: motivo, cancelLabel: "Cancelar" });
  return r.success;
}

/** Ativar exige uma autenticacao bem-sucedida agora, para nao trancar o usuario fora do proprio app. */
export async function definirBloqueio(ativo: boolean): Promise<{ ok: boolean; motivo?: string }> {
  if (ativo) {
    if (!(await biometriaDisponivel())) return { ok: false, motivo: "Este aparelho nao tem Face ID ou Touch ID configurado." };
    if (!(await autenticar("Confirme para ativar o bloqueio"))) return { ok: false, motivo: "Autenticacao nao concluida." };
  }
  await SecureStore.setItemAsync(CHAVE, ativo ? "1" : "0");
  return { ok: true };
}
