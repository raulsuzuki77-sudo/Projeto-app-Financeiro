import {
  alterarLancamento, atualizarMeta, calendarioMensal, capacidadePoupanca, cenariosDaMeta, criarCartao, criarMeta, lerPremissas, listarCartoes,
  listarLancamentos, listarMetas, mapaCalor, processarMensagem, removerCartao, removerMeta, reservaDeEmergencia, resumoMensal, salvarPremissa,
  type Cartao, type Lancamento, type Meta, type Natureza, type Premissa, type ResumoMensal, type Status, type CenarioMeta,
} from "../../../core/src/index";
import { obterBanco } from "../data/banco";

export type { Cartao, Lancamento, Meta, ResumoMensal, CenarioMeta };
export type PremissaApi = Premissa;
export type CenariosDaMeta = ReturnType<typeof cenariosDaMeta>;
export type Reserva = ReturnType<typeof reservaDeEmergencia>;
export type MapaCalor = ReturnType<typeof mapaCalor>;

/** Aplicativo de um unico usuario: o identificador existe so para manter o schema compativel com o servidor opcional. */
export const USUARIO = "local";

let seq = 0;
const novoId = () => `app-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2)}`;

/**
 * Fachada local: as telas chamam estas funcoes e tudo roda no iPhone (SQLite local + nucleo compartilhado).
 * Mantida assincrona para que as telas nao dependam de onde a logica roda.
 */
export const api = {
  enviarMensagem: async (texto: string) => ({ resposta: processarMensagem(obterBanco(), { id: novoId(), usuario_id: USUARIO, texto, recebida_em: new Date(), origem: "texto_manual" }) }),
  lancamentos: async (q: { mes?: string; status?: string }) => listarLancamentos(obterBanco(), USUARIO, q) as Lancamento[],
  alterar: async (id: number, dados: { categoria?: string; natureza?: Natureza; status?: Status }) => alterarLancamento(obterBanco(), id, USUARIO, dados),
  resumo: async (mes: string) => resumoMensal(obterBanco(), USUARIO, mes),
  mapaCalor: async (de: string, ate: string) => mapaCalor(obterBanco(), USUARIO, de, ate),
  calendario: async (mes: string) => calendarioMensal(obterBanco(), USUARIO, mes),

  cartoes: async () => listarCartoes(obterBanco(), USUARIO),
  criarCartao: async (c: { apelido: string; ultimos4?: string | null }) => criarCartao(obterBanco(), USUARIO, c),
  removerCartao: async (id: number) => removerCartao(obterBanco(), USUARIO, id),

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
    if (!meta) throw new Error("Meta nao encontrada.");
    return cenariosDaMeta(obterBanco(), USUARIO, meta, aporteCentavos);
  },
  reserva: async (meses: number) => reservaDeEmergencia(obterBanco(), USUARIO, meses),
  poupanca: async () => capacidadePoupanca(obterBanco(), USUARIO),
};
