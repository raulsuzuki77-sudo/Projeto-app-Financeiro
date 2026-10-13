import { createHmac, timingSafeEqual } from "node:crypto";

export interface MensagemTextoWhatsApp {
  id: string; // wamid
  de: string;
  texto: string;
  recebida_em: Date;
}

/** Valida X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o app secret). */
export function assinaturaValida(corpoBruto: string | Buffer, cabecalho: string | undefined, appSecret: string): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = createHmac("sha256", appSecret).update(corpoBruto).digest();
  let recebido: Buffer;
  try {
    recebido = Buffer.from(cabecalho.slice(7), "hex");
  } catch {
    return false;
  }
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

/**
 * Extrai mensagens de texto do payload da Cloud API (entry[].changes[].value.messages[]).
 * Mídias (imagem/documento) serão tratadas na Fase 2; aqui são ignoradas explicitamente.
 * Formato do payload a confirmar na documentação oficial da Meta.
 */
export function extrairMensagensTexto(payload: unknown): { mensagens: MensagemTextoWhatsApp[]; ignoradas: number } {
  const mensagens: MensagemTextoWhatsApp[] = [];
  let ignoradas = 0;
  const entradas = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entradas)) return { mensagens, ignoradas };
  for (const e of entradas) {
    const changes = (e as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const msgs = (c as { value?: { messages?: unknown[] } }).value?.messages;
      if (!Array.isArray(msgs)) continue;
      for (const m of msgs as { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string } }[]) {
        if (m.type === "text" && m.id && m.from && m.text?.body && m.timestamp) {
          mensagens.push({ id: m.id, de: m.from, texto: m.text.body, recebida_em: new Date(Number(m.timestamp) * 1000) });
        } else ignoradas++;
      }
    }
  }
  return { mensagens, ignoradas };
}
