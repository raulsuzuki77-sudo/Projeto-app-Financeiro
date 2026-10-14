import { agruparEmLinhas, type LinhaOcr } from "../../../core/src/index";
import OcrNativo from "../../modules/ocr-nativo/src/OcrNativoModule";
import type { ItemPdfNativo, ObservacaoOcr } from "../../modules/ocr-nativo/src/OcrNativo.types";
import { ErroPdfProtegido } from "./ocr-erro";

export { ErroPdfProtegido };

const MSG_SEM_MODULO = "A leitura de imagem e PDF só funciona no aplicativo instalado no iPhone (build com o Xcode), não no Expo Go nem na prévia web.";

/** Converte as falhas conhecidas do módulo nativo (senha) em `ErroPdfProtegido`; as demais seguem como estão. */
function traduzirErro(e: unknown): never {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("PDF_SENHA_INCORRETA")) throw new ErroPdfProtegido(true);
  if (m.includes("PDF_PROTEGIDO")) throw new ErroPdfProtegido(false);
  throw e;
}

/** Observações cruas do módulo nativo (texto do PDFKit em linhas, ou OCR do Vision nas páginas sem camada de texto). */
export async function reconhecerObservacoes(uri: string, senha?: string | null): Promise<ObservacaoOcr[]> {
  if (!OcrNativo) throw new Error(MSG_SEM_MODULO);
  try {
    return await OcrNativo.reconhecer(uri, senha ?? null);
  } catch (e) {
    return traduzirErro(e);
  }
}

/** O módulo instalado já tem a função de itens posicionados? (builds anteriores não têm.) */
export function temItensPosicionados(): boolean {
  return !!OcrNativo && typeof OcrNativo.extrairItens === "function";
}

/** Itens posicionados da camada de texto do PDF (mesmo formato do pdf.js). Lista vazia se o PDF não tem camada de texto. */
export async function extrairItensPosicionados(uri: string, senha?: string | null): Promise<ItemPdfNativo[]> {
  if (!OcrNativo || typeof OcrNativo.extrairItens !== "function") throw new Error(MSG_SEM_MODULO);
  try {
    return await OcrNativo.extrairItens(uri, senha ?? null);
  } catch (e) {
    return traduzirErro(e);
  }
}

/**
 * Lê o texto de uma foto ou PDF local, no aparelho (Vision + PDFKit), e devolve linhas com a confiança de cada uma.
 * Exige um build nativo do aplicativo (não funciona no Expo Go nem na prévia web).
 */
export async function reconhecerTexto(uri: string, senha?: string | null): Promise<LinhaOcr[]> {
  const obs = await reconhecerObservacoes(uri, senha);
  const linhas = agruparEmLinhas(obs);
  if (linhas.length === 0) throw new Error("Nenhum texto foi reconhecido no arquivo.");
  return linhas;
}
