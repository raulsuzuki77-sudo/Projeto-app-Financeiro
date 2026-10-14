import { chaveEstabelecimento } from "../classification/classificador";

/**
 * Dois lançamentos (um previsto por recorrência e um real, ou dois reais) são o mesmo compromisso?
 *  - valor praticamente igual (diferença de até 1%): basta, mesmo com descrições diferentes ("Aluguel" x "Boleto: IMOBILIARIA");
 *  - mesmo estabelecimento (chave igual) e valor até 30% diferente: contas variáveis (energia, água, cartão).
 */
export function mesmoCompromisso(a: { estabelecimento_norm: string; valor_centavos: number }, b: { estabelecimento_norm: string; valor_centavos: number }): boolean {
  const dif = Math.abs(a.valor_centavos - b.valor_centavos);
  const base = Math.max(a.valor_centavos, b.valor_centavos, 1);
  if (dif <= Math.max(1, base * 0.01)) return true;
  const ca = chaveEstabelecimento(a.estabelecimento_norm);
  return ca !== "" && ca === chaveEstabelecimento(b.estabelecimento_norm) && dif <= base * 0.3;
}
