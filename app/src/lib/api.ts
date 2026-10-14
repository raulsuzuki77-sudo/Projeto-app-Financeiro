import {
  candidatosParaEvento, ignorarRecorrente, listarRecorrentesIgnoradas, parcelasFuturas, restaurarRecorrenteIgnorada, sugestoesDoPeriodo, vincularLancamentos, visoesDeDespesa,
  alterarLancamento, atualizarEvento, copiarOrcamento, coberturaDaRecorrencia, coberturaPrevia, criarEvento, definirClasse, definirEventoDoLancamento, definirOrcamento, detalheEvento, detectarRecorrentes,
  gerarRecorrenciasDetalhado, listarEventos, orcamentoVsMetas, painelOrcamento, removerEvento, removerOrcamento, sugerirOrcamentoPelaMedia, viagensSemEvento, atualizarMeta, atualizarRecorrencia, calendarioMensal, capacidadePoupanca, cenariosDaMeta, classificarEmLote, criarCartao, criarMeta,
  criarRecorrencia, definirTitular, editarLancamento, excluirLancamento, gerarRecorrencias, lancarManual, lerPremissas, listarCartoes, listarLancamentos, listarMetas,
  listarRecorrencias, mapaCalor, obterLancamento, paraLocal, processarMensagem, removerCartao, removerMeta, removerRecorrencia, reservaDeEmergencia,
  reaplicarRegrasAosPendentes, restaurarLancamento, resumoMensal, salvarPremissa, sugerirCategorias,
  type Cartao, type CenarioMeta, type ClasseId, type NovoEvento, type PainelOrcamento, type RecorrenteDetectada, type EdicaoCompleta, type FiltroLancamentos, type Lancamento, type LancamentoManual, type Meta, type Natureza,
  type NovaRecorrencia, type Premissa, type Recorrencia, type ResumoMensal, type Status, type Sugestao,
} from "../../../core/src/index";
import { obterBanco } from "../data/banco";
import {
  adicionarPosicaoManual as adicionarPosicaoManualInv, aportesLancamentos, definirCambio as definirCambioInv, evolucaoPatrimonio, extratoJaImportado, listarCadastroAtivos, listarCambios, listarExtratos,
  montarCarteira, movimentosDoMes, patrimonio as patrimonioInv, removerCadastroAtivo as removerCadastroAtivoInv, removerCambio as removerCambioInv, removerExtrato, removerPosicao as removerPosicaoInv,
  salvarCadastroAtivo as salvarCadastroAtivoInv, salvarExtrato as salvarExtratoInv, variacaoDoMes,
  type AlteracaoCadastro, type ExtratoLido, type PosicaoManual,
} from "../../../core/src/index";

export type { ClasseId, NovoEvento, PainelOrcamento, RecorrenteDetectada, Cartao, CenarioMeta, Lancamento, LancamentoManual, Meta, Recorrencia, ResumoMensal, Sugestao, EdicaoCompleta };
export type PremissaApi = Premissa;
export type { AlteracaoCadastro, ExtratoLido, PosicaoManual };
export type DadosLiberdade = {
  patrimonio: ReturnType<typeof patrimonioInv>;
  variacao: ReturnType<typeof variacaoDoMes>;
  evolucao: ReturnType<typeof evolucaoPatrimonio>;
  movimentos: ReturnType<typeof movimentosDoMes>;
  lancamentos: ReturnType<typeof aportesLancamentos>;
  extratos: ReturnType<typeof listarExtratos>;
  cambios: ReturnType<typeof listarCambios>;
  /** Patrimonio do mes em genero > especie > ativo, com preco medio, resultado, setor e exposicao. */
  carteira: ReturnType<typeof montarCarteira>;
  cadastros: ReturnType<typeof listarCadastroAtivos>;
};
export type CenariosDaMeta = ReturnType<typeof cenariosDaMeta>;
export type Reserva = ReturnType<typeof reservaDeEmergencia>;
export type MapaCalor = ReturnType<typeof mapaCalor>;

/** Aplicativo de um único usuário: o identificador existe só para manter o schema compatível com o servidor opcional. */
export const USUARIO = "local";

