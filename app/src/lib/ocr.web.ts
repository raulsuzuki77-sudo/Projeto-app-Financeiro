import { agruparEmLinhas, type LinhaOcr, type ObservacaoTexto } from "../../../core/src/index";
import { lerBytes } from "./arquivos";
import { ErroPdfProtegido } from "./ocr-erro";

export { ErroPdfProtegido };

/** Escala de renderizacao das paginas de PDF sem camada de texto (maior = mais nitido e mais lento). */
const ESCALA_PDF = 2.5;
/** Maior lado, em pixels, de uma foto enviada ao Tesseract. */
const LADO_MAXIMO = 4000;
/** Letras e digitos minimos para considerar que a pagina do PDF tem texto util. */
const MINIMO_TEXTO_UTIL = 30;

const MSG_SEM_TEXTO = "Nenhum texto foi reconhecido no arquivo.";
const MSG_FORMATO = "Formato de imagem não suportado no navegador; use JPG ou PNG.";

// Tipos minimos do Tesseract que usamos (o pacote traz os seus, mas o import e carregado sob demanda).
interface Caixa {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface LinhaTess {
  text: string;
  confidence: number;
  bbox: Caixa;
}
interface ResultadoTess {
  data: {
    text?: string;
    blocks?: { paragraphs: { lines: LinhaTess[] }[] }[] | null;
  };
}
interface TrabalhadorTess {
  recognize(
    imagem: HTMLCanvasElement,
    opcoes?: Record<string, unknown>,
    saida?: Record<string, boolean>,
  ): Promise<ResultadoTess>;
}

let trabalhador: Promise<TrabalhadorTess> | null = null;

/** Um unico worker do Tesseract e reaproveitado entre as chamadas. Tudo vem do mesmo endereco do app (sem CDN). */
function obterTrabalhador(): Promise<TrabalhadorTess> {
  if (!trabalhador) {
    trabalhador = (async () => {
      const { createWorker } = await import("tesseract.js");
      // os caminhos sao resolvidos pelo pacote contra o endereco atual da pagina
      return (await createWorker("por", 1, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr/",
        langPath: "/ocr/",
        gzip: true,
        cacheMethod: "none",
      })) as unknown as TrabalhadorTess;
    })();
    trabalhador.catch(() => {
      trabalhador = null;
    });
  }
  return trabalhador;
}

/** Reconhece uma imagem (canvas) e devolve as linhas como observacoes com coordenadas normalizadas. */
async function reconhecerCanvas(canvas: HTMLCanvasElement, pagina: number): Promise<ObservacaoTexto[]> {
  const w = await obterTrabalhador();
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
  const largura = canvas.width;
  const altura = canvas.height;
  const obs: ObservacaoTexto[] = [];
  for (const bloco of data.blocks ?? []) {
    for (const par of bloco.paragraphs) {
      for (const l of par.lines) {
        const texto = l.text.replace(/\s+/g, " ").trim();
        if (texto === "") continue;
        const { x0, y0, x1, y1 } = l.bbox;
        obs.push({
          texto,
          confianca: Math.max(0, Math.min(100, l.confidence)) / 100,
          x: x0 / largura,
          // origem no canto inferior esquerdo
          y: 1 - y1 / altura,
          largura: (x1 - x0) / largura,
          altura: (y1 - y0) / altura,
          pagina,
        });
      }
    }
  }
  return obs;
}

function ehPdf(b: Uint8Array): boolean {
  // o cabecalho pode vir precedido de lixo (ate 1 KB) em alguns PDFs
  const limite = Math.min(b.length - 4, 1024);
  for (let i = 0; i <= limite; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46) return true;
  }
  return false;
}

function ehHeic(b: Uint8Array): boolean {
  // caixa "ftyp" no byte 4, seguida da marca do formato
  if (b.length < 12) return false;
  if (String.fromCharCode(b[4]!, b[5]!, b[6]!, b[7]!) !== "ftyp") return false;
  const marca = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(marca);
}

async function lerImagem(bytes: Uint8Array): Promise<ObservacaoTexto[]> {
  if (ehHeic(bytes)) throw new Error(MSG_FORMATO);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  } catch {
    throw new Error(MSG_FORMATO);
  }
  try {
    const f = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * f));
    canvas.height = Math.max(1, Math.round(bitmap.height * f));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(MSG_FORMATO);
    // fundo branco: PNG com transparencia viraria preto para o OCR
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await reconhecerCanvas(canvas, 1);
  } finally {
    bitmap.close();
  }
}

