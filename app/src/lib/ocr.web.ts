import { agruparEmLinhas, type LinhaOcr, type ObservacaoTexto } from "../../../core/src/index";
import { lerBytes } from "./arquivos";
import { ErroPdfProtegido } from "./ocr-erro";

export { ErroPdfProtegido };

/** Escala de renderizacao (72 dpi x escala) das paginas de PDF sem camada de texto e sem imagem unica aproveitavel. */
const ESCALA_PDF = 2;
/** Maior lado, em pixels, de uma imagem enviada ao Tesseract. */
const LADO_MAXIMO = 4000;
/** Lado maior ideal (px) para o Tesseract: imagens menores que isso (ex.: pagina digitalizada a 150 dpi) sao ampliadas. */
const LADO_IDEAL = 3000;
/** Ampliacao maxima de uma imagem. */
const AMPLIACAO_MAXIMA = 2;
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

/**
 * Desenha a imagem num canvas de fundo branco, ampliada (suavizacao de alta qualidade) quando pequena demais para o OCR.
 * O Tesseract le bem mais certo a partir dos pixels originais ampliados do que de uma pagina de PDF re-renderizada.
 */
function canvasParaOcr(fonte: CanvasImageSource, largura: number, altura: number): HTMLCanvasElement {
  const maior = Math.max(largura, altura);
  const f = Math.min(LADO_MAXIMO / maior, Math.max(1, Math.min(AMPLIACAO_MAXIMA, LADO_IDEAL / maior)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(largura * f));
  canvas.height = Math.max(1, Math.round(altura * f));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não conseguiu preparar a imagem para leitura.");
  // fundo branco: PNG com transparencia viraria preto para o OCR
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height);
  return canvas;
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
    return await reconhecerCanvas(canvasParaOcr(bitmap, bitmap.width, bitmap.height), 1);
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
interface ObjetosPdf {
  get(nome: string, aoResolver: (obj: unknown) => void): unknown;
}
interface OperacoesPdf {
  fnArray: number[];
  argsArray: unknown[][];
}
interface ImagemPdf {
  width: number;
  height: number;
  /** 1 = tons de cinza 1 bit, 2 = RGB 24 bits, 3 = RGBA 32 bits */
  kind?: number;
  data?: Uint8ClampedArray | Uint8Array;
  bitmap?: ImageBitmap;
}
interface CodigosPdf {
  save: number;
  restore: number;
  transform: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
}
interface PaginaPdf {
  rotate: number;
  objs: ObjetosPdf;
  commonObjs: ObjetosPdf;
  getOperatorList(): Promise<OperacoesPdf>;
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

async function abrirPdf(bytes: Uint8Array, senha: string | null | undefined): Promise<{ doc: DocumentoPdf; codigos: CodigosPdf }> {
  // @ts-ignore: o pdfjs-dist 3.x nao traz declaracoes para o build UMD
  const pdfjs = (await import("pdfjs-dist/build/pdf")) as {
    getDocument(o: Record<string, unknown>): { promise: Promise<DocumentoPdf> };
    OPS: CodigosPdf;
  };
  // @ts-ignore: carrega o worker na propria pagina (worker "falso"), sem arquivo separado nem CDN
  await import("pdfjs-dist/build/pdf.worker.entry");
  try {
    // o pdf.js toma posse do buffer; passa uma copia
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), password: senha ?? undefined, isEvalSupported: false })
      .promise;
    return { doc, codigos: pdfjs.OPS };
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

/**
 * PDF digitalizado: a pagina costuma ser uma unica imagem que cobre a folha toda. Devolve os pixels originais dessa
 * imagem (melhor para o OCR que re-renderizar a pagina). Retorna null se a pagina tiver outra estrutura.
 */
async function imagemUnicaDaPagina(pagina: PaginaPdf, codigos: CodigosPdf): Promise<HTMLCanvasElement | null> {
  try {
    if (pagina.rotate % 360 !== 0) return null;
    const vp = pagina.getViewport({ scale: 1 });
    const lista = await pagina.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const pilha: number[][] = [];
    const imagens: { nome: string; inline: ImagemPdf | null; area: number }[] = [];
    for (let i = 0; i < lista.fnArray.length; i++) {
      const op = lista.fnArray[i];
      const args = lista.argsArray[i];
      if (op === codigos.save) pilha.push(ctm);
      else if (op === codigos.restore) ctm = pilha.pop() ?? ctm;
      else if (op === codigos.transform && args) ctm = multiplicar(ctm, args as number[]);
      else if ((op === codigos.paintImageXObject || op === codigos.paintInlineImageXObject) && args) {
        // so imagens em pe (sem giro nem espelho); as demais ficam por conta da renderizacao da pagina
        const [a, b, c, d] = ctm as [number, number, number, number];
        if (!(Math.abs(b) < 1e-3 * Math.abs(a) && Math.abs(c) < 1e-3 * Math.abs(d) && a > 0 && d > 0)) return null;
        const area = (a * d) / (vp.width * vp.height);
        if (area > 0.05) {
          imagens.push(
            op === codigos.paintImageXObject
              ? { nome: String(args[0]), inline: null, area }
              : { nome: "", inline: args[0] as ImagemPdf, area },
          );
        }
      }
    }
    const maior = imagens.sort((x, y) => y.area - x.area)[0];
    if (!maior || maior.area < 0.6 || imagens.filter((x) => x.area > 0.3).length > 1) return null;
    const img =
      maior.inline ??
      (await new Promise<ImagemPdf | null>((resolve) => {
        const fonte = maior.nome.startsWith("g_") ? pagina.commonObjs : pagina.objs;
        fonte.get(maior.nome, (o) => resolve((o as ImagemPdf) ?? null));
      }));
    if (!img || !img.width || !img.height) return null;
    if (img.bitmap) return canvasParaOcr(img.bitmap, img.width, img.height);
    if (!img.data) return null;
    const rgba = new Uint8ClampedArray(img.width * img.height * 4);
    const d = img.data;
    if (img.kind === 3 && d.length >= rgba.length) {
      rgba.set(d.subarray(0, rgba.length));
    } else if (img.kind === 2 && d.length >= img.width * img.height * 3) {
      for (let p = 0, q = 0; p < rgba.length; p += 4, q += 3) {
        rgba[p] = d[q]!;
        rgba[p + 1] = d[q + 1]!;
        rgba[p + 2] = d[q + 2]!;
        rgba[p + 3] = 255;
      }
    } else if (img.kind === 1) {
      const linha = Math.ceil(img.width / 8);
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const v = (d[y * linha + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0;
          const p = (y * img.width + x) * 4;
          rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
          rgba[p + 3] = 255;
        }
      }
    } else {
      return null;
    }
    const origem = document.createElement("canvas");
    origem.width = img.width;
    origem.height = img.height;
    origem.getContext("2d")?.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
    return canvasParaOcr(origem, img.width, img.height);
  } catch {
    return null;
  }
}

/** Desenha a pagina inteira (texto vetorial sem camada de texto, imagens combinadas, etc.) num canvas. */
async function renderizarPagina(pagina: PaginaPdf): Promise<HTMLCanvasElement> {
  const vp = pagina.getViewport({ scale: ESCALA_PDF });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não conseguiu desenhar a página do PDF.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pagina.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

async function lerPdf(bytes: Uint8Array, senha: string | null | undefined): Promise<ObservacaoTexto[]> {
  const { doc, codigos } = await abrirPdf(bytes, senha);
  const obs: ObservacaoTexto[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const daCamada = await textoDaPagina(pagina, n);
      if (daCamada) {
        obs.push(...daCamada);
      } else {
        // PDF de imagem: reconhece com o Tesseract
        const canvas = (await imagemUnicaDaPagina(pagina, codigos)) ?? (await renderizarPagina(pagina));
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
  if (linhas.length === 0) throw new Error(MSG_SEM_TEXTO);
  return linhas;
}
