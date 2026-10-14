import { View } from "react-native";
import { useTema } from "./tema";
import { Texto } from "./ui";
import { formatarBRL } from "../lib/format";

export type FaixaProgresso = "ok" | "atencao" | "estourou" | "sem_plano";

/** Faixa pelo percentual realizado/planejado: até 80% normal, de 80% a 100% atenção, acima de 100% estourou. */
export function faixaDoProgresso(planejado: number, realizado: number): FaixaProgresso {
  if (planejado <= 0) return realizado > 0 ? "sem_plano" : "ok";
  if (realizado > planejado) return "estourou";
  return realizado >= planejado * 0.8 ? "atencao" : "ok";
}

export function percentual(planejado: number, realizado: number): number | null {
  return planejado > 0 ? Math.round((realizado / planejado) * 100) : null;
}

/** Texto da situação: a cor nunca é o único indicador. */
export function textoDaFaixa(planejado: number, realizado: number): string {
  const faixa = faixaDoProgresso(planejado, realizado);
  const p = percentual(planejado, realizado);
  if (faixa === "sem_plano") return "Gasto sem valor planejado";
  if (planejado <= 0) return "Sem valor planejado";
  if (faixa === "estourou") return `Estourou: ${p}% do planejado (${formatarBRL(realizado - planejado)} acima)`;
  if (faixa === "atencao") return `Atenção: ${p}% do planejado (restam ${formatarBRL(planejado - realizado)})`;
  return `Dentro do planejado: ${p}% (restam ${formatarBRL(planejado - realizado)})`;
}

/** Barra de progresso realizado x planejado, com a situação por extenso logo abaixo. */
export function BarraProgresso({ planejado, realizado, semTexto }: { planejado: number; realizado: number; semTexto?: boolean }) {
  const t = useTema();
  const faixa = faixaDoProgresso(planejado, realizado);
  const cor = faixa === "estourou" || faixa === "sem_plano" ? t.perigo : faixa === "atencao" ? t.alerta : t.ok;
  const p = planejado > 0 ? Math.min(100, (realizado / planejado) * 100) : faixa === "sem_plano" ? 100 : 0;
  const texto = textoDaFaixa(planejado, realizado);
  return (
    <View style={{ gap: 4 }}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={texto}
        accessibilityValue={planejado > 0 ? { min: 0, max: 100, now: Math.min(100, Math.round((realizado / planejado) * 100)) } : undefined}
        style={{ height: 8, borderRadius: 4, backgroundColor: t.borda, overflow: "hidden" }}
      >
        <View style={{ height: 8, borderRadius: 4, width: `${p}%`, backgroundColor: cor }} />
      </View>
      {semTexto ? null : <Texto pequeno cor={cor}>{texto}</Texto>}
    </View>
  );
}
