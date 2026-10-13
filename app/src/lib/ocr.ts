import type { LinhaOcr } from "../../../core/src/index";

/** Substituido na etapa L4 pelo modulo nativo (Vision + PDFKit). */
export async function reconhecerTexto(_uri: string): Promise<LinhaOcr[]> {
  throw new Error("Leitura de imagem e PDF ainda nao esta disponivel nesta versao do aplicativo.");
}
