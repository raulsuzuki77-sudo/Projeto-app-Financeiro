import type { Db } from "../db/tipos";
import { registrarLancamento } from "../ingest/lancamentos";
import { paraLocal } from "../parsing/tempo";
import { lerComprovante, type ComprovanteLido } from "./comprovante";
import { lerCsv } from "./csv";
import { hashLote, importarItens, type RelatorioImportacao } from "./comum";
import { lerFaturaLinhas, type Conciliacao } from "./fatura-texto";
import { lerOfx } from "./ofx";

export interface ContextoImportacaoArquivo {
  usuario_id: string;
  cartao_id?: number | null;
  conta_id?: number | null;
  agora?: Date;
}

export type ResultadoImportacaoFatura =
  | { ok: true; relatorio: RelatorioImportacao; conciliacao: Conciliacao | null; nao_lidas: string[] }
  | { ok: false; erro: string; nao_lidas: string[] };

/**
 * Importa uma fatura de cartao a partir de linhas (OCR de PDF/foto ou texto).
 * Se a soma dos itens nao fecha com o total declarado, TODO o lote entra como pendente.
 * `identificador` deve ser estavel para o mesmo arquivo (ex.: hash do conteudo) para a reimportacao ser idempotente.
 */
export function importarFatura(db: Db, linhas: { texto: string; confianca?: number }[], identificador: string, ctx: ContextoImportacaoArquivo, origem: "pdf" | "fatura_texto" = "pdf"): ResultadoImportacaoFatura {
  const r = lerFaturaLinhas(linhas);
  if (r.itens.length === 0) return { ok: false, erro: "nenhum item de fatura reconhecido", nao_lidas: r.nao_lidas };
  const divergente = r.conciliacao !== null && !r.conciliacao.fecha;
  const relatorio = importarItens(db, r.itens, {
    usuario_id: ctx.usuario_id,
    origem,
    lote: identificador,
    cartao_id: ctx.cartao_id ?? null,
    conta_id: ctx.conta_id ?? null,
    positivoEhDespesa: true,
    forcarRevisao: divergente ? "soma dos itens nao fecha com o total da fatura" : undefined,
  });
  return { ok: true, relatorio, conciliacao: r.conciliacao, nao_lidas: r.nao_lidas };
}

export type ResultadoImportacaoComprovante =
  | { ok: true; resultado: "criado" | "mesclado" | "ja_processado"; dados_lidos: ComprovanteLido; alerta: string }
  | { ok: false; erro: string };

/** Importa um comprovante (cupom/NFC-e ou PIX). Dados vindos de imagem sempre exigem confirmacao do usuario. */
export function importarComprovante(db: Db, linhas: string[], identificador: string, ctx: ContextoImportacaoArquivo): ResultadoImportacaoComprovante {
  const c = lerComprovante(linhas);
  if (!c.ok) return { ok: false, erro: c.motivo };
  const d = c.dados;
  const alerta = ["foto: confirme os dados lidos", d.cnpj_valido === false ? "CNPJ com digito verificador invalido (possivel erro de leitura)" : "", ...d.inconsistencias].filter(Boolean).join("; ");
  const hoje = paraLocal(ctx.agora ?? new Date()).data_local;
  const reg = registrarLancamento(db, {
    usuario_id: ctx.usuario_id,
    tipo: "despesa",
    valor_centavos: d.valor_centavos,
    descricao: d.estabelecimento,
    forma_pagamento: d.forma_pagamento,
    cartao_id: ctx.cartao_id ?? null,
    data_local: d.data_local ?? hoje,
    hora_local: d.hora_local,
    precisao_horario: d.hora_local !== null ? "exato" : "desconhecido",
    origem: "foto",
    referencia: d.id_transacao ? `pix:${d.id_transacao}` : identificador,
    alerta_revisao: alerta,
  });
  return { ok: true, resultado: reg.resultado, dados_lidos: d, alerta };
}

export type FormatoTexto = "ofx" | "csv" | "fatura-texto";

export type ResultadoTexto =
  | { ok: true; relatorio: RelatorioImportacao; rejeitadas?: { linha: number; motivo: string }[]; nao_lidas?: string[]; conciliacao?: Conciliacao | null }
  | { ok: false; erro: string };

/** Importa arquivo de texto: OFX, CSV com cabecalho ou texto de fatura. */
export function importarTexto(db: Db, formato: FormatoTexto, conteudo: string, ctx: ContextoImportacaoArquivo): ResultadoTexto {
  const lote = hashLote(conteudo);
  const base = { usuario_id: ctx.usuario_id, lote, cartao_id: ctx.cartao_id ?? null, conta_id: ctx.conta_id ?? null };
  if (formato === "ofx") {
    const itens = lerOfx(conteudo);
    if (itens.length === 0) return { ok: false, erro: "nenhuma transacao encontrada no OFX" };
    return { ok: true, relatorio: importarItens(db, itens, { ...base, origem: "ofx", positivoEhDespesa: false }) };
  }
  if (formato === "csv") {
    const { itens, rejeitadas } = lerCsv(conteudo);
    if (itens.length === 0) return { ok: false, erro: rejeitadas[0]?.motivo ?? "nenhuma linha valida no CSV" };
    return { ok: true, relatorio: importarItens(db, itens, { ...base, origem: "csv" }), rejeitadas };
  }
  const r = importarFatura(db, conteudo.split(/\r?\n/).map((t) => ({ texto: t })), lote, ctx, "fatura_texto");
  return r.ok ? { ok: true, relatorio: r.relatorio, nao_lidas: r.nao_lidas, conciliacao: r.conciliacao } : { ok: false, erro: r.erro };
}
