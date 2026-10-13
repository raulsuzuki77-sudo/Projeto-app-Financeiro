import { createHash } from "node:crypto";
import type { NovoLancamento } from "../domain/types.js";
import type { Db } from "../db/db.js";
import { registrarLancamento } from "../ingest/lancamentos.js";

export interface ItemImportado {
  data_local: string;
  descricao: string;
  /** Negativo = saída (despesa), positivo = entrada. */
  valor_centavos: number;
  referencia?: string;
  parcela_atual?: number | null;
  parcela_total?: number | null;
  /** Confiança do OCR na linha (0-100), quando a origem é imagem. */
  confianca_ocr?: number;
  /** Motivo pelo qual o item exige revisão humana (ex.: data fora de ordem). */
  alerta?: string;
}

export interface ContextoImportacao {
  usuario_id: string;
  origem: NovoLancamento["origem"];
  /** Identifica o arquivo/lote para compor referências estáveis (ex.: hash do conteúdo). */
  lote: string;
  cartao_id?: number | null;
  conta_id?: number | null;
  /** Em fatura de cartão, valores positivos são compras (despesa). */
  positivoEhDespesa?: boolean;
  /** Força todos os itens do lote como pendentes (ex.: soma não fecha com o total da fatura). */
  forcarRevisao?: string;
}

const RE_PGTO_FATURA = /pagamento de fatura|pagamento fatura|pgto fatura|pagto fatura|pagamento recebido|pag fatura/i;

export function hashLote(conteudo: string): string {
  return createHash("sha256").update(conteudo).digest("hex").slice(0, 16);
}

export interface RelatorioImportacao {
  lidos: number;
  criados: number;
  mesclados: number;
  ja_processados: number;
  pendentes: number;
  /** Itens que exigiram revisão por alerta de leitura (não por falta de classificação). */
  alertas: { descricao: string; data_local: string; motivo: string }[];
}

export function importarItens(db: Db, itens: ItemImportado[], ctx: ContextoImportacao): RelatorioImportacao {
  const rel: RelatorioImportacao = { lidos: itens.length, criados: 0, mesclados: 0, ja_processados: 0, pendentes: 0, alertas: [] };
  const contador = new Map<string, number>();
  for (const it of itens) {
    const ehSaida = ctx.positivoEhDespesa ? it.valor_centavos > 0 : it.valor_centavos < 0;
    const abs = Math.abs(it.valor_centavos);
    if (abs === 0) continue;
    const ehPgtoFatura = RE_PGTO_FATURA.test(it.descricao);
    const tipo = ehPgtoFatura ? "transferencia" : ehSaida ? "despesa" : "receita";
    // Referencia estavel: FITID quando existe; senao lote + conteudo + ordinal (linhas identicas no mesmo arquivo continuam distintas).
    const chave = it.referencia ?? `${ctx.lote}:${it.data_local}:${it.descricao}:${it.valor_centavos}`;
    const ordinal = (contador.get(chave) ?? 0) + 1;
    contador.set(chave, ordinal);
    const referencia = it.referencia ? it.referencia : `${chave}#${ordinal}`;
    const alertaItem = it.alerta ?? ctx.forcarRevisao;
    const r = registrarLancamento(db, {
      usuario_id: ctx.usuario_id,
      tipo,
      valor_centavos: abs,
      descricao: it.descricao,
      forma_pagamento: ctx.cartao_id ? "credito" : null,
      cartao_id: ctx.cartao_id ?? null,
      conta_id: ctx.conta_id ?? null,
      parcela_atual: it.parcela_atual ?? null,
      parcela_total: it.parcela_total ?? null,
      data_local: it.data_local,
      hora_local: null,
      precisao_horario: "desconhecido", // extratos e faturas trazem apenas a data
      origem: ctx.origem,
      referencia,
      texto_bruto: it.descricao,
      alerta_revisao: alertaItem,
    });
    if (alertaItem && r.resultado === "criado") rel.alertas.push({ descricao: it.descricao, data_local: it.data_local, motivo: alertaItem });
    if (r.resultado === "criado") {
      rel.criados++;
      if (r.lancamento.status === "pendente") rel.pendentes++;
    } else if (r.resultado === "mesclado") rel.mesclados++;
    else rel.ja_processados++;
  }
  return rel;
}
