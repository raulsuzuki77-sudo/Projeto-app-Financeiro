/** Observacao devolvida pelo modulo nativo. Coordenadas normalizadas (0 a 1), origem no canto inferior esquerdo. */
export interface ObservacaoOcr {
  texto: string;
  /** 0 a 1 */
  confianca: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
  pagina: number;
  /** Texto ja em linhas (PDF com camada de texto): nao precisa de agrupamento. */
  nativo: boolean;
}

/**
 * Trecho de texto posicionado de uma página de PDF, no mesmo formato do pdf.js: pontos, origem no canto inferior esquerdo.
 * `tamanho` é a altura da caixa dos caracteres (aproxima o tamanho da fonte).
 */
export interface ItemPdfNativo {
  str: string;
  x: number;
  y: number;
  largura: number;
  tamanho: number;
  pagina: number;
}