// Partes do pdf.js usadas aqui.
interface ItemTexto {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
interface PaginaPdf {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getTextContent(): Promise<{ items: (ItemTexto | { type: string })[] }>;
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
  cleanup(): void;
}
interface DocumentoPdf {
  numPages: number;
  getPage(n: number): Promise<PaginaPdf>;
  destroy(): Promise<void>;
}

function multiplicar(m1: number[], m2: number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

async function abrirPdf(bytes: Uint8Array, senha: string | null | undefined): Promise<DocumentoPdf> {
  // @ts-ignore: o pdfjs-dist 3.x nao traz declaracoes para o build UMD
  const pdfjs = (await import("pdfjs-dist/build/pdf")) as {
    getDocument(o: Record<string, unknown>): { promise: Promise<DocumentoPdf> };
  };
  // @ts-ignore: carrega o worker na propria pagina (worker "falso"), sem arquivo separado nem CDN
  await import("pdfjs-dist/build/pdf.worker.entry");
  try {
    // o pdf.js toma posse do buffer; passa uma copia
    return await pdfjs.getDocument({ data: new Uint8Array(bytes), password: senha ?? undefined, isEvalSupported: false })
      .promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err && err.name === "PasswordException") {
      throw new ErroPdfProtegido(err.code === 2);
    }
    throw e;
  }
}

/** Texto da camada de texto do PDF como observacoes (uma por trecho), ou null se a pagina e so imagem. */
async function textoDaPagina(pagina: PaginaPdf, numero: number): Promise<ObservacaoTexto[] | null> {
  const vp = pagina.getViewport({ scale: 1 });
  const conteudo = await pagina.getTextContent();
  const obs: ObservacaoTexto[] = [];
  let util = 0;
  for (const item of conteudo.items) {
    if (!("str" in item)) continue;
    const texto = item.str;
    if (texto.trim() === "") continue;
    util += (texto.match(/[\p{L}\p{N}]/gu) ?? []).length;
    // para o espaco do viewport (origem no topo): [.. 4]=x e [.. 5]=y da linha de base
    const t = multiplicar(vp.transform, item.transform);
    const tamanho = Math.hypot(t[2]!, t[3]!) || Math.abs(item.height) || 10;
    const larguraPx = Math.abs(item.width) * Math.hypot(vp.transform[0]!, vp.transform[1]!);
    obs.push({
      texto,
      confianca: 1,
      x: t[4]! / vp.width,
      y: 1 - t[5]! / vp.height,
      largura: larguraPx / vp.width,
      altura: tamanho / vp.height,
      pagina: numero,
      nativo: false,
    });
  }
  return util > MINIMO_TEXTO_UTIL ? obs : null;
}

async function lerPdf(bytes: Uint8Array, senha: string | null | undefined): Promise<ObservacaoTexto[]> {
  const doc = await abrirPdf(bytes, senha);
  const obs: ObservacaoTexto[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const daCamada = await textoDaPagina(pagina, n);
      if (daCamada) {
        obs.push(...daCamada);
      } else {
        // PDF de imagem: desenha a pagina e reconhece com o Tesseract
        const vp = pagina.getViewport({ scale: ESCALA_PDF });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("O navegador não conseguiu desenhar a página do PDF.");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pagina.render({ canvasContext: ctx, viewport: vp }).promise;
        obs.push(...(await reconhecerCanvas(canvas, n)));
        canvas.width = 0;
        canvas.height = 0;
      }
      pagina.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return obs;
}

/**
 * Versao web: le o texto de uma foto ou PDF (URL blob: do seletor de arquivos) no proprio navegador.
 * PDF com camada de texto e lido direto pelo pdf.js; PDF de imagem e fotos passam pelo Tesseract (offline).
 */
export async function reconhecerTexto(uri: string, senha?: string | null): Promise<LinhaOcr[]> {
  const bytes = new Uint8Array(await lerBytes(uri));
  const obs = ehPdf(bytes) ? await lerPdf(bytes, senha) : await lerImagem(bytes);
  const linhas = agruparEmLinhas(obs);
  (globalThis as any).__DBG = linhas; // TEMP-DEBUG
  if (linhas.length === 0) throw new Error(MSG_SEM_TEXTO);
  return linhas;
}