let seq = 0;
const novoId = () => `app-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2)}`;
const hoje = () => paraLocal(new Date()).data_local;

/**
 * Fachada local: as telas chamam estas funções e tudo roda no iPhone (SQLite local + núcleo compartilhado).
 * Mantida assíncrona para que as telas não dependam de onde a lógica roda.
 */
export const api = {
  enviarMensagem: async (texto: string) => ({ resposta: processarMensagem(obterBanco(), { id: novoId(), usuario_id: USUARIO, texto, recebida_em: new Date(), origem: "texto_manual" }) }),
  lancar: async (l: LancamentoManual) => lancarManual(obterBanco(), USUARIO, l, novoId()),

  lancamentos: async (q: FiltroLancamentos) => listarLancamentos(obterBanco(), USUARIO, q) as Lancamento[],
  lancamento: async (id: number) => {
    const l = obterLancamento(obterBanco(), id);
    return l && l.usuario_id === USUARIO ? l : undefined;
  },
  alterar: async (id: number, dados: { categoria?: string; natureza?: Natureza; status?: Status }) => alterarLancamento(obterBanco(), id, USUARIO, dados),
  editar: async (id: number, dados: EdicaoCompleta) => editarLancamento(obterBanco(), id, USUARIO, dados),
  excluir: async (id: number) => excluirLancamento(obterBanco(), id, USUARIO),
  restaurar: async (id: number) => restaurarLancamento(obterBanco(), id, USUARIO),
  classificarLote: async (id: number, categoria: string, similares = true) => classificarEmLote(obterBanco(), id, USUARIO, categoria, similares),
  sugestoes: async (descricao: string, tipo: "despesa" | "receita" | "investimento" = "despesa", ctx?: { valor_centavos?: number; data_local?: string }) => sugerirCategorias(obterBanco(), USUARIO, descricao, tipo, 3, ctx),
  /** Reaplica as regras aprendidas aos pendentes sem categoria. Devolve quantos foram resolvidos. */
  reaplicarRegras: async () => reaplicarRegrasAosPendentes(obterBanco(), USUARIO),
  /** Nome do titular: Pix de/para esse nome passam a ser transferência entre as próprias contas. Devolve quantos pendentes foram resolvidos. */
  definirTitular: async (nome: string) => definirTitular(obterBanco(), USUARIO, nome),

  resumo: async (mes: string) => resumoMensal(obterBanco(), USUARIO, mes),
  mapaCalor: async (de: string, ate: string) => mapaCalor(obterBanco(), USUARIO, de, ate),
  calendario: async (mes: string) => calendarioMensal(obterBanco(), USUARIO, mes),

  cartoes: async () => listarCartoes(obterBanco(), USUARIO),
  criarCartao: async (c: { apelido: string; ultimos4?: string | null }) => criarCartao(obterBanco(), USUARIO, c),
  removerCartao: async (id: number) => removerCartao(obterBanco(), USUARIO, id),

  recorrencias: async () => listarRecorrencias(obterBanco(), USUARIO),
  criarRecorrencia: async (r: NovaRecorrencia) => criarRecorrencia(obterBanco(), USUARIO, r, hoje()),
  atualizarRecorrencia: async (id: number, p: Parameters<typeof atualizarRecorrencia>[3]) => atualizarRecorrencia(obterBanco(), USUARIO, id, p),
  removerRecorrencia: async (id: number) => removerRecorrencia(obterBanco(), USUARIO, id),
  /** Gera os lançamentos de recorrências que já venceram. Chamada ao abrir o app e ao atualizar. */
  gerarRecorrencias: async () => gerarRecorrencias(obterBanco(), USUARIO, hoje()),

  gerarRecorrenciasDetalhado: async () => gerarRecorrenciasDetalhado(obterBanco(), USUARIO, hoje()),
  /** Compromissos que se repetem mês a mês nos lançamentos, ainda cadastrados ou não. */
  recorrentesDetectadas: async () => detectarRecorrentes(obterBanco(), USUARIO, hoje()),
  /** Meses em que os lançamentos importados já contemplam a recorrência (contada uma só vez). */
  coberturaRecorrencia: async (id: number) => coberturaDaRecorrencia(obterBanco(), USUARIO, id, hoje()),

  /** Antes de cadastrar: meses recentes em que um lançamento importado já contempla o compromisso. */
  coberturaPrevia: async (r: { descricao: string; tipo: "despesa" | "receita" | "investimento"; valor_centavos: number }) => coberturaPrevia(obterBanco(), USUARIO, r, hoje()),

  eventos: async () => listarEventos(obterBanco(), USUARIO),
  criarEvento: async (e: NovoEvento) => criarEvento(obterBanco(), USUARIO, e),
  atualizarEvento: async (id: number, p: Partial<Omit<NovoEvento, "vincular">>) => atualizarEvento(obterBanco(), USUARIO, id, p),
  removerEvento: async (id: number) => removerEvento(obterBanco(), USUARIO, id),
  detalheEvento: async (id: number) => detalheEvento(obterBanco(), USUARIO, id),
  /** Vincula (ou, com null, desvincula) um lançamento a um evento. */
  definirEventoDoLancamento: async (lancamentoId: number, eventoId: number | null) => definirEventoDoLancamento(obterBanco(), USUARIO, lancamentoId, eventoId),
  /** Gastos de viagem e hospedagem ainda sem evento: a tela pergunta o período da viagem. */
  viagensSemEvento: async () => viagensSemEvento(obterBanco(), USUARIO),
  /** Gastos do período do evento que não foram vinculados sozinhos (mercado, compras...) para o usuário conferir. */
  sugestoesDoPeriodo: async (eventoId: number) => sugestoesDoPeriodo(obterBanco(), USUARIO, eventoId),
  /** Gastos que podem ser vinculados a mão ao evento, em qualquer data (reserva antecipada, por exemplo). */
  candidatosParaEvento: async (eventoId: number, busca?: string) => candidatosParaEvento(obterBanco(), USUARIO, eventoId, { busca }),
  vincularLancamentos: async (eventoId: number, ids: number[]) => vincularLancamentos(obterBanco(), USUARIO, eventoId, ids),

  /** Marca o compromisso como NÃO recorrente: deixa de ser sugerido. */
  ignorarRecorrente: async (tipo: "despesa" | "receita" | "investimento", chave: string, descricao: string) => ignorarRecorrente(obterBanco(), USUARIO, tipo, chave, descricao),
  restaurarRecorrenteIgnorada: async (tipo: string, chave: string) => restaurarRecorrenteIgnorada(obterBanco(), USUARIO, tipo, chave),
  recorrentesIgnoradas: async () => listarRecorrentesIgnoradas(obterBanco(), USUARIO),

  /** As mesmas despesas do mês por categoria, grupo e classe: as três visões somam o mesmo total. */
  visoesDespesa: async (mes: string) => visoesDeDespesa(obterBanco(), USUARIO, mes),
  /** Parcelas já comprometidas nos meses seguintes (fluxo de caixa das compras parceladas). */
  parcelasFuturas: async (mesInicial: string, n = 6) => parcelasFuturas(obterBanco(), USUARIO, mesInicial, n),
  /** Quantos lançamentos aguardam revisão (parcelas futuras previstas não contam). */
  contarPendentes: async () => (listarLancamentos(obterBanco(), USUARIO, { status: "pendente", ate: hoje(), limite: 2000 }) as unknown[]).length,

  orcamento: async (mes: string) => painelOrcamento(obterBanco(), USUARIO, mes),
  /** `mes` = "*" vale para todos os meses sem valor próprio; `item` = categoria ou "__receita". */
  definirOrcamento: async (mes: string, item: string, valorCentavos: number) => definirOrcamento(obterBanco(), USUARIO, mes, item, valorCentavos),
  removerOrcamento: async (mes: string, item: string) => removerOrcamento(obterBanco(), USUARIO, mes, item),
  copiarOrcamento: async (deMes: string, paraMes: string) => copiarOrcamento(obterBanco(), USUARIO, deMes, paraMes),
  sugerirOrcamento: async (mes: string) => sugerirOrcamentoPelaMedia(obterBanco(), USUARIO, mes),
  definirClasse: async (categoria: string, classe: ClasseId | null) => definirClasse(obterBanco(), USUARIO, categoria, classe),
  orcamentoVsMetas: async (mes: string) => orcamentoVsMetas(obterBanco(), USUARIO, mes),

  premissas: async () => lerPremissas(obterBanco(), USUARIO),
  salvarPremissa: async (p: { chave: string; retorno_nominal_aa: number; ir_modo?: string; ir_aliquota?: number | null }) => {
    salvarPremissa(obterBanco(), USUARIO, p);
    return lerPremissas(obterBanco(), USUARIO);
  },
  metas: async () => listarMetas(obterBanco(), USUARIO),
  criarMeta: async (m: Omit<Meta, "id">) => ({ id: criarMeta(obterBanco(), USUARIO, m) }),
  atualizarMeta: async (id: number, m: Partial<Omit<Meta, "id">>) => atualizarMeta(obterBanco(), USUARIO, id, m),
  removerMeta: async (id: number) => ({ ok: removerMeta(obterBanco(), USUARIO, id) }),
  cenarios: async (id: number, aporteCentavos?: number) => {
    const meta = listarMetas(obterBanco(), USUARIO).find((m) => m.id === id);
    if (!meta) throw new Error("Meta não encontrada.");
    return cenariosDaMeta(obterBanco(), USUARIO, meta, aporteCentavos);
  },
  reserva: async (meses: number) => reservaDeEmergencia(obterBanco(), USUARIO, meses),
  poupanca: async () => capacidadePoupanca(obterBanco(), USUARIO),

  /** Liberdade financeira: tudo o que a aba mostra para o mês (AAAA-MM), numa só leitura. */
  liberdade: async (mes: string) => {
    const db = obterBanco();
    return {
      patrimonio: patrimonioInv(db, USUARIO, mes),
      variacao: variacaoDoMes(db, USUARIO, mes),
      evolucao: evolucaoPatrimonio(db, USUARIO, mes, 12),
      movimentos: movimentosDoMes(db, USUARIO, mes),
      lancamentos: aportesLancamentos(db, USUARIO, mes),
      extratos: listarExtratos(db, USUARIO),
      cambios: listarCambios(db, USUARIO),
      carteira: montarCarteira(db, USUARIO, mes),
      cadastros: listarCadastroAtivos(db, USUARIO),
    };
  },
  /** Cadastro do ativo (preço médio informado, espécie, setor, exposição, Meta), por código ou nome; persiste entre extratos. */
  salvarCadastroAtivo: async (chave: string, alteracao: AlteracaoCadastro) => salvarCadastroAtivoInv(obterBanco(), USUARIO, chave, alteracao),
  removerCadastroAtivo: async (chave: string) => removerCadastroAtivoInv(obterBanco(), USUARIO, chave),
  /** O arquivo (pelo hash do conteúdo) já foi importado? */
  extratoInvestimentoImportado: async (hash: string) => extratoJaImportado(obterBanco(), USUARIO, hash),
  /** Grava o extrato já lido e confirmado pelo usuário. Idempotente pelo hash: reimportar devolve status "ja_importado". */
  salvarExtratoInvestimento: async (extrato: ExtratoLido, hash: string) => salvarExtratoInv(obterBanco(), USUARIO, extrato, hash),
  removerExtratoInvestimento: async (id: number) => removerExtrato(obterBanco(), USUARIO, id),
  adicionarPosicaoInvestimento: async (p: PosicaoManual) => adicionarPosicaoManualInv(obterBanco(), USUARIO, p),
  removerPosicaoInvestimento: async (id: number) => removerPosicaoInv(obterBanco(), USUARIO, id),
  /** Taxa em reais por unidade da moeda (ex.: 5,4321 para o dólar). */
  definirCambio: async (mes: string, moeda: string, taxa: number) => definirCambioInv(obterBanco(), USUARIO, mes, moeda, taxa),
  removerCambio: async (mes: string, moeda: string) => removerCambioInv(obterBanco(), USUARIO, mes, moeda),
};
