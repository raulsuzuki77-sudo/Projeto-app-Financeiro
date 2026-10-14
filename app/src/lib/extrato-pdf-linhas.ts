import type { LinhaTexto } from "../../../core/src/index";

/** Trecho de texto de uma página de PDF, em pontos (origem no canto inferior esquerdo), como devolvido pelo pdf.js. */
export interface ItemPdf {
  str: string;
  x: number;
  y: number;
  largura: number;
  /** Tamanho da fonte. */
  tamanho: number;
  pagina: number;
}

/**
 * Alguns PDFs de banco (fonte Type 3 sem mapa Unicode) saem do pdf.js com a letra "a" trocada por U+0000.
 * Nos extratos conferidos, a troca e sempre essa letra; a conferencia da soma com o total do extrato
 * protege contra qualquer erro de leitura que isso pudesse causar.
 */
export function repararTexto(s: string): string {
  return s.replace(/\u0000/g, "a");
}

/**
 * Monta as linhas de uma página a partir dos trechos do pdf.js. Diferente de um agrupamento que separa todo trecho por
 * espaço, aqui o espaço só entra onde o PDF o traz ou onde há folga visível entre os trechos: palavras partidas por
 * troca de fonte ("E" + "xtrato") voltam inteiras, e células de tabela continuam separadas.
 */
export function itensParaLinhas(itens: ItemPdf[]): LinhaTexto[] {
  const saida: LinhaTexto[] = [];
  const paginas = [...new Set(itens.map((i) => i.pagina))].sort((a, b) => a - b);
  for (const pagina of paginas) {
    const doc = itens.filter((i) => i.pagina === pagina && i.str !== "").sort((a, b) => b.y - a.y || a.x - b.x);
    let grupo: ItemPdf[] = [];
    let refY = 0;
    const fechar = () => {
      if (grupo.length === 0) return;
      let texto = "";
      let fim = -Infinity;
      for (const it of [...grupo].sort((a, b) => a.x - b.x)) {
        const s = repararTexto(it.str);
        const folga = it.x - fim;
        if (texto !== "" && !texto.endsWith(" ") && !s.startsWith(" ") && folga > Math.max(0.5, 0.15 * it.tamanho)) texto += " ";
        texto += s;
        fim = it.x + it.largura;
      }
      const limpo = texto.replace(/\s+/g, " ").trim();
      if (limpo !== "") saida.push({ texto: limpo, confianca: 100, pagina });
      grupo = [];
    };
    for (const it of doc) {
      const tol = Math.max(1.5, 0.45 * it.tamanho);
      if (grupo.length > 0 && Math.abs(it.y - refY) <= tol) grupo.push(it);
      else {
        fechar();
        grupo = [it];
        refY = it.y;
      }
    }
    fechar();
  }
  return saida;
}
