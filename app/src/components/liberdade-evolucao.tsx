import { Text, View } from "react-native";
import { useTema } from "./tema";
import { Cartao, Texto } from "./ui";
import type { DadosLiberdade } from "../lib/api";
import { formatarBRL } from "../lib/format";
import { mesCurto } from "../lib/investimentos";

/** Patrimônio dos últimos 12 meses em barras simples (uma linha por mês). */
export function LiberdadeEvolucao({ evolucao, mes }: { evolucao: DadosLiberdade["evolucao"]; mes: string }) {
  const t = useTema();
  const maximo = Math.max(0, ...evolucao.map((p) => p.total_centavos));
  const primeiro = evolucao.findIndex((p) => !p.sem_dados);
  const algum = primeiro >= 0;
  const visiveis = algum ? evolucao.slice(primeiro) : [];
  return (
    <Cartao titulo="Evolução nos últimos 12 meses">
      {!algum ? (
        <Texto suave>Ainda não há posições nesse período.</Texto>
      ) : (
        <View style={{ gap: 4 }}>
          {visiveis.map((p) => {
            const atual = p.mes === mes;
            const rotulo = p.sem_dados ? `${mesCurto(p.mes)}: sem dados` : `${mesCurto(p.mes)}: ${formatarBRL(p.total_centavos)}${p.defasadas > 0 ? `, com ${p.defasadas} conta(s) defasada(s)` : ""}${p.cambio_ausente ? ", sem câmbio" : ""}`;
            return (
              <View key={p.mes} accessible accessibilityLabel={rotulo} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 26 }}>
                <Text style={{ width: 50, color: atual ? t.texto : t.suave, fontSize: 13, fontWeight: atual ? "700" : "400" }}>{mesCurto(p.mes)}</Text>
                <View style={{ flex: 1, height: 12, justifyContent: "center" }}>
                  {!p.sem_dados && p.total_centavos > 0 && maximo > 0 ? <View style={{ height: 12, borderRadius: 3, width: `${Math.max(1.5, (p.total_centavos / maximo) * 100)}%`, backgroundColor: atual ? t.primaria : t.barra, opacity: atual ? 1 : 0.55 }} /> : null}
                </View>
                <Text style={{ width: 118, textAlign: "right", color: p.sem_dados ? t.suave : t.texto, fontSize: 13, fontWeight: atual ? "700" : "400" }}>{p.sem_dados ? "sem dados" : `${formatarBRL(p.total_centavos)}${p.defasadas > 0 || p.cambio_ausente ? " *" : ""}`}</Text>
              </View>
            );
          })}
        </View>
      )}
      {primeiro > 0 ? <Texto suave pequeno>{`Sem posições antes de ${mesCurto(evolucao[primeiro]!.mes)}.`}</Texto> : null}
      {evolucao.some((p) => p.defasadas > 0 || p.cambio_ausente) ? <Texto suave pequeno>* Mês com conta defasada (usa a posição mais recente conhecida) ou sem taxa de câmbio (valor em dólar fora do total).</Texto> : null}
    </Cartao>
  );
}
