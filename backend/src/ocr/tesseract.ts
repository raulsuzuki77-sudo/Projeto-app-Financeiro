import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface LinhaOcr {
  texto: string;
  /** Média da confiança do Tesseract nas palavras da linha, de 0 a 100. */
  confianca: number;
  pagina: number;
}

export type TipoArquivo = "pdf" | "png" | "jpeg";

/** Identifica o tipo pelos primeiros bytes; o Content-Type enviado pelo cliente não é confiável. */
export function detectarTipo(buf: Buffer): TipoArquivo | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  return null;
}

export async function ocrDisponivel(): Promise<boolean> {
  try {
    const { stdout, stderr } = await exec("tesseract", ["--list-langs"], { timeout: 10_000 });
    return /\bpor\b/.test(stdout + stderr);
  } catch {
    return false;
  }
}

/** Agrupa o TSV do Tesseract em linhas, com a confiança média de cada uma. */
export function linhasDeTsv(tsv: string, pagina: number): LinhaOcr[] {
  const linhas = new Map<string, { palavras: string[]; confs: number[] }>();
  for (const l of tsv.split("\n").slice(1)) {
    const c = l.split("\t");
    if (c.length < 12 || c[0] !== "5") continue; // nivel 5 = palavra
    const texto = (c[11] ?? "").trim();
    const conf = Number(c[10]);
    if (!texto || !Number.isFinite(conf) || conf < 0) continue;
    const chave = `${c[2]}-${c[3]}-${c[4]}`; // bloco-paragrafo-linha
    const g = linhas.get(chave) ?? { palavras: [], confs: [] };
    g.palavras.push(texto);
    g.confs.push(conf);
    linhas.set(chave, g);
  }
  return [...linhas.values()].map((g) => ({
    texto: g.palavras.join(" "),
    confianca: g.confs.reduce((a, b) => a + b, 0) / g.confs.length,
    pagina,
  }));
}

/**
 * Executa OCR em PDF (rasterizado a 300 dpi), PNG ou JPEG.
 * O arquivo e as imagens intermediárias ficam em diretório temporário exclusivo,
 * removido ao final (dados financeiros não permanecem em disco).
 * Comandos são chamados sem shell e com argumentos fixos.
 */
export async function ocrArquivo(buf: Buffer, tipo: TipoArquivo): Promise<LinhaOcr[]> {
  const dir = await mkdtemp(join(tmpdir(), "ocr-"));
  try {
    const entrada = join(dir, `entrada.${tipo === "jpeg" ? "jpg" : tipo}`);
    await writeFile(entrada, buf, { mode: 0o600 });
    let imagens: string[];
    if (tipo === "pdf") {
      await exec("pdftoppm", ["-r", "300", "-png", entrada, join(dir, "pg")], { timeout: 120_000 });
      imagens = (await readdir(dir)).filter((f) => /^pg-\d+\.png$/.test(f)).sort().map((f) => join(dir, f));
      if (imagens.length > 30) throw new Error("PDF com paginas demais para OCR (limite 30)");
    } else imagens = [entrada];
    const linhas: LinhaOcr[] = [];
    for (const [i, img] of imagens.entries()) {
      const base = join(dir, `saida-${i}`);
      await exec("tesseract", [img, base, "-l", "por", "--psm", "6", "tsv"], { timeout: 120_000 });
      linhas.push(...linhasDeTsv(await readFile(`${base}.tsv`, "utf8"), i + 1));
    }
    return linhas;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
