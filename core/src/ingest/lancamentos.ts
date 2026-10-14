import type { Db } from "../db/tipos";
import { sha256Hex } from "../util/sha256";
import { FORMAS_PAGAMENTO, LIMIAR_CONFIANCA, NATUREZAS, TIPOS, type FormaPagamento, type Lancamento, type NovoLancamento, type Natureza, type Status, type Tipo } from "../domain/types";
import { aprenderRegra, chaveEstabelecimento, classificar, naturezaPara, tipoAposReclassificar, tipoCoerente, type Classificacao } from "../classification/classificador";
import { naturezaPadraoDaCategoria } from "../classification/categorias";
import { normalizar } from "../parsing/text";
import { dataValida, paraInstanteUTC, somarDias } from "../parsing/tempo";
import { elegivelParaEvento, eventoDaData } from "../eventos/eventos";
import { mesmoCompromisso } from "../recorrencias/casamento";

export type ResultadoRegistro =
  | { resultado: "criado"; lancamento: Lancamento }
  | { resultado: "ja_processado"; lancamento_id: number }
  | { resultado: "mesclado"; lancamento: Lancamento };

function agoraISO(): string {
  return new Date().toISOString();
}

function hashDe(usuario: string, tipo: string, valor: number, data: string, ref: number, descNorm: string, parcela: number): string {
  return sha256Hex([usuario, tipo, valor, data, ref, descNorm, parcela].join("|"));
}

