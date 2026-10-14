import type { LinhaTexto } from "../../../core/src/index";
import { lerBytes } from "./arquivos";
import { itensParaLinhas, type ItemPdf } from "./extrato-pdf-linhas";
import { ErroPdfProtegido } from "./ocr-erro";
import { reconhecerTexto } from "./ocr";

interface ItemBruto {
  str?: string;
  transform?: number[];
  width?: number;
}
interface PaginaPdf {
  getTextContent(): Promise<{ items: ItemBruto[] }>;
  cleanup(): void;
}
interface DocumentoPdf {
  numPages: number;
  getPage(n: number): Promise<PaginaPdf>;
  destroy(): Promise<void>;
}

/** Menos letras e dígitos que isto: o PDF não tem camada de texto aproveitável e segue para o OCR. */
const MINIMO_TEXTO = 200;

/**
 * Versão web: lê a camada de texto do PDF com o pdf.js e monta as linhas juntando trechos contíguos
 * (ver `itensParaLinhas`). PDF digitalizado cai no OCR de `reconhecerTexto`.
 */
export async function textoDoPdf(uri: string, senha?: string | null): Promise<LinhaTexto[]> {
  const bytes = new Uint8Array(await lerBytes(uri));
  // @ts-ignore: o pdfjs-dist 3.x nao traz declaracoes para o build UMD
  const pdfjs = (await import("pdfjs-dist/build/pdf")) as { getDocument(o: Record<string, unknown>): { promise: Promise<DocumentoPdf> } };
  // @ts-ignore: carrega o worker na propria pagina, sem arquivo separado nem CDN
  await import("pdfjs-dist/build/pdf.worker.entry");
  let doc: DocumentoPdf;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), password: senha ?? undefined, isEvalSupported: false }).promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err && err.name === "PasswordException") throw new ErroPdfProtegido(err.code === 2);
    throw e;
  }
  const itens: ItemPdf[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const conteudo = await pagina.getTextContent();
      for (const it of conteudo.items) {
        if (typeof it.str !== "string" || !it.transform) continue;
        itens.push({ str: it.str, x: it.transform[4]!, y: it.transform[5]!, largura: Math.abs(it.width ?? 0), tamanho: Math.hypot(it.transform[2]!, it.transform[3]!) || 8, pagina: n });
      }
      pagina.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  const util = itens.reduce((s, i) => s + (i.str.match(/[\p{L}\p{N}]/gu)?.length ?? 0), 0);
  if (util < MINIMO_TEXTO) return reconhecerTexto(uri, senha);
  return itensParaLinhas(itens);
}
