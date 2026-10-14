import { View } from "react-native";
import { useTema } from "./tema";
import { Cartao, Texto } from "./ui";
import type { Meta } from "../lib/api";
import { formatarBRL } from "../lib/format";

/**
 * Patrimônio da liberdade financeira (total menos o que está marcado como Meta, isto é, reserva ou provisão) contra a soma dos
 * valores-alvo das metas ativas. Só números: sem recomendação.
 */
export function LiberdadeMetas({ patrimonioCentavos, metaCentavos = 0, metas }: { patrimonioCentavos: number; metaCentavos?: number; metas: Meta[] }) {
  const t = useTema();
  const alvo = metas.reduce((s, m) => s + m.valor_alvo_centavos, 0);
  const pct = alvo > 0 ? (patrimonioCentavos / alvo) * 100 : 0;
  const barra = Math.max(0, Math.min(100, pct));
  const texto = alvo > 0 ? `${pct.toFixed(1).replace(".", ",")}% da soma dos valores-alvo` : "";
  return (
    <Cartao titulo="Metas">
      {metas.length === 0 ? (
        <Texto suave>Nenhuma meta ativa. Cadastre metas em Mais opções, Metas e cenários para comparar com o patrimônio.</Texto>
      ) : (
        <>
          <Texto>{`Patrimônio da liberdade financeira: ${formatarBRL(patrimonioCentavos)}`}</Texto>
          {metaCentavos !== 0 ? <Texto suave pequeno>{`Fora desta comparação: ${formatarBRL(metaCentavos)} marcados como Meta (reserva e provisões).`}</Texto> : null}
          <Texto>{`Soma dos valores-alvo de ${metas.length} meta(s) ativa(s): ${formatarBRL(alvo)}`}</Texto>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`Patrimônio equivale a ${texto}`}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(barra) }}
            style={{ height: 10, borderRadius: 5, backgroundColor: t.borda, overflow: "hidden" }}
          >
            <View style={{ height: 10, borderRadius: 5, width: `${barra}%`, backgroundColor: t.primaria }} />
          </View>
          <Texto pequeno>{`Equivale a ${texto}${pct > 100 ? " (acima da soma)" : ""}; ${patrimonioCentavos >= alvo ? `excede em ${formatarBRL(patrimonioCentavos - alvo)}` : `faltam ${formatarBRL(alvo - patrimonioCentavos)}`}.`}</Texto>
          <Texto suave pequeno>Comparação aritmética: as metas não estão vinculadas a posições específicas, e o valor não considera prazos nem rentabilidade futura.</Texto>
        </>
      )}
    </Cartao>
  );
}
