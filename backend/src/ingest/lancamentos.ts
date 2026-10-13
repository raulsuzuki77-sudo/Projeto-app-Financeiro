import { createHash } from "node:crypto";
import type { Db } from "../db/db.js";
import { LIMIAR_CONFIANCA, type Lancamento, type NovoLancamento, type Natureza, type Status } from "../domain/types.js";
import { aprenderRegra, classificar } from "../classification/classificador.js";
import { normalizar } from "../parsing/text.js";
import { paraInstanteUTC, somarDias } from "../parsing/tempo.js";

export type ResultadoRegistro =
  | { resultado: "criado"; lancamento: Lancamento }
  | { resultado: "ja_processado"; lancamento_id: number }
  | { resultado: "mesclado"; lancamento: Lancamento };

function agoraISO(): string {
  return new Date().toISOString();
}

function hashDedup(n: NovoLancamento, descNorm: string): string {
  return createHash("sha256")
    .update([n.usuario_id, n.tipo, n.valor_centavos, n.data_local, n.cartao_id ?? n.conta_id ?? 0, descNorm, n.parcela_atual ?? 0].join("|"))
    .digest("hex");
}

function tokens(s: string): Set<string> {
  return new Set(s.split(" ").filter((t) => t.length > 2));
}

function similaridade(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const t of A) if (B.has(t)) i++;
  return i / (A.size + B.size - i);
}

export function obterLancamento(db: Db, id: number): Lancamento | undefined {
  return db.prepare("SELECT * FROM lancamento WHERE id = ?").get(id) as Lancamento | undefined;
}

/**
 * Registra um lançamento vindo de qualquer origem.
 * - Idempotente por (origem, referencia): reenvio do mesmo wamid/FITID não duplica.
 * - Mesmo gasto vindo de outra origem (mesmo valor, data próxima e estabelecimento semelhante) é mesclado:
 *   a origem é adicionada ao lançamento existente, sem criar novo.
 * - Mesmo valor em data próxima mas descrição dessemelhante (ex.: "mercado" digitado x "ASSAI ATACADISTA" da fatura)
 *   é criado como pendente e sinalizado como possível duplicado: nunca mesclado automaticamente.
 */
export function registrarLancamento(db: Db, n: NovoLancamento): ResultadoRegistro {
  const existente = db
    .prepare("SELECT lancamento_id FROM lancamento_origem WHERE origem = ? AND referencia = ?")
    .get(n.origem, n.referencia) as { lancamento_id: number } | undefined;
  if (existente) return { resultado: "ja_processado", lancamento_id: existente.lancamento_id };

  const descNorm = normalizar(n.descricao);
  const hash = hashDedup(n, descNorm);
  const agora = agoraISO();

  const gravarOrigem = (id: number) =>
    db
      .prepare("INSERT INTO lancamento_origem (lancamento_id, origem, referencia, texto_bruto, criado_em) VALUES (?, ?, ?, ?, ?)")
      .run(id, n.origem, n.referencia, n.texto_bruto ?? null, agora);

  const tx = db.transaction((): ResultadoRegistro => {
    const igual = db
      .prepare("SELECT id FROM lancamento WHERE usuario_id = ? AND hash_dedup = ? AND status != 'cancelado'")
      .get(n.usuario_id, hash) as { id: number } | undefined;
    if (igual) {
      gravarOrigem(igual.id);
      return { resultado: "mesclado", lancamento: obterLancamento(db, igual.id)! };
    }

    const candidatos = db
      .prepare(
        `SELECT * FROM lancamento
         WHERE usuario_id = ? AND tipo = ? AND valor_centavos = ? AND status != 'cancelado'
           AND data_local BETWEEN ? AND ?`,
      )
      .all(n.usuario_id, n.tipo, n.valor_centavos, somarDias(n.data_local, -3), somarDias(n.data_local, 3)) as Lancamento[];
    const parecido = candidatos.find((c) => similaridade(c.estabelecimento_norm, descNorm) >= 0.5);
    if (parecido) {
      gravarOrigem(parecido.id);
      return { resultado: "mesclado", lancamento: parecido };
    }

    const cls = classificar(db, n.usuario_id, n.descricao, n.tipo);
    const natureza: Natureza = n.parcela_total && n.parcela_total > 1 && cls.natureza === "eventual" ? "parcelado" : cls.natureza;
    const status: Status = cls.confianca >= LIMIAR_CONFIANCA && candidatos.length === 0 && !n.alerta_revisao ? "confirmado" : "pendente";
    const info = db
      .prepare(
        `INSERT INTO lancamento (usuario_id, tipo, valor_centavos, descricao, estabelecimento_norm, categoria, natureza,
           forma_pagamento, cartao_id, conta_id, parcela_atual, parcela_total, ocorrido_em, data_local, hora_local,
           precisao_horario, status, confianca, hash_dedup, possivel_duplicado_de, criado_em, atualizado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        n.usuario_id, n.tipo, n.valor_centavos, n.descricao, descNorm, cls.categoria, natureza,
        n.forma_pagamento ?? null, n.cartao_id ?? null, n.conta_id ?? null, n.parcela_atual ?? null, n.parcela_total ?? null,
        paraInstanteUTC(n.data_local, n.hora_local ?? null), n.data_local, n.hora_local ?? null,
        n.precisao_horario, status, cls.confianca, hash, candidatos[0]?.id ?? null, agora, agora,
      );
    const id = Number(info.lastInsertRowid);
    gravarOrigem(id);
    return { resultado: "criado", lancamento: obterLancamento(db, id)! };
  });
  return tx();
}

export interface Alteracao {
  categoria?: string;
  natureza?: Natureza;
  status?: Status;
}

/** Edita campos permitidos, grava auditoria e aprende regra quando a categoria é corrigida. */
export function alterarLancamento(db: Db, id: number, usuarioId: string, alt: Alteracao): Lancamento {
  const atual = obterLancamento(db, id);
  if (!atual || atual.usuario_id !== usuarioId) throw new Error("Lancamento nao encontrado");
  const agora = agoraISO();
  const tx = db.transaction(() => {
    for (const campo of ["categoria", "natureza", "status"] as const) {
      const novo = alt[campo];
      if (novo !== undefined && novo !== atual[campo]) {
        db.prepare(`UPDATE lancamento SET ${campo} = ?, atualizado_em = ? WHERE id = ?`).run(novo, agora, id);
        db.prepare("INSERT INTO auditoria (lancamento_id, campo, valor_antigo, valor_novo, quando) VALUES (?,?,?,?,?)").run(
          id, campo, String(atual[campo]), String(novo), agora,
        );
      }
    }
    if (alt.categoria || alt.natureza) {
      aprenderRegra(db, usuarioId, atual.estabelecimento_norm, alt.categoria ?? atual.categoria, alt.natureza ?? atual.natureza);
      if (atual.status === "pendente" && !alt.status) {
        db.prepare("UPDATE lancamento SET status = 'confirmado', confianca = 1, atualizado_em = ? WHERE id = ?").run(agora, id);
      }
    }
  });
  tx();
  return obterLancamento(db, id)!;
}
