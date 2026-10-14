import * as DocumentPicker from "expo-document-picker";
import { cifrar, decifrar, exportarDados, restaurarDados, type DumpDados } from "../../../core/src/index";
import { obterBanco } from "../data/banco";
import { lerTexto } from "./arquivos";

const aleatorio = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Versão web: baixa o backup cifrado (mesmo formato do iPhone: um arquivo restaurado em um vale no outro). */
export async function exportarBackup(senha: string): Promise<void> {
  const arquivo = await cifrar(JSON.stringify(exportarDados(obterBanco())), senha, aleatorio);
  const data = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([arquivo], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `controle-financeiro-${data}.cfbackup`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function restaurarBackup(senha: string): Promise<number | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: "*/*" });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  const dump = JSON.parse(await decifrar(await lerTexto(a.uri), senha)) as DumpDados;
  return restaurarDados(obterBanco(), dump).linhas;
}
