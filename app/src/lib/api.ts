import * as SecureStore from "expo-secure-store";

const CHAVE_URL = "servidor_url";
const CHAVE_TOKEN = "servidor_token";

export interface Conexao {
  url: string;
  token: string;
}

export async function lerConexao(): Promise<Conexao | null> {
  const url = await SecureStore.getItemAsync(CHAVE_URL);
  const token = await SecureStore.getItemAsync(CHAVE_TOKEN);
  return url && token ? { url, token } : null;
}

export async function salvarConexao(c: Conexao): Promise<void> {
  await SecureStore.setItemAsync(CHAVE_URL, c.url);
  await SecureStore.setItemAsync(CHAVE_TOKEN, c.token);
}

export async function apagarConexao(): Promise<void> {
  await SecureStore.deleteItemAsync(CHAVE_URL);
  await SecureStore.deleteItemAsync(CHAVE_TOKEN);
}

export class ErroApi extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function chamar<T>(caminho: string, init: RequestInit = {}, timeoutMs = 20_000, conexao?: Conexao | null): Promise<T> {
  const c = conexao ?? (await lerConexao());
  if (!c) throw new ErroApi("Configure o servidor na aba Ajustes.", 0);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${c.url}${caminho}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${c.token}` }, signal: ctl.signal });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErroApi((corpo as { erro?: string }).erro ?? `Erro ${r.status}`, r.status);
    return corpo as T;
  } catch (e) {
    if (e instanceof ErroApi) throw e;
    throw new ErroApi("Nao foi possivel falar com o servidor. Verifique o endereco e a rede.", 0);
  } finally {
    clearTimeout(t);
  }
}

export interface Lancamento {
  id: number;
  tipo: string;
  valor_centavos: number;
  descricao: string;
  categoria: string;
  natureza: string;
  data_local: string;
  hora_local: number | null;
  status: "pendente" | "confirmado" | "cancelado";
  motivo_revisao: string | null;
}

export interface ResumoMensal {
  mes: string;
  receitas_centavos: number;
  despesas_centavos: number;
  investimentos_centavos: number;
  saldo_centavos: number;
  taxa_poupanca: number | null;
  pendentes: number;
  por_categoria: { categoria: string; total_centavos: number }[];
  por_natureza: { natureza: string; total_centavos: number }[];
}

export interface MapaCalor {
  celulas: { dia_semana: number; hora: number; total_centavos: number; quantidade: number }[];
  excluidos_sem_horario: number;
}

export interface Meta {
  id: number;
  nome: string;
  tipo: string;
  valor_alvo_centavos: number;
  aporte_inicial_centavos: number;
  prazo_meses: number;
}

export interface CenarioMeta {
  cenario: "conservador" | "moderado" | "arrojado";
  retorno_nominal_aa: number;
  taxa_real_aa: number;
  aporte_mensal_necessario_centavos: number;
  total_aportado_centavos: number;
  ir_estimado_centavos: number;
  valor_alvo_nominal_centavos: number;
  atingida_sem_aportes: boolean;
  prazo_com_aporte_meses?: number | null;
}

export interface CenariosDaMeta {
  meta: Meta;
  ipca_aa: number;
  cenarios: CenarioMeta[];
  premissas_padrao: boolean;
  aviso: string;
}

export interface Reserva {
  media_mensal_centavos: number;
  meses_cobertura: number;
  valor_alvo_centavos: number;
  meses_sem_dados: string[];
  observacao: string;
}

export interface PremissaApi {
  chave: "conservador" | "moderado" | "arrojado" | "ipca";
  retorno_nominal_aa: number;
  ir_modo: "regressivo" | "fixa" | "isento";
  ir_aliquota: number | null;
  atualizada_em: string | null;
}

export const api = {
  testar: (c: Conexao) => chamar<{ ok: boolean }>("/health", {}, 8000, c),
  enviarMensagem: (texto: string) =>
    chamar<{ resposta: string }>("/api/mensagens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: `app-${Date.now()}-${Math.random().toString(36).slice(2)}`, texto }) }),
  lancamentos: (q: { mes?: string; status?: string }) => chamar<Lancamento[]>(`/api/lancamentos?${new URLSearchParams(q as Record<string, string>)}`),
  alterar: (id: number, dados: { categoria?: string; status?: string }) =>
    chamar<Lancamento>(`/api/lancamentos/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(dados) }),
  resumo: (mes: string) => chamar<ResumoMensal>(`/api/dashboard/resumo?mes=${mes}`),
  mapaCalor: (de: string, ate: string) => chamar<MapaCalor>(`/api/dashboard/mapa-calor?de=${de}&ate=${ate}`),
  calendario: (mes: string) => chamar<{ data: string; total_centavos: number; quantidade: number }[]>(`/api/dashboard/calendario?mes=${mes}`),
  premissas: () => chamar<{ premissas: PremissaApi[]; premissas_padrao: boolean }>("/api/premissas"),
  salvarPremissa: (p: { chave: string; retorno_nominal_aa: number; ir_modo?: string; ir_aliquota?: number | null }) =>
    chamar<{ premissas: PremissaApi[]; premissas_padrao: boolean }>("/api/premissas", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }),
  metas: () => chamar<Meta[]>("/api/metas"),
  criarMeta: (m: Omit<Meta, "id">) => chamar<{ id: number }>("/api/metas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m) }),
  removerMeta: (id: number) => chamar<{ ok: boolean }>(`/api/metas/${id}`, { method: "DELETE" }),
  cenarios: (id: number, aporteCentavos?: number) => chamar<CenariosDaMeta>(`/api/metas/${id}/cenarios${aporteCentavos !== undefined ? `?aporte_mensal_centavos=${aporteCentavos}` : ""}`),
  reserva: (meses: number) => chamar<Reserva>(`/api/reserva-emergencia?meses=${meses}`),
  poupanca: () => chamar<{ sobra_media_mensal_centavos: number; observacao: string }>("/api/capacidade-poupanca"),
  enviarArquivo: async (uri: string, mime: "application/pdf" | "image/png" | "image/jpeg", tipo: "fatura" | "comprovante") => {
    const blob = await (await fetch(uri)).blob();
    return chamar<Record<string, unknown>>(`/api/importacoes-arquivo?tipo=${tipo}`, { method: "POST", headers: { "content-type": mime }, body: blob }, 180_000);
  },
};
