import type { LinhaOcr } from "./tipos";

/** Observacao de texto como devolvida por um reconhecedor com coordenadas (ex.: Vision no iPhone). */
export interface ObservacaoTexto {
  texto: string;
  /** 0 a 1 */
  confianca: number;
  /** Coordenadas normalizadas (0 a 1), origem no canto INFERIOR esquerdo. */
  x: number;
  y: number;
  largura: number;
  altura: number;
  pagina: number;
  /** Texto ja em linhas (PDF com camada de texto): passa direto, sem agrupamento. */
  nativo?: boolean;
}

/**
 * Reconstroi as linhas visuais de uma pagina. O Vision devolve blocos de texto; uma linha de tabela
 * ("24/08/2026   DROGASIL 1473   R$ 435,26") costuma vir em varios blocos separados por espacos largos.
 * Blocos cujo centro vertical cai dentro da altura um do outro pertencem a mesma linha; dentro dela, ordem por x.
 * A confianca da linha e a media ponderada pelo tamanho do texto, em 0 a 100.
 */
export function agruparEmLinhas(obs: ObservacaoTexto[]): LinhaOcr[] {
  const saida: LinhaOcr[] = [];
  const paginas = [...new Set(obs.map((o) => o.pagina))].sort((a, b) => a - b);
  for (const pagina of paginas) {
    const daPagina = obs.filter((o) => o.pagina === pagina);
    const nativas = daPagina.filter((o) => o.nativo);
    for (const n of nativas) saida.push({ texto: n.texto.trim(), confianca: n.confianca * 100, pagina });
    const visuais = daPagina.filter((o) => !o.nativo && o.texto.trim() !== "");
    // topo primeiro (y maior = mais alto)
    const ordenadas = [...visuais].sort((a, b) => b.y + b.altura / 2 - (a.y + a.altura / 2));
    let grupo: ObservacaoTexto[] = [];
    let centro = 0;
    let altura = 0;
    const fechar = () => {
      if (grupo.length === 0) return;
      const porX = [...grupo].sort((a, b) => a.x - b.x);
      const peso = porX.reduce((s, o) => s + Math.max(1, o.texto.length), 0);
      const conf = porX.reduce((s, o) => s + o.confianca * Math.max(1, o.texto.length), 0) / peso;
      saida.push({ texto: porX.map((o) => o.texto.trim()).join(" "), confianca: conf * 100, pagina });
      grupo = [];
    };
    for (const o of ordenadas) {
      const c = o.y + o.altura / 2;
      if (grupo.length > 0 && Math.abs(c - centro) <= 0.5 * Math.min(o.altura, altura)) {
        grupo.push(o);
      } else {
        fechar();
        grupo = [o];
        centro = c;
        altura = o.altura;
      }
    }
    fechar();
  }
  return saida;
}
