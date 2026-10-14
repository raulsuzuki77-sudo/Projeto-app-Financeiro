import { File } from "expo-file-system";

/** Leitura de arquivos escolhidos pelo usuario. No iPhone usa o sistema de arquivos; na versao web, o navegador (ver arquivos.web.ts). */
export async function lerTexto(uri: string): Promise<string> {
  return new File(uri).text();
}

export async function lerBytes(uri: string): Promise<ArrayBuffer> {
  return new File(uri).arrayBuffer();
}

/** Apaga o arquivo temporario copiado para o cache (best-effort). */
export function descartar(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    /* limpeza best-effort */
  }
}