function hashDedup(n: NovoLancamento, descNorm: string): string {
  return hashDe(n.usuario_id, n.tipo, n.valor_centavos, n.data_local, n.cartao_id ?? n.conta_id ?? 0, descNorm, n.parcela_atual ?? 0);
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

function motivoRevisao(n: NovoLancamento, confianca: number, temCandidato: boolean): string {
  const m: string[] = [];
  if (n.alerta_revisao) m.push(n.alerta_revisao);
  if (temCandidato) m.push("valor igual a outro lançamento em data próxima (possível duplicidade)");
  if (confianca < LIMIAR_CONFIANCA) m.push("categoria não reconhecida com segurança");
  return m.join("; ");
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
export function registrarLancamento(db: Db, n: NovoLancamento, opcoes: { ignorarIds?: ReadonlySet<number> } = {}): ResultadoRegistro {
  const ign = opcoes.ignorarIds;
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
    // Itens do mesmo arquivo (`ignorarIds`) nunca se mesclam entre si: duas compras identicas no mesmo dia sao dois lancamentos.
    const igual = (db
      .prepare("SELECT id FROM lancamento WHERE usuario_id = ? AND hash_dedup = ? AND status != 'cancelado'")
      .all(n.usuario_id, hash) as { id: number }[]).find((r) => !ign?.has(r.id));
    if (igual) {
      gravarOrigem(igual.id);
      return { resultado: "mesclado", lancamento: obterLancamento(db, igual.id)! };
    }

    // Compromisso previsto por recorrencia (ainda sem origem real): o lancamento real o substitui, contando uma unica vez.
    if (n.origem !== "recorrente") {
      const previstos = (db
        .prepare(
          `SELECT * FROM lancamento l WHERE l.usuario_id = ? AND l.tipo = ? AND l.status != 'cancelado' AND substr(l.data_local,1,7) = ?
             AND EXISTS (SELECT 1 FROM lancamento_origem o WHERE o.lancamento_id = l.id AND o.origem = 'recorrente')
             AND NOT EXISTS (SELECT 1 FROM lancamento_origem o2 WHERE o2.lancamento_id = l.id AND o2.origem != 'recorrente')`,
        )
        .all(n.usuario_id, n.tipo, n.data_local.slice(0, 7)) as Lancamento[]).filter((c) => !ign?.has(c.id));
      const previsto = previstos.find((c) => mesmoCompromisso(c, { estabelecimento_norm: descNorm, valor_centavos: n.valor_centavos }));
      if (previsto) {
        gravarOrigem(previsto.id);
        if (previsto.valor_centavos !== n.valor_centavos || previsto.data_local !== n.data_local) {
          db.prepare("UPDATE lancamento SET valor_centavos = ?, data_local = ?, ocorrido_em = ?, hash_dedup = ?, atualizado_em = ? WHERE id = ?").run(
            n.valor_centavos, n.data_local, paraInstanteUTC(n.data_local, n.hora_local ?? null), hashDe(n.usuario_id, previsto.tipo, n.valor_centavos, n.data_local, previsto.cartao_id ?? previsto.conta_id ?? 0, previsto.estabelecimento_norm, previsto.parcela_atual ?? 0), agora, previsto.id,
          );
        }
        return { resultado: "mesclado", lancamento: obterLancamento(db, previsto.id)! };
      }
    }

    const candidatos = (db
      .prepare(
        `SELECT * FROM lancamento
         WHERE usuario_id = ? AND tipo = ? AND valor_centavos = ? AND status != 'cancelado'
           AND data_local BETWEEN ? AND ?`,
      )
      .all(n.usuario_id, n.tipo, n.valor_centavos, somarDias(n.data_local, -3), somarDias(n.data_local, 3)) as Lancamento[]).filter((c) => !ign?.has(c.id));
    const parecido = candidatos.find((c) => similaridade(c.estabelecimento_norm, descNorm) >= 0.5);
    if (parecido) {
      gravarOrigem(parecido.id);
      return { resultado: "mesclado", lancamento: parecido };
    }

    const definida = n.categoria !== undefined;
    const cls: Classificacao = definida
      ? { categoria: n.categoria!, natureza: n.natureza ?? naturezaPadraoDaCategoria(n.categoria!) ?? "eventual", confianca: 1, fonte: "usuario" }
      : classificar(db, n.usuario_id, n.descricao, n.estorno ? "despesa" : n.tipo, { valor_centavos: n.valor_centavos, data_local: n.data_local });
    // Estorno entra como entrada que abate a despesa da propria categoria; os demais tem o tipo ajustado a natureza (transferencia, aporte).
    const natureza: Natureza = n.estorno ? "estorno" : n.parcela_total && n.parcela_total > 1 && cls.natureza === "eventual" ? "parcelado" : cls.natureza;
    const tipoFinal = n.estorno ? n.tipo : tipoCoerente(n.tipo, natureza);
    const status: Status = cls.confianca >= LIMIAR_CONFIANCA && (definida || candidatos.length === 0) && !n.alerta_revisao ? "confirmado" : "pendente";
    const info = db
      .prepare(
        `INSERT INTO lancamento (usuario_id, tipo, valor_centavos, descricao, estabelecimento_norm, categoria, natureza,
           forma_pagamento, cartao_id, conta_id, parcela_atual, parcela_total, ocorrido_em, data_local, hora_local,
           precisao_horario, status, confianca, hash_dedup, possivel_duplicado_de, motivo_revisao, evento_id, criado_em, atualizado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        n.usuario_id, tipoFinal, n.valor_centavos, n.descricao, descNorm, cls.categoria, natureza,
        n.forma_pagamento ?? null, n.cartao_id ?? null, n.conta_id ?? null, n.parcela_atual ?? null, n.parcela_total ?? null,
        paraInstanteUTC(n.data_local, n.hora_local ?? null), n.data_local, n.hora_local ?? null,
        n.precisao_horario, status, cls.confianca, hash, candidatos[0]?.id ?? null,
        status === "pendente" ? motivoRevisao(n, cls.confianca, candidatos.length > 0) : null,
        // Gasto dentro do periodo de um evento (viagem, ferias): vinculado desde a importacao
        elegivelParaEvento(tipoFinal, natureza) ? eventoDaData(db, n.usuario_id, n.data_local) : null, agora, agora,
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
export function alterarLancamento(db: Db, id: number, usuarioId: string, altOriginal: Alteracao): Lancamento {
  const atual = obterLancamento(db, id);
  if (!atual || atual.usuario_id !== usuarioId) throw new Error("Lançamento não encontrado");
  // Ao trocar só a categoria, a natureza acompanha a categoria (ex.: "Assinaturas" -> assinatura), salvo parcelado.
  const alt: Alteracao = { ...altOriginal };
  if (alt.categoria && alt.natureza === undefined) alt.natureza = naturezaPara(alt.categoria, atual.natureza);
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
    if (alt.status === "confirmado") db.prepare("UPDATE lancamento SET motivo_revisao = NULL WHERE id = ?").run(id);
    if (alt.categoria || alt.natureza) {
      const catFinal = alt.categoria ?? atual.categoria;
      const natFinal = alt.natureza ?? atual.natureza;
      const tipoNovo = natFinal === "estorno" ? atual.tipo : tipoAposReclassificar(atual.tipo, catFinal, natFinal);
      if (tipoNovo !== atual.tipo) {
        db.prepare("UPDATE lancamento SET tipo = ?, atualizado_em = ? WHERE id = ?").run(tipoNovo, agora, id);
        db.prepare("INSERT INTO auditoria (lancamento_id, campo, valor_antigo, valor_novo, quando) VALUES (?,?,?,?,?)").run(id, "tipo", atual.tipo, tipoNovo, agora);
      }
      // O estorno abate despesa, mas a regra aprendida vale para as compras futuras do estabelecimento: usa a natureza da categoria.
      aprenderRegra(db, usuarioId, atual.estabelecimento_norm, catFinal, natFinal === "estorno" ? naturezaPadraoDaCategoria(catFinal) ?? "eventual" : natFinal);
      if (atual.status === "pendente" && !alt.status) {
        db.prepare("UPDATE lancamento SET status = 'confirmado', confianca = 1, motivo_revisao = NULL, atualizado_em = ? WHERE id = ?").run(agora, id);
      }
    }
  });
  tx();
  return obterLancamento(db, id)!;
}


export interface EdicaoCompleta {
  descricao?: string;
  valor_centavos?: number;
  data_local?: string;
  /** null remove o horário (fica "desconhecido"). */
  hora_local?: number | null;
  tipo?: Tipo;
  categoria?: string;
  natureza?: Natureza;
  forma_pagamento?: FormaPagamento | null;
  cartao_id?: number | null;
}

/**
 * Edição completa de um lançamento pelo usuário. Valida cada campo, recalcula a chave de duplicidade,
 * registra auditoria campo a campo e deixa o lançamento confirmado (quem edita está revisando).
 */
export function editarLancamento(db: Db, id: number, usuarioId: string, e: EdicaoCompleta): Lancamento {
  const atual = obterLancamento(db, id);
  if (!atual || atual.usuario_id !== usuarioId) throw new Error("Lançamento não encontrado");
  if (e.descricao !== undefined && (!e.descricao.trim() || e.descricao.trim().length > 120)) throw new Error("A descrição deve ter de 1 a 120 caracteres.");
  if (e.valor_centavos !== undefined && (!Number.isInteger(e.valor_centavos) || e.valor_centavos <= 0)) throw new Error("O valor deve ser maior que zero.");
  if (e.data_local !== undefined) {
    const m = e.data_local.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m || !dataValida(+m[1]!, +m[2]!, +m[3]!)) throw new Error("Data inválida.");
  }
  if (e.hora_local != null && (!Number.isInteger(e.hora_local) || e.hora_local < 0 || e.hora_local > 23)) throw new Error("Hora inválida.");
  if (e.tipo !== undefined && !(TIPOS as readonly string[]).includes(e.tipo)) throw new Error("Tipo inválido.");
  if (e.natureza !== undefined && !(NATUREZAS as readonly string[]).includes(e.natureza)) throw new Error("Natureza inválida.");
  if (e.forma_pagamento != null && !(FORMAS_PAGAMENTO as readonly string[]).includes(e.forma_pagamento)) throw new Error("Forma de pagamento inválida.");
  if (e.categoria !== undefined && !e.categoria.trim()) throw new Error("Categoria inválida.");
  if (e.cartao_id != null && !db.prepare("SELECT 1 FROM cartao WHERE id = ? AND usuario_id = ?").get(e.cartao_id, usuarioId)) throw new Error("Cartão inexistente.");

  const parcial = {
    descricao: e.descricao !== undefined ? e.descricao.trim() : atual.descricao,
    valor_centavos: e.valor_centavos ?? atual.valor_centavos,
    data_local: e.data_local ?? atual.data_local,
    hora_local: e.hora_local !== undefined ? e.hora_local : atual.hora_local,
    categoria: e.categoria?.trim() ?? atual.categoria,
    natureza: e.natureza ?? (e.categoria !== undefined ? naturezaPara(e.categoria.trim(), atual.natureza) : atual.natureza),
    forma_pagamento: e.forma_pagamento !== undefined ? e.forma_pagamento : atual.forma_pagamento,
    cartao_id: e.cartao_id !== undefined ? e.cartao_id : atual.cartao_id,
  };
  const tipoNovo = e.tipo ?? (parcial.natureza === "estorno" ? atual.tipo : tipoAposReclassificar(atual.tipo, parcial.categoria, parcial.natureza));
  const novo = { ...parcial, tipo: tipoNovo };
  const agora = agoraISO();
  const descNorm = normalizar(novo.descricao);
  const precisao = e.hora_local === undefined ? atual.precisao_horario : e.hora_local === null ? "desconhecido" : "exato";

  const tx = db.transaction(() => {
    const audit = (campo: string, antigo: unknown, valor: unknown) => {
      if (String(antigo) !== String(valor)) db.prepare("INSERT INTO auditoria (lancamento_id, campo, valor_antigo, valor_novo, quando) VALUES (?,?,?,?,?)").run(id, campo, String(antigo), String(valor), agora);
    };
    for (const campo of ["descricao", "valor_centavos", "data_local", "hora_local", "tipo", "categoria", "natureza", "forma_pagamento", "cartao_id"] as const) audit(campo, atual[campo], novo[campo]);
    db.prepare(
      `UPDATE lancamento SET descricao = ?, estabelecimento_norm = ?, valor_centavos = ?, data_local = ?, hora_local = ?, precisao_horario = ?, ocorrido_em = ?,
         tipo = ?, categoria = ?, natureza = ?, forma_pagamento = ?, cartao_id = ?, hash_dedup = ?, status = 'confirmado', confianca = 1,
         motivo_revisao = NULL, atualizado_em = ? WHERE id = ?`,
    ).run(
      novo.descricao, descNorm, novo.valor_centavos, novo.data_local, novo.hora_local, precisao, paraInstanteUTC(novo.data_local, novo.hora_local),
      novo.tipo, novo.categoria, novo.natureza, novo.forma_pagamento, novo.cartao_id,
      hashDe(usuarioId, novo.tipo, novo.valor_centavos, novo.data_local, novo.cartao_id ?? atual.conta_id ?? 0, descNorm, atual.parcela_atual ?? 0), agora, id,
    );
    if (e.categoria !== undefined && novo.categoria !== "nao_classificado") {
      aprenderRegra(db, usuarioId, descNorm, novo.categoria, novo.natureza === "estorno" ? naturezaPadraoDaCategoria(novo.categoria) ?? "eventual" : novo.natureza);
    }
  });
  tx();
  return obterLancamento(db, id)!;
}

/**
 * Define a categoria de um lançamento pendente e, opcionalmente, de todos os outros pendentes do MESMO estabelecimento,
 * de uma vez (classificar uma vez resolve todos os parecidos). Devolve os identificadores alterados.
 */
export function classificarEmLote(db: Db, id: number, usuarioId: string, categoria: string, aplicarSimilares = true): number[] {
  const base = obterLancamento(db, id);
  if (!base || base.usuario_id !== usuarioId) throw new Error("Lançamento não encontrado");
  const alterados: number[] = [];
  const tx = db.transaction(() => {
    alterarLancamento(db, id, usuarioId, { categoria, status: "confirmado" });
    alterados.push(id);
    if (!aplicarSimilares) return;
    const chave = chaveEstabelecimento(base.estabelecimento_norm);
    if (!chave) return;
    // Estornos pertencem ao mesmo grupo das despesas do estabelecimento (abatem a despesa); os demais tipos so se agrupam entre si.
    const grupoDespesa = base.tipo === "despesa" || base.natureza === "estorno";
    const outros = db
      .prepare(`SELECT id, estabelecimento_norm FROM lancamento WHERE usuario_id = ? AND status = 'pendente' AND id != ? AND ${grupoDespesa ? "(tipo = 'despesa' OR natureza = 'estorno')" : "tipo = ?"}`)
      .all(...(grupoDespesa ? [usuarioId, id] : [usuarioId, id, base.tipo])) as { id: number; estabelecimento_norm: string }[];
    for (const o of outros) {
      if (chaveEstabelecimento(o.estabelecimento_norm) === chave) {
        alterarLancamento(db, o.id, usuarioId, { categoria, status: "confirmado" });
        alterados.push(o.id);
      }
    }
  });
  tx();
  return alterados;
}

/** Remove (cancela) um lançamento; `restaurar` o traz de volta. A origem fica registrada, então reimportar não o recria. */
export function excluirLancamento(db: Db, id: number, usuarioId: string): void {
  alterarLancamento(db, id, usuarioId, { status: "cancelado" });
}
export function restaurarLancamento(db: Db, id: number, usuarioId: string): void {
  alterarLancamento(db, id, usuarioId, { status: "confirmado" });
}

/**
 * Reaplica a classificação aos lançamentos que ficaram pendentes só por falta de categoria (por exemplo, depois de o usuário
 * ensinar uma regra ou de novos meses terem sido validados). Só confirma quando o classificador atinge a confiança mínima;
 * pendentes por outro motivo (duplicidade, leitura duvidosa) não são tocados. Devolve quantos foram resolvidos.
 */
export function reaplicarRegrasAosPendentes(db: Db, usuarioId: string): number {
  const pend = db
    .prepare("SELECT * FROM lancamento WHERE usuario_id = ? AND status = 'pendente' AND categoria IN ('nao_classificado','receita_outras') ORDER BY data_local, id")
    .all(usuarioId) as Lancamento[];
  const agora = agoraISO();
  let resolvidos = 0;
  const tx = db.transaction(() => {
    for (const l of pend) {
      if (l.motivo_revisao && l.motivo_revisao !== "categoria não reconhecida com segurança") continue;
      const estorno = l.natureza === "estorno";
      const tipoBusca: Tipo = estorno || l.tipo === "transferencia" ? "despesa" : l.tipo;
      const c = classificar(db, usuarioId, l.descricao, tipoBusca, { valor_centavos: l.valor_centavos, data_local: l.data_local });
      if (c.fonte === "nenhuma" || c.confianca < LIMIAR_CONFIANCA) continue;
      const natureza: Natureza = estorno ? "estorno" : l.parcela_total && l.parcela_total > 1 && c.natureza === "eventual" ? "parcelado" : c.natureza;
      const tipo = estorno ? l.tipo : tipoCoerente(l.tipo, natureza);
      db.prepare("UPDATE lancamento SET categoria = ?, natureza = ?, tipo = ?, status = 'confirmado', confianca = ?, motivo_revisao = NULL, atualizado_em = ? WHERE id = ?").run(c.categoria, natureza, tipo, c.confianca, agora, l.id);
      db.prepare("INSERT INTO auditoria (lancamento_id, campo, valor_antigo, valor_novo, quando) VALUES (?,?,?,?,?)").run(l.id, "categoria", l.categoria, c.categoria, agora);
      resolvidos++;
    }
  });
  tx();
  return resolvidos;
}

/**
 * Informa o nome do titular: Pix e transferências de/para esse nome passam a ser entre as próprias contas (não são gasto nem renda).
 * Guardado como regra de classificação do usuário, no aparelho. Devolve quantos pendentes foram resolvidos.
 */
export function definirTitular(db: Db, usuarioId: string, nome: string): number {
  const n = nome.trim();
  if (normalizar(n).split(" ").length < 2 || normalizar(n).length < 8) throw new Error("Informe o nome completo, como aparece nos extratos.");
  // Duas regras, uma por direcao: o usuario pode classificar diferente o que recebe de si mesmo (ex.: custo de vida vindo de outra conta).
  aprenderRegra(db, usuarioId, `Pix enviado: ${n}`, "transferencia", "transferencia");
  aprenderRegra(db, usuarioId, `Pix recebido: ${n}`, "transferencia", "transferencia");
  return reaplicarRegrasAosPendentes(db, usuarioId);
}
