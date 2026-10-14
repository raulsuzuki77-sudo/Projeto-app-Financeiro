import { agruparEmLinhas, type LinhaOcr } from "../../../core/src/index";
import OcrNativo from "../../modules/ocr-nativo/src/OcrNativoModule";

/** O PDF exige senha (ou a senha informada está errada). */
export class ErroPdfProtegido extends Error {
  constructor(readonly incorreta: boolean) {
    super(incorreta ? "A senha do PDF está incorreta." : "Este PDF é protegido por senha.");
  }
}

/**
 * Lê o texto de uma foto ou PDF local, no aparelho (Vision + PDFKit), e devolve linhas com a confiança de cada uma.
 * Exige um build nativo do aplicativo (não funciona no Expo Go nem na prévia web).
 */
export async function reconhecerTexto(uri: string, senha?: string | null): Promise<LinhaOcr[]> {
  if (!OcrNativo) {
    throw new Error("A leitura de imagem e PDF só funciona no aplicativo instalado no iPhone (build com o Xcode), não no Expo Go nem na prévia web.");
  }
  let obs;
  try {
    obs = await OcrNativo.reconhecer(uri, senha ?? null);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes("PDF_SENHA_INCORRETA")) throw new ErroPdfProtegido(true);
    if (m.includes("PDF_PROTEGIDO")) throw new ErroPdfProtegido(false);
    throw e;
  }
  const linhas = agruparEmLinhas(obs);
  if (linhas.length === 0) throw new Error("Nenhum texto foi reconhecido no arquivo.");
  return linhas;
}
