import { NativeModule, requireOptionalNativeModule } from "expo";

export interface ArquivoDaPasta {
  /** Relativo à pasta escolhida, com subpastas ("Backups mensais/arquivo.cfbackup"). */
  caminho: string;
  nome: string;
  tamanho: number;
  /** Segundos desde 1970. */
  modificado: number;
  /** Falso quando o arquivo está no iCloud Drive e ainda não foi baixado para o aparelho. */
  disponivel: boolean;
}

export interface EstadoDaPasta {
  configurada: boolean;
  /** Falso quando a permissão guardada deixou de valer (pasta apagada ou movida). */
  valida: boolean;
  nome: string;
}

declare class PastaNativaModule extends NativeModule<{}> {
  /** Abre o seletor de pastas do iOS. Rejeita com PASTA_CANCELADA se o usuário cancelar. Devolve o nome da pasta. */
  escolherPasta(): Promise<string>;
  estadoDaPasta(): EstadoDaPasta;
  esquecerPasta(): void;
  listarArquivos(): Promise<ArquivoDaPasta[]>;
  /** Copia o arquivo para a área temporária e devolve o endereço (file://) da cópia. */
  copiarParaCache(caminho: string): Promise<string>;
  liberarCopia(uri: string): void;
  /** Grava (substituindo) `nome` dentro de `subpasta` (criada se preciso; vazia = raiz). Devolve o caminho relativo gravado. */
  gravarNaPasta(subpasta: string, nome: string, origemUri: string): Promise<string>;
}

/** Nulo quando o aplicativo roda sem o módulo nativo (Expo Go, web). */
export default requireOptionalNativeModule<PastaNativaModule>("PastaNativa");
