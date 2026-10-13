import { NativeModule, requireOptionalNativeModule } from "expo";
import type { ObservacaoOcr } from "./OcrNativo.types";

declare class OcrNativoModule extends NativeModule<{}> {
  reconhecer(uri: string): Promise<ObservacaoOcr[]>;
}

/** Nulo quando o aplicativo roda sem o modulo nativo (Expo Go, web). */
export default requireOptionalNativeModule<OcrNativoModule>("OcrNativo");
