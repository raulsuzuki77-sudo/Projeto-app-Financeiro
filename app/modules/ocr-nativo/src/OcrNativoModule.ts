import { NativeModule, requireOptionalNativeModule } from "expo";
import type { ItemPdfNativo, ObservacaoOcr } from "./OcrNativo.types";

declare class OcrNativoModule extends NativeModule<{}> {
  /** `senha` é usada só se o PDF estiver protegido. Falhas conhecidas: mensagens contendo PDF_PROTEGIDO ou PDF_SENHA_INCORRETA. */
  reconhecer(uri: string, senha: string | null): Promise<ObservacaoOcr[]>;
  /**
   * Itens posicionados da camada de texto do PDF (cada página começa com um item de texto vazio, que marca a sua existência; página sem texto só tem a marca). Ausente em builds nativos anteriores a esta função:
   * quem chama deve testar `typeof OcrNativo.extrairItens === "function"`. Mesmas falhas conhecidas de `reconhecer`.
   */
  extrairItens?(uri: string, senha: string | null): Promise<ItemPdfNativo[]>;
}

/** Nulo quando o aplicativo roda sem o modulo nativo (Expo Go, web). */
export default requireOptionalNativeModule<OcrNativoModule>("OcrNativo");
