import { agruparEmLinhas, novoDiagnostico, registrarLinhas, type DiagnosticoLeitura, type LinhaTexto } from "../../../core/src/index";
import { itensParaLinhas, type ItemPdf } from "./extrato-pdf-linhas";
import { ErroPdfProtegido, extrairItensPosicionados, reconhecerObservacoes, temItensPosicionados } from "./ocr";

/** Menos letras e dígitos que isto no PDF todo: não há camada de texto aproveitável e a leitura segue para o caminho antigo e o OCR. */
const MINIMO_TEXTO = 200;
/** Página com menos letras e dígitos que isto é tratada como sem texto (digitalizada) e passa por OCR. */
const MINIMO_POR_PAGINA = 10;

const letrasEDigitos = (s: string): number => s.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
const mensagem = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * No iPhone, o texto do PDF vem do módulo nativo (PDFKit). Ordem de tentativas:
 * 1. itens posicionados (cada trecho com x, y, largura e tamanho, como no pdf.js) e o MESMO algoritmo de linhas da versão web
 *    (`itensParaLinhas`): mantém as colunas das tabelas; páginas sem texto no meio do PDF passam por OCR;
 * 2. caminho antigo: `PDFPage.string` dividido por quebras de linha (PDFKit) e, em páginas sem texto, OCR do Vision;
 * 3. falha em tudo: o erro sobe, com o diagnóstico preenchido.
 * `diag` (opcional) recebe o caminho usado, as tentativas e as primeiras linhas, para o usuário copiar quando a leitura falhar.
 */
export async function textoDoPdf(uri: string, senha?: string | null, diag: DiagnosticoLeitura = novoDiagnostico()): Promise<LinhaTexto[]> {
  if (temItensPosicionados()) {
    try {
      const itens = await extrairItensPosicionados(uri, senha);
      const comTexto = itens.filter((i) => i.str !== "");
      diag.itens = comTexto.length;
      const util = comTexto.reduce((s, i) => s + letrasEDigitos(i.str), 0);
      if (util >= MINIMO_TEXTO) {
        const paginas = [...new Set(itens.map((i) => i.pagina))].sort((a, b) => a - b);
        const utilDaPagina = new Map<number, number>();
        for (const i of comTexto) utilDaPagina.set(i.pagina, (utilDaPagina.get(i.pagina) ?? 0) + letrasEDigitos(i.str));
        const semTexto = paginas.filter((p) => (utilDaPagina.get(p) ?? 0) < MINIMO_POR_PAGINA);
        const linhas = itensParaLinhas(comTexto.map((i): ItemPdf => ({ str: i.str, x: i.x, y: i.y, largura: i.largura, tamanho: i.tamanho || 8, pagina: i.pagina })));
        if (semTexto.length === 0) {
          diag.tentativas.push(`pdfkit-posicional: ${comTexto.length} itens em ${paginas.length} página(s), ${linhas.length} linhas`);
          registrarLinhas(diag, linhas, "pdfkit-posicional");
          return linhas;
        }
        // PDF misto: páginas sem camada de texto (digitalizadas) passam por OCR; as demais mantêm as colunas
        const extra = agruparEmLinhas((await reconhecerObservacoes(uri, senha)).filter((o) => !o.nativo && semTexto.includes(o.pagina)));
        const juntas = [...linhas, ...extra].sort((a, b) => (a.pagina ?? 0) - (b.pagina ?? 0));
        diag.tentativas.push(`pdfkit-posicional: ${comTexto.length} itens; OCR em ${semTexto.length} página(s) sem texto (${semTexto.join(", ")}); ${juntas.length} linhas`);
        registrarLinhas(diag, juntas, "pdfkit-posicional");
        return juntas;
      }
      diag.tentativas.push(`pdfkit-posicional: ${comTexto.length} itens, só ${util} letras e dígitos; seguiu para o caminho antigo e o OCR`);
    } catch (e) {
      if (e instanceof ErroPdfProtegido) throw e;
      diag.tentativas.push(`pdfkit-posicional: falhou (${mensagem(e)}); seguiu para o caminho antigo`);
    }
  } else {
    diag.tentativas.push("pdfkit-posicional: indisponível neste build do aplicativo (módulo nativo sem a função de itens); caminho antigo");
  }

  const obs = await reconhecerObservacoes(uri, senha);
  const linhas = agruparEmLinhas(obs);
  const usouOcr = obs.some((o) => !o.nativo);
  const caminho = usouOcr ? "ocr" : "pdfkit-antigo";
  diag.tentativas.push(`${caminho}: ${obs.length} observações, ${linhas.length} linhas`);
  registrarLinhas(diag, linhas, caminho);
  if (linhas.length === 0) throw new Error("Nenhum texto foi reconhecido no arquivo.");
  return linhas;
}
