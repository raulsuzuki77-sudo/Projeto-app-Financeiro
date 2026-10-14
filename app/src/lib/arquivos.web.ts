/** Versao web: o seletor de arquivos devolve uma URL de objeto (blob:), lida com fetch. */
export async function lerTexto(uri: string): Promise<string> {
  return (await fetch(uri)).text();
}

export async function lerBytes(uri: string): Promise<ArrayBuffer> {
  return (await fetch(uri)).arrayBuffer();
}

export function descartar(uri: string): void {
  try {
    URL.revokeObjectURL(uri);
  } catch {
    /* ignora */
  }
}
