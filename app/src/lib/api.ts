import {
  alterarLancamento, atualizarMeta, atualizarRecorrencia, calendarioMensal, capacidadePoupanca, cenariosDaMeta, classificarEmLote, criarCartao, criarMeta,
  criarRecorrencia, definirTitular, editarLancamento, excluirLancamento, gerarRecorrencias, lancarManual, lerPremissas, listarCartoes, listarLancamentos, listarMetas,
  listarRecorrencias, mapaCalor, obterLancamento, paraLocal, processarMensagem, removerCartao, removerMeta, removerRecorrencia, reservaDeEmergencia,
  reaplicarRegrasAosPendentes, restaurarLancamento, resumoMensal, salvarPremissa, sugerirCategorias,
  type Cartao, type CenarioMeta, type EdicaoCompleta, type FiltroLancamentos, type Lancamento, type LancamentoManual, type Meta, type Natureza,
  type NovaRecorrencia, type Premissa, type Recorrencia, type ResumoMensal, type Status, type Sugestao,
} from "../../../core/src/index";
import { obterBanco } from "../data/banco";

export type { Cartao, CenarioMeta, Lancamento, LancamentoManual, Meta, Recorrencia, ResumoMensal, Sugestao, EdicaoCompleta };
export type PremissaApi = Premissa;
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
};
