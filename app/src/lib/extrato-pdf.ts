import type { LinhaTexto } from "../../../core/src/index";
import { reconhecerTexto } from "./ocr";

/** No iPhone, o texto do PDF vem do PDFKit (módulo nativo); só PDFs sem camada de texto passam por OCR. */
export async function textoDoPdf(uri: string, senha?: string | null): Promise<LinhaTexto[]> {
  return reconhecerTexto(uri, senha);
}
