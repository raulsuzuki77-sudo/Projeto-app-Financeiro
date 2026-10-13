export interface LinhaOcr {
  texto: string;
  /** Confiança do reconhecimento na linha, de 0 a 100. */
  confianca: number;
  pagina: number;
}
