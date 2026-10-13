import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { cifrar, decifrar, exportarDados, restaurarDados, type DumpDados } from "../../../core/src/index";
import { obterBanco } from "../data/banco";

const aleatorio = (n: number) => Crypto.getRandomBytes(n);

/** Exporta TODOS os dados, cifrados com a senha informada, e abre a folha de compartilhamento (Arquivos, iCloud Drive, AirDrop). */
export async function exportarBackup(senha: string): Promise<void> {
  const arquivo = await cifrar(JSON.stringify(exportarDados(obterBanco())), senha, aleatorio);
  const data = new Date().toISOString().slice(0, 10);
  const f = new File(Paths.cache, `controle-financeiro-${data}.cfbackup`);
  f.create({ overwrite: true });
  f.write(arquivo);
  try {
    if (!(await Sharing.isAvailableAsync())) throw new Error("Compartilhamento indisponivel neste aparelho.");
    await Sharing.shareAsync(f.uri, { mimeType: "application/json", dialogTitle: "Salvar backup cifrado" });
  } finally {
    try {
      f.delete(); // o arquivo temporario nao fica no cache do aparelho
    } catch {
      /* limpeza best-effort */
    }
  }
}

/** Escolhe um arquivo de backup e SUBSTITUI todos os dados atuais. Devolve o numero de linhas restauradas, ou null se cancelado. */
export async function restaurarBackup(senha: string): Promise<number | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  const f = new File(a.uri);
  try {
    const texto = await f.text();
    const dump = JSON.parse(await decifrar(texto, senha)) as DumpDados;
    return restaurarDados(obterBanco(), dump).linhas;
  } finally {
    try {
      f.delete();
    } catch {
      /* ignora */
    }
  }
}
