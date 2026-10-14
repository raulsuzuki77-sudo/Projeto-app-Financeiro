import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import type { Moeda } from "../../../../core/src/index";
import { LiberdadeAportes } from "../../components/liberdade-aportes";
import { LiberdadeCambio } from "../../components/liberdade-cambio";
import { LiberdadeDistribuicao } from "../../components/liberdade-distribuicao";
import { LiberdadeCarteira } from "../../components/liberdade-carteira";
import { LiberdadeEvolucao } from "../../components/liberdade-evolucao";
import { LiberdadeExtratos } from "../../components/liberdade-extratos";
import { LiberdadeImportar } from "../../components/liberdade-importar";
import { LiberdadeManual } from "../../components/liberdade-manual";
import { LiberdadeMetas } from "../../components/liberdade-metas";
import { LiberdadePatrimonio } from "../../components/liberdade-patrimonio";
import { LiberdadePizzas } from "../../components/liberdade-pizzas";
import { SeletorMes } from "../../components/seletor-mes";
import { useTema } from "../../components/tema";
import { useToast } from "../../components/toast";
import { Aviso, Cartao, Texto } from "../../components/ui";
import { useBotaoAtualizar, useDados } from "../../hooks/useDados";
import { api, type DadosLiberdade } from "../../lib/api";
import { mesAtual } from "../../lib/format";

type ItemDaCarteira = DadosLiberdade["carteira"]["itens"][number];

/** Acompanhamento de investimentos a partir de extratos em PDF e de posições lançadas à mão. Só organiza dados e mostra números. */
export default function Liberdade() {
  const t = useTema();
  const toast = useToast();
  const [mes, setMes] = useState(mesAtual());

  const { dados, erro, carregando, recarregar } = useDados(async () => {
    const [d, metas] = await Promise.all([api.liberdade(mes), api.metas()]);
    return { d, metas };
  }, [mes]);
  useBotaoAtualizar(recarregar);

  const d = dados?.d;
  const vazio = !!d && d.extratos.length === 0 && d.evolucao.every((p) => p.sem_dados);

  function irParaMes(m: string) {
    if (m !== mes) setMes(m);
    else void recarregar();
  }

  async function removerPosicao(i: ItemDaCarteira) {
    try {
      await api.removerPosicaoInvestimento(i.id);
      toast({
        texto: `Posição removida: ${i.ativo}.`,
        acao: {
          rotulo: "Desfazer",
          fazer: async () => {
            await api.adicionarPosicaoInvestimento({ mes: i.mes_snapshot, instituicao: i.instituicao, classe_ativo: i.classe_ativo, ativo: i.ativo, valor_centavos: i.saldo_original_centavos, moeda: i.moeda as Moeda, codigo: i.codigo, quantidade: i.quantidade, especie: i.especie_origem === "extrato" ? i.especie : null });
            await recarregar();
          },
        },
      });
    } catch (e) {
      toast({ texto: e instanceof Error ? e.message : "Não foi possível remover a posição." });
    }
    await recarregar();
  }

  async function salvarCadastro(chave: string, alteracao: Record<string, unknown>) {
    await api.salvarCadastroAtivo(chave, alteracao);
    toast({ texto: "Cadastro do ativo salvo." });
    await recarregar();
  }

  const importar = d ? <LiberdadeImportar key="importar" extratos={d.extratos} cambios={d.cambios} aoSalvar={irParaMes} /> : null;
  const manual = <LiberdadeManual key="manual" mes={mes} aoSalvar={irParaMes} />;

  return (
    <ScrollView style={{ backgroundColor: t.fundo }} contentContainerStyle={{ padding: 16, paddingBottom: 40, alignItems: "center" }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={carregando} onRefresh={recarregar} tintColor={t.primaria} />}>
      <View style={{ width: "100%", maxWidth: 900, gap: 16 }}>
        <SeletorMes mes={mes} onChange={setMes} />
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

        {d && vazio ? (
          <>
            <Cartao titulo="Liberdade financeira">
              <Texto>Aqui você acompanha o patrimônio investido a partir dos extratos das corretoras e dos bancos, sem digitar nada além da confirmação.</Texto>
              <Texto suave>Para começar, importe o PDF do extrato mensal (hoje, o Extrato da Conta Investimento do BTG Pactual e o Account Statement da BTG Pactual US). O aplicativo mostra o que leu e confere a soma das posições com o total do próprio extrato antes de gravar. Para o que não tem extrato lido, lance a posição manualmente.</Texto>
              <Texto suave pequeno>Este painel apenas organiza dados e mostra números; não é recomendação de investimento.</Texto>
            </Cartao>
            {importar}
            {manual}
          </>
        ) : null}

        {d && !vazio ? (
          <>
            <LiberdadePatrimonio dados={d} mes={mes} />
            <LiberdadeCarteira carteira={d.carteira} mes={mes} aoSalvarCadastro={salvarCadastro} aoRemoverPosicao={removerPosicao} />
            <LiberdadePizzas carteira={d.carteira} />
            <LiberdadeDistribuicao patrimonio={d.patrimonio} />
            <LiberdadeEvolucao evolucao={d.evolucao} mes={mes} />
            <LiberdadeAportes dados={d} />
            <LiberdadeMetas patrimonioCentavos={d.patrimonio.liberdade_centavos} metaCentavos={d.patrimonio.meta_centavos} metas={dados?.metas ?? []} />
            <LiberdadeCambio mes={mes} cambios={d.cambios} temMoedaEstrangeira={d.patrimonio.contas.some((c) => c.moeda !== "BRL")} aoMudar={recarregar} />
            {importar}
            {manual}
            <LiberdadeExtratos extratos={d.extratos} aoMudar={recarregar} />
            <Texto suave pequeno>Este painel apenas organiza dados e mostra números; não é recomendação de investimento.</Texto>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}
