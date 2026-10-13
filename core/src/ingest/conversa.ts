import type { Db } from "../db/tipos";
import type { Lancamento } from "../domain/types";
import { interpretarMensagem } from "../parsing/mensagem";
import { formatarBRL, normalizar } from "../parsing/text";
import { paraLocal } from "../parsing/tempo";
import { alterarLancamento, registrarLancamento } from "./lancamentos";
import { resumoMensal } from "../dashboard/consultas";

export interface MensagemRecebida {
  /** Identificador único do canal (ex.: wamid do WhatsApp). Garante idempotência. */
  id: string;
  usuario_id: string;
  texto: string;
  recebida_em: Date;
  origem?: "whatsapp" | "texto_manual";
}

function descreve(l: Lancamento): string {
  const parc = l.parcela_total ? ` em ${l.parcela_total}x` : "";
  return `${l.descricao} ${formatarBRL(l.valor_centavos)}${parc} [${l.categoria}/${l.natureza}] em ${l.data_local}`;
}

function ultimoLancamento(db: Db, usuarioId: string): Lancamento | undefined {
  return db
    .prepare("SELECT * FROM lancamento WHERE usuario_id = ? AND status != 'cancelado' ORDER BY id DESC LIMIT 1")
    .get(usuarioId) as Lancamento | undefined;
}

/**
 * Processa uma mensagem do usuário e devolve o texto de resposta.
 * Comandos: /desfazer, /resumo, "sim" (confirma o último pendente), "categoria <nome>" (corrige o último).
 */
export function processarMensagem(db: Db, m: MensagemRecebida): string {
  const ja = db.prepare("SELECT 1 FROM mensagem_processada WHERE id = ?").get(m.id);
  if (ja) return ""; // reenvio do canal: ignora silenciosamente
  db.prepare("INSERT INTO mensagem_processada (id, processada_em) VALUES (?, ?)").run(m.id, new Date().toISOString());

  const n = normalizar(m.texto);

  if (n === "desfazer") {
    const u = ultimoLancamento(db, m.usuario_id);
    if (!u) return "Nao ha lancamento para desfazer.";
    alterarLancamento(db, u.id, m.usuario_id, { status: "cancelado" });
    return `Desfeito: ${descreve(u)}`;
  }
  if (n === "resumo") {
    const mes = paraLocal(m.recebida_em).data_local.slice(0, 7);
    const r = resumoMensal(db, m.usuario_id, mes);
    return `Resumo ${mes}: despesas ${formatarBRL(r.despesas_centavos)}, receitas ${formatarBRL(r.receitas_centavos)}, investimentos ${formatarBRL(r.investimentos_centavos)}. Pendentes de revisao: ${r.pendentes}.`;
  }
  if (n === "sim" || n === "ok" || n === "confirmar") {
    const u = ultimoLancamento(db, m.usuario_id);
    if (!u || u.status !== "pendente") return "Nao ha lancamento pendente.";
    alterarLancamento(db, u.id, m.usuario_id, { status: "confirmado" });
    return `Confirmado: ${descreve(u)}`;
  }
  const mCat = n.match(/^(?:categoria|cat)\s+([a-z0-9_ ]+)$/);
  if (mCat) {
    const u = ultimoLancamento(db, m.usuario_id);
    if (!u) return "Nao ha lancamento para corrigir.";
    const nova = alterarLancamento(db, u.id, m.usuario_id, { categoria: mCat[1]!.trim().replace(/\s+/g, "_") });
    return `Categoria atualizada (e aprendida para proximos lancamentos): ${descreve(nova)}`;
  }

  const cartoes = (db.prepare("SELECT apelido_norm FROM cartao WHERE usuario_id = ?").all(m.usuario_id) as { apelido_norm: string }[]).map((c) => c.apelido_norm);
  const r = interpretarMensagem(m.texto, m.recebida_em, cartoes);
  if (!r.ok) return `Nao registrei: ${r.motivo} Exemplo: "mercado 187,40 credito nubank".`;

  const l = r.lancamento;
  const cartao = l.cartao_apelido_norm
    ? (db.prepare("SELECT id FROM cartao WHERE usuario_id = ? AND apelido_norm = ?").get(m.usuario_id, l.cartao_apelido_norm) as { id: number } | undefined)
    : undefined;
  const reg = registrarLancamento(db, {
    usuario_id: m.usuario_id,
    tipo: l.tipo,
    valor_centavos: l.valor_centavos,
    descricao: l.descricao,
    forma_pagamento: l.forma_pagamento,
    cartao_id: cartao?.id ?? null,
    parcela_total: l.parcela_total,
    data_local: l.data_local,
    hora_local: l.hora_local,
    precisao_horario: l.precisao_horario,
    origem: m.origem ?? "whatsapp",
    referencia: m.id,
    texto_bruto: m.texto,
  });
  if (reg.resultado === "ja_processado") return "";
  if (reg.resultado === "mesclado") return `Ja existia um lancamento equivalente; a origem foi vinculada: ${descreve(reg.lancamento)}`;
  const novo = reg.lancamento;
  if (novo.status === "confirmado") return `Registrado: ${descreve(novo)}. Responda /desfazer para cancelar.`;
  const dup = novo.possivel_duplicado_de ? ` Atencao: valor igual ao lancamento #${novo.possivel_duplicado_de} em data proxima.` : "";
  return `Registrado como PENDENTE: ${descreve(novo)}.${dup} Responda "sim" para confirmar ou "categoria <nome>" para corrigir.`;
}
