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
