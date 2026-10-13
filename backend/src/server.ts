import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import {
  NATUREZAS, alterarLancamento, atualizarMeta, calendarioMensal, capacidadePoupanca, cenariosDaMeta, criarMeta, hashLote,
  importarComprovante, importarFatura, importarTexto, lerPremissas, listarLancamentos, listarMetas, mapaCalor,
  processarMensagem, removerMeta, reservaDeEmergencia, resumoMensal, salvarPremissa,
  type Natureza, type Status,
} from "../../core/src/index";
import { abrirBanco, type Db } from "./db/db";
import { detectarTipo, ocrArquivo, ocrDisponivel } from "./ocr/tesseract";
import { assinaturaValida, extrairMensagensTexto } from "./whatsapp/webhook";

export interface Config {
  apiToken: string;
  usuarioId: string;
  whatsappVerifyToken?: string;
  whatsappAppSecret?: string;
  /** Número (formato da Cloud API) autorizado a lançar. Mensagens de outros números são descartadas. */
  whatsappNumeroAutorizado?: string;
  /** Envio de resposta ao usuário (a implementação real da Cloud API entra com as credenciais). */
  responder?: (para: string, texto: string) => Promise<void>;
}

let filaOcr: Promise<unknown> = Promise.resolve();
/** Um OCR por vez: evita esgotar CPU/memória com uploads simultâneos. */
function naFila<T>(f: () => Promise<T>): Promise<T> {
  const p = filaOcr.then(f, f);
  filaOcr = p.catch(() => undefined);
  return p;
}

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function tokenIgual(a: string, b: string): boolean {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export function criarServidor(db: Db, cfg: Config): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 15 * 1024 * 1024 });

  // Corpo bruto preservado para validar a assinatura do webhook.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { corpoBruto: string }).corpoBruto = body as string;
    try { done(null, body ? JSON.parse(body as string) : {}); } catch (e) { done(e as Error); }
  });
  for (const ct of ["application/pdf", "image/png", "image/jpeg"]) {
    app.addContentTypeParser(ct, { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  }
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.get("/health", async () => ({ ok: true }));

  // --- Webhook WhatsApp (autenticado por assinatura, não por token de API) ---
  app.get("/webhooks/whatsapp", async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (cfg.whatsappVerifyToken && q["hub.mode"] === "subscribe" && q["hub.verify_token"] && tokenIgual(q["hub.verify_token"], cfg.whatsappVerifyToken)) {
      return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    }
    return reply.code(403).send({ erro: "verificacao recusada" });
  });

  app.post("/webhooks/whatsapp", async (req, reply) => {
    if (!cfg.whatsappAppSecret) return reply.code(503).send({ erro: "webhook nao configurado" });
    const bruto = (req as unknown as { corpoBruto?: string }).corpoBruto ?? "";
    if (!assinaturaValida(bruto, req.headers["x-hub-signature-256"] as string | undefined, cfg.whatsappAppSecret)) {
      return reply.code(401).send({ erro: "assinatura invalida" });
    }
    const { mensagens, ignoradas } = extrairMensagensTexto(req.body);
    // Responde 200 logo; o processamento aqui e sincrono e curto (SQLite local). Com fila (Fase 3) passa a assincrono.
    for (const m of mensagens) {
      if (cfg.whatsappNumeroAutorizado && m.de !== cfg.whatsappNumeroAutorizado) continue;
      const resposta = processarMensagem(db, { id: m.id, usuario_id: cfg.usuarioId, texto: m.texto, recebida_em: m.recebida_em, origem: "whatsapp" });
      if (resposta && cfg.responder) await cfg.responder(m.de, resposta).catch(() => undefined);
    }
    return { ok: true, processadas: mensagens.length, ignoradas };
  });

  // --- API autenticada por token ---
  app.register(async (api) => {
    api.addHook("onRequest", async (req, reply) => {
      const h = req.headers.authorization ?? "";
      if (!h.startsWith("Bearer ") || !tokenIgual(h.slice(7), cfg.apiToken)) return reply.code(401).send({ erro: "nao autorizado" });
    });

    api.post("/api/mensagens", async (req, reply) => {
      const b = req.body as { id?: string; texto?: string } | null;
      if (!b?.texto || typeof b.texto !== "string") return reply.code(400).send({ erro: "texto obrigatorio" });
      const id = b.id ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return { resposta: processarMensagem(db, { id, usuario_id: cfg.usuarioId, texto: b.texto, recebida_em: new Date(), origem: "texto_manual" }) };
    });

    api.get("/api/lancamentos", async (req, reply) => {
      const q = req.query as { mes?: string; status?: string };
      if (q.mes && !MES.test(q.mes)) return reply.code(400).send({ erro: "mes deve ser AAAA-MM" });
      return listarLancamentos(db, cfg.usuarioId, q);
    });

    api.patch("/api/lancamentos/:id", async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const b = (req.body ?? {}) as { categoria?: string; natureza?: string; status?: string };
      if (b.natureza && !(NATUREZAS as readonly string[]).includes(b.natureza)) return reply.code(400).send({ erro: "natureza invalida" });
      if (b.status && !["pendente", "confirmado", "cancelado"].includes(b.status)) return reply.code(400).send({ erro: "status invalido" });
      try {
        return alterarLancamento(db, id, cfg.usuarioId, { categoria: b.categoria, natureza: b.natureza as Natureza | undefined, status: b.status as Status | undefined });
      } catch {
        return reply.code(404).send({ erro: "lancamento nao encontrado" });
      }
    });

    api.post("/api/importacoes/:formato", async (req, reply) => {
      const { formato } = req.params as { formato: string };
      const q = req.query as { cartao_id?: string; conta_id?: string };
      const corpo = typeof req.body === "string" ? req.body : "";
      if (!corpo) return reply.code(400).send({ erro: "envie o conteudo do arquivo como text/plain" });
      if (formato !== "ofx" && formato !== "csv" && formato !== "fatura-texto") return reply.code(404).send({ erro: "formato desconhecido (ofx, csv, fatura-texto)" });
      const r = importarTexto(db, formato, corpo, { usuario_id: cfg.usuarioId, cartao_id: q.cartao_id ? Number(q.cartao_id) : null, conta_id: q.conta_id ? Number(q.conta_id) : null });
      return r.ok ? { ...r.relatorio, rejeitadas: r.rejeitadas ?? [], nao_lidas: r.nao_lidas ?? [], conciliacao: r.conciliacao ?? null } : reply.code(422).send({ erro: r.erro });
    });

    // Arquivo (PDF/foto) -> OCR -> lançamentos. tipo=fatura (PDF/imagem de fatura) | comprovante (foto de cupom/PIX).
    api.post("/api/importacoes-arquivo", async (req, reply) => {
      const q = req.query as { tipo?: string; cartao_id?: string; conta_id?: string };
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) return reply.code(400).send({ erro: "envie o arquivo (application/pdf, image/png ou image/jpeg)" });
      const tipoArq = detectarTipo(buf);
      if (!tipoArq) return reply.code(415).send({ erro: "formato nao reconhecido (use PDF, PNG ou JPEG)" });
      if (!(await ocrDisponivel())) return reply.code(503).send({ erro: "OCR indisponivel (instale tesseract-ocr com idioma por e poppler-utils)" });
      if (q.tipo !== "fatura" && q.tipo !== "comprovante") return reply.code(400).send({ erro: "tipo deve ser fatura ou comprovante" });
      const cartao_id = q.cartao_id ? Number(q.cartao_id) : null;
      let linhas;
      try {
        linhas = await naFila(() => ocrArquivo(buf, tipoArq));
      } catch {
        return reply.code(422).send({ erro: "falha ao ler o arquivo (corrompido ou ilegivel)" });
      }
      const lote = hashLote(buf.toString("base64"));
      const ctx = { usuario_id: cfg.usuarioId, cartao_id, conta_id: q.conta_id ? Number(q.conta_id) : null };
      if (q.tipo === "fatura") {
        const r = importarFatura(db, linhas, lote, ctx);
        return r.ok ? { ...r.relatorio, conciliacao: r.conciliacao, nao_lidas: r.nao_lidas } : reply.code(422).send({ erro: r.erro, nao_lidas: r.nao_lidas });
      }
      const c = importarComprovante(db, linhas.map((l) => l.texto), lote, ctx);
      return c.ok ? { resultado: c.resultado, dados_lidos: c.dados_lidos, alerta: c.alerta } : reply.code(422).send({ erro: c.erro });
    });

    // --- Metas e cenarios (simulacao educacional) ---
    const erro400 = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) => reply.code(400).send({ erro: e instanceof Error ? e.message : "requisicao invalida" });
    api.get("/api/premissas", async () => lerPremissas(db, cfg.usuarioId));
    api.put("/api/premissas", async (req, reply) => {
      try {
        salvarPremissa(db, cfg.usuarioId, (req.body ?? {}) as { chave: string; retorno_nominal_aa: number; ir_modo?: string; ir_aliquota?: number | null });
        return lerPremissas(db, cfg.usuarioId);
      } catch (e) { return erro400(reply, e); }
    });
    api.get("/api/metas", async () => listarMetas(db, cfg.usuarioId));
    api.post("/api/metas", async (req, reply) => {
      try {
        const b = (req.body ?? {}) as Parameters<typeof criarMeta>[2];
        const id = criarMeta(db, cfg.usuarioId, { nome: String(b.nome ?? ""), tipo: b.tipo, valor_alvo_centavos: b.valor_alvo_centavos, aporte_inicial_centavos: b.aporte_inicial_centavos ?? 0, prazo_meses: b.prazo_meses, perfil: b.perfil ?? "moderado" });
        return reply.code(201).send({ id });
      } catch (e) { return erro400(reply, e); }
    });
    api.patch("/api/metas/:id", async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      try {
        return atualizarMeta(db, cfg.usuarioId, id, (req.body ?? {}) as Parameters<typeof atualizarMeta>[3]);
      } catch (e) {
        return e instanceof Error && e.message === "meta nao encontrada" ? reply.code(404).send({ erro: e.message }) : erro400(reply, e);
      }
    });
    api.delete("/api/metas/:id", async (req, reply) => {
      return removerMeta(db, cfg.usuarioId, Number((req.params as { id: string }).id)) ? { ok: true } : reply.code(404).send({ erro: "meta nao encontrada" });
    });
    api.get("/api/metas/:id/cenarios", async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const meta = listarMetas(db, cfg.usuarioId).find((m) => m.id === id);
      if (!meta) return reply.code(404).send({ erro: "meta nao encontrada" });
      const q = (req.query as { aporte_mensal_centavos?: string }).aporte_mensal_centavos;
      const aporte = q === undefined ? undefined : Number(q);
      if (aporte !== undefined && (!Number.isInteger(aporte) || aporte < 0)) return reply.code(400).send({ erro: "aporte_mensal_centavos invalido" });
      return cenariosDaMeta(db, cfg.usuarioId, meta, aporte);
    });
    api.get("/api/reserva-emergencia", async (req, reply) => {
      try { return reservaDeEmergencia(db, cfg.usuarioId, Number((req.query as { meses?: string }).meses ?? 6)); } catch (e) { return erro400(reply, e); }
    });
    api.get("/api/capacidade-poupanca", async () => capacidadePoupanca(db, cfg.usuarioId));

    api.get("/api/dashboard/resumo", async (req, reply) => {
      const mes = (req.query as { mes?: string }).mes;
      if (!mes || !MES.test(mes)) return reply.code(400).send({ erro: "mes deve ser AAAA-MM" });
      return resumoMensal(db, cfg.usuarioId, mes);
    });
    api.get("/api/dashboard/mapa-calor", async (req, reply) => {
      const q = req.query as { de?: string; ate?: string; exato?: string };
      if (!q.de || !q.ate || !DATA.test(q.de) || !DATA.test(q.ate)) return reply.code(400).send({ erro: "de e ate devem ser AAAA-MM-DD" });
      return mapaCalor(db, cfg.usuarioId, q.de, q.ate, q.exato !== "1");
    });
    api.get("/api/dashboard/calendario", async (req, reply) => {
      const mes = (req.query as { mes?: string }).mes;
      if (!mes || !MES.test(mes)) return reply.code(400).send({ erro: "mes deve ser AAAA-MM" });
      return calendarioMensal(db, cfg.usuarioId, mes);
    });
  });

  return app;
}

// Execução direta: tsx src/server.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const apiToken = process.env.API_TOKEN;
  if (!apiToken || apiToken.length < 24) {
    console.error("Defina API_TOKEN com pelo menos 24 caracteres (ex.: openssl rand -hex 24).");
    process.exit(1);
  }
  const db = abrirBanco(process.env.DB_PATH ?? "./dados.db");
  const app = criarServidor(db, {
    apiToken,
    usuarioId: process.env.USUARIO_ID ?? "local",
    whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    whatsappAppSecret: process.env.WHATSAPP_APP_SECRET,
    whatsappNumeroAutorizado: process.env.WHATSAPP_NUMERO_AUTORIZADO,
  });
  app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? "127.0.0.1" }).then((a) => console.log(`Ouvindo em ${a}`));
}
