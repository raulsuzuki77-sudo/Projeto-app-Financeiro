import { agruparEmLinhas, type LinhaOcr } from "../../../core/src/index";
import OcrNativo from "../../modules/ocr-nativo/src/OcrNativoModule";

/**
 * Le o texto de uma foto ou PDF local, no aparelho (Vision + PDFKit), e devolve linhas com a confianca de cada uma.
 * Exige um build nativo do aplicativo (nao funciona no Expo Go).
 */
export async function reconhecerTexto(uri: string): Promise<LinhaOcr[]> {
  if (!OcrNativo) {
    throw new Error("A leitura de imagem e PDF exige o aplicativo compilado com Xcode (nao funciona no Expo Go). Veja docs/INSTALACAO_IPHONE.md.");
  }
  const obs = await OcrNativo.reconhecer(uri);
  const linhas = agruparEmLinhas(obs);
  if (linhas.length === 0) throw new Error("Nenhum texto foi reconhecido no arquivo.");
  return linhas;
}
