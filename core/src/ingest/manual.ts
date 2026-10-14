import type { Db } from "../db/tipos";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "../domain/types";
import { dataValida, paraLocal } from "../parsing/tempo";
import { registrarLancamento, type ResultadoRegistro } from "./lancamentos";

export interface LancamentoManual {
  tipo: "despesa" | "receita" | "investimento";
  valor_centavos: number;
  descricao: string;
  forma_pagamento?: FormaPagamento | null;
  cartao_id?: number | null;
  /** Se informada, dispensa a classificação automática e o lançamento nasce confirmado. */
  categoria?: string;
  /** AAAA-MM-DD; padrão: hoje no fuso configurado. */
  data_local?: string;
  /** Hora (0-23) da compra; padrão: a hora atual quando a data é hoje. */
  hora_local?: number | null;
  /** Compra parcelada em N vezes (2 a 48): cada mês entra com a sua parcela, em vez do valor inteiro no mês da compra. */
  parcelas?: number;
  /** O valor informado é o da compra inteira (padrão) ou o de cada parcela. */
  valor_informado?: "total" | "parcela";
}

/** Lançamento digitado no formulário. `referencia` deve ser única por envio (impede duplicar com duplo toque). */
export function lancarManual(db: Db, usuarioId: string, l: LancamentoManual, referencia: string, agora: Date = new Date()): ResultadoRegistro {
  if (!Number.isInteger(l.valor_centavos) || l.valor_centavos <= 0) throw new Error("Informe um valor maior que zero.");
  if (!l.descricao.trim()) throw new Error("Informe o detalhamento (ex.: almoço, mercado, aluguel).");
  if (l.descricao.trim().length > 120) throw new Error("O detalhamento deve ter até 120 caracteres.");
  if (!["despesa", "receita", "investimento"].includes(l.tipo)) throw new Error("Tipo inválido.");
  if (l.forma_pagamento != null && !(FORMAS_PAGAMENTO as readonly string[]).includes(l.forma_pagamento)) throw new Error("Forma de pagamento inválida.");
  if (l.cartao_id != null && !db.prepare("SELECT 1 FROM cartao WHERE id = ? AND usuario_id = ?").get(l.cartao_id, usuarioId)) throw new Error("Cartão inexistente.");
  const local = paraLocal(agora);
  const data = l.data_local ?? local.data_local;
  const m = data.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !dataValida(+m[1]!, +m[2]!, +m[3]!)) throw new Error("Data inválida.");
  if (data > local.data_local) throw new Error("A data não pode estar no futuro.");
  if (l.hora_local != null && (!Number.isInteger(l.hora_local) || l.hora_local < 0 || l.hora_local > 23)) throw new Error("Hora inválida.");
  if (l.parcelas !== undefined && (!Number.isInteger(l.parcelas) || l.parcelas < 1 || l.parcelas > 48)) throw new Error("O número de parcelas deve estar entre 1 e 48.");
  const parcelas = l.parcelas ?? 1;
  if (parcelas > 1 && l.tipo !== "despesa") throw new Error("Só saídas podem ser parceladas.");
  // Total dividido em parcelas inteiras em centavos; o resto vai para as primeiras parcelas, e a soma fecha com o total.
  let valores: number[] | undefined;
  if (parcelas > 1) {
    if (l.valor_informado === "parcela") valores = Array<number>(parcelas).fill(l.valor_centavos);
    else {
      const base = Math.floor(l.valor_centavos / parcelas);
      const resto = l.valor_centavos - base * parcelas;
      valores = Array.from({ length: parcelas }, (_, i) => base + (i < resto ? 1 : 0));
      if (valores.some((v) => v <= 0)) throw new Error("O valor é pequeno demais para esse número de parcelas.");
    }
  }
  const hoje = data === local.data_local;
  const hora = l.hora_local !== undefined ? l.hora_local : hoje ? local.hora_local : null;
  return registrarLancamento(db, {
    usuario_id: usuarioId,
    tipo: l.tipo,
    valor_centavos: valores ? valores[0]! : l.valor_centavos,
    descricao: l.descricao.trim(),
    parcela_atual: parcelas > 1 ? 1 : null,
    parcela_total: parcelas > 1 ? parcelas : null,
    valores_parcelas: valores,
    forma_pagamento: l.forma_pagamento ?? null,
    cartao_id: l.cartao_id ?? null,
    categoria: l.categoria,
    data_local: data,
    hora_local: hora,
    // O horário da digitação aproxima o da compra; informado pelo usuário é exato.
    precisao_horario: hora === null ? "desconhecido" : l.hora_local != null ? "exato" : "aproximado",
    origem: "manual",
    referencia,
  });
}
