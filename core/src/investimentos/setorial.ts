import { nomeDeSetor } from "./dicionario";
import type { SetorPercentual } from "./tipos";

export interface AcaoParaSetor {
  /** Identificador de quem chama (codigo, indice...). */
  id: string;
  valor_centavos: number;
}

export interface ResultadoSetorial {
  /** id da acao -> setor (so as atribuicoes sem ambiguidade). */
  atribuicao: Map<string, string>;
  avisos: string[];
}

const MAX_ACOES = 12;
const MAX_SOLUCOES = 200;

/**
 * Atribui setor a cada acao conciliando a "Distribuicao Setorial" do extrato (percentuais da carteira de acoes) com os saldos:
 * procura as particoes das acoes em grupos cujas somas batem com cada percentual (tolerancia de 0,0105% da base mais 1 centavo,
 * pois o extrato arredonda ou trunca na segunda casa). So atribui o que e igual em TODAS as particoes possiveis; o resto fica
 * sem setor e sai um aviso. Nada e chutado: sem solucao, ninguem recebe setor.
 */
export function conciliarSetores(acoes: AcaoParaSetor[], setorial: SetorPercentual[]): ResultadoSetorial {
  const atribuicao = new Map<string, string>();
  const avisos: string[] = [];
  if (setorial.length === 0 || acoes.length === 0) return { atribuicao, avisos };

  const somaPct = setorial.reduce((s, x) => s + x.pct, 0);
  if (Math.abs(somaPct - 100) > 0.1) {
    avisos.push(`Distribuição setorial soma ${somaPct.toFixed(2).replace(".", ",")}% e não 100%: não foi usada para atribuir setor às ações.`);
    return { atribuicao, avisos };
  }
  if (acoes.length > MAX_ACOES) {
    avisos.push(`Distribuição setorial não conciliada: mais de ${MAX_ACOES} ações (informe o setor de cada uma no cadastro do ativo).`);
    return { atribuicao, avisos };
  }
  const base = acoes.reduce((s, a) => s + a.valor_centavos, 0);
  if (base <= 0) return { atribuicao, avisos };

  const setores = [...setorial].sort((a, b) => b.pct - a.pct);
  const alvo = setores.map((s) => (s.pct / 100) * base);
  const tol = 0.000105 * base + 1;
  const n = acoes.length;
  const valores = acoes.map((a) => a.valor_centavos);
  const somaMascara = (m: number): number => {
    let t = 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) t += valores[i]!;
    return t;
  };

  const solucoes: number[][] = [];
  const atual: number[] = [];
  const buscar = (k: number, restantes: number): void => {
    if (solucoes.length >= MAX_SOLUCOES) return;
    if (k === setores.length - 1) {
      if (restantes !== 0 && Math.abs(somaMascara(restantes) - alvo[k]!) <= tol) solucoes.push([...atual, restantes]);
      return;
    }
    // todos os subconjuntos nao vazios de `restantes`
    for (let sub = restantes; sub > 0; sub = (sub - 1) & restantes) {
      if (Math.abs(somaMascara(sub) - alvo[k]!) <= tol) {
        atual.push(sub);
        buscar(k + 1, restantes & ~sub);
        atual.pop();
      }
    }
  };
  buscar(0, (1 << n) - 1);

  if (solucoes.length === 0) {
    avisos.push("Distribuição setorial do extrato não pôde ser conciliada com os saldos das ações: setores não atribuídos (use o cadastro do ativo).");
    return { atribuicao, avisos };
  }
  let ambiguas = 0;
  for (let i = 0; i < n; i++) {
    const candidatos = new Set(solucoes.map((sol) => sol.findIndex((m) => (m & (1 << i)) !== 0)));
    if (candidatos.size === 1) atribuicao.set(acoes[i]!.id, nomeDeSetor(setores[[...candidatos][0]!]!.setor));
    else ambiguas++;
  }
  if (ambiguas > 0) avisos.push(`Distribuição setorial: ${ambiguas} ação(ões) ficaram sem setor por ambiguidade (mais de uma combinação de saldos bate com os percentuais).`);
  return { atribuicao, avisos };
}
