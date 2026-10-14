import { Text, View } from "react-native";
import { useTema } from "./tema";
import { Aviso, Cartao, Texto } from "./ui";
import type { DadosLiberdade } from "../lib/api";
import { formatarBRL, nomeMes } from "../lib/format";
import { comSinal, formatarUSD, mesCurto, nomeDaConta, percentualTexto } from "../lib/investimentos";

function Indicador({ rotulo, valor, detalhe, cor }: { rotulo: string; valor: string; detalhe?: string; cor?: string }) {
  const t = useTema();
  return (
    <View style={{ flex: 1, minWidth: 150, gap: 2 }} accessible accessibilityLabel={`${rotulo}: ${valor}${detalhe ? `. ${detalhe}` : ""}`}>
      <Text style={{ color: t.suave, fontSize: 13 }}>{rotulo}</Text>
      <Text style={{ color: cor ?? t.texto, fontSize: 18, fontWeight: "700" }}>{valor}</Text>
      {detalhe ? <Text style={{ color: t.suave, fontSize: 12 }}>{detalhe}</Text> : null}
    </View>
  );
}

/** Cartão principal: patrimônio em reais no fim do mês, variação, aportes líquidos e rentabilidade ESTIMADA. */
export function LiberdadePatrimonio({ dados, mes }: { dados: DadosLiberdade; mes: string }) {
  const t = useTema();
  const { patrimonio: p, variacao: v } = dados;
  const cor = (c: number | null) => (c === null || c === 0 ? t.texto : c > 0 ? t.receita : t.despesa);
  return (
    <Cartao titulo="Patrimônio">
      <View accessible accessibilityLabel={`Patrimônio em ${nomeMes(mes)}: ${formatarBRL(p.total_centavos)}`} style={{ gap: 2 }}>
        <Text style={{ color: t.texto, fontSize: 30, fontWeight: "800" }}>{formatarBRL(p.total_centavos)}</Text>
        <Text style={{ color: t.suave, fontSize: 13 }}>
          {p.sem_dados ? "Sem posições até este mês." : `Posição ao fim de ${nomeMes(mes)}, em reais${p.contas.length ? `, somando ${p.contas.length} conta(s)` : ""}.`}
        </Text>
      </View>

      {!p.sem_dados ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            <Indicador
              rotulo={`Variação sobre ${mesCurto(v.mes_anterior)}`}
              valor={v.variacao_centavos === null ? "indisponível" : comSinal(v.variacao_centavos, formatarBRL)}
              detalhe={v.patrimonio_anterior_centavos === null ? undefined : `Mês anterior: ${formatarBRL(v.patrimonio_anterior_centavos)}`}
              cor={cor(v.variacao_centavos)}
            />
            <Indicador
              rotulo="Aportes líquidos no mês"
              valor={comSinal(v.aportes_liquidos_centavos, formatarBRL)}
              detalhe="Dos extratos: aportes e transferências de custódia, menos resgates"
            />
            <Indicador
              rotulo="Rentabilidade estimada"
              valor={v.rentabilidade_estimada_centavos === null ? "indisponível" : comSinal(v.rentabilidade_estimada_centavos, formatarBRL)}
              detalhe={v.rentabilidade_estimada_pct === null ? undefined : `${percentualTexto(v.rentabilidade_estimada_pct)} sobre o patrimônio do mês anterior`}
              cor={cor(v.rentabilidade_estimada_centavos)}
            />
          </View>
          <Texto suave pequeno>{`Rentabilidade estimada (${v.nota}).${v.inclui_cambio ? " Nas contas em dólar, inclui a variação cambial." : ""}`}</Texto>
          {v.motivo_indisponivel && v.rentabilidade_estimada_centavos === null ? <Texto suave pequeno>{`Rentabilidade não calculada: ${v.motivo_indisponivel}`}</Texto> : null}
          {v.ja_contados > 0 ? <Texto suave pequeno>{`${v.ja_contados} movimento(s) deste mês já constavam como "em trânsito" no extrato anterior e não foram contados de novo nos aportes.`}</Texto> : null}
        </>
      ) : null}

      {p.defasadas.length > 0 ? (
        <Aviso tipo="info">
          {`Dados defasados (valem como posição mais recente conhecida): ${p.defasadas.map((c) => `${nomeDaConta(c)}, última posição de ${mesCurto(c.mes_snapshot)}`).join("; ")}. Importe o extrato do mês para atualizar.`}
        </Aviso>
      ) : null}
      {p.cambio_ausente.length > 0 ? (
        <Aviso tipo="erro">
          {`Sem taxa de câmbio para ${p.cambio_ausente.map((c) => `${nomeDaConta(c)} (${formatarUSD(c.total_original_centavos)})`).join("; ")}: esse valor ficou fora do total em reais. Informe a taxa em Câmbio.`}
        </Aviso>
      ) : null}
      {p.contas.some((c) => c.cambio_defasado) ? (
        <Aviso tipo="info">{`Conversão em dólar com a taxa de ${p.contas.filter((c) => c.cambio_defasado).map((c) => mesCurto(c.mes_taxa!)).join(", ")}, a última informada até este mês. Informe a taxa do mês para atualizar.`}</Aviso>
      ) : null}
      {v.aportes_sem_cambio > 0 ? <Aviso tipo="info">{`${v.aportes_sem_cambio} movimento(s) em dólar sem taxa de câmbio ficaram fora dos aportes.`}</Aviso> : null}
    </Cartao>
  );
}
