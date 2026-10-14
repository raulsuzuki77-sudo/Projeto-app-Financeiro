import { NativeModule, requireOptionalNativeModule } from "expo";
import type { ObservacaoOcr } from "./OcrNativo.types";

declare class OcrNativoModule extends NativeModule<{}> {
  /** `senha` é usada só se o PDF estiver protegido. Falhas conhecidas: mensagens contendo PDF_PROTEGIDO ou PDF_SENHA_INCORRETA. */
  reconhecer(uri: string, senha: string | null): Promise<ObservacaoOcr[]>;
}

/** Nulo quando o aplicativo roda sem o modulo nativo (Expo Go, web). */
export default requireOptionalNativeModule<OcrNativoModule>("OcrNativo");
