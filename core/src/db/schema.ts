import type { Db } from "./tipos";

export const VERSAO_SCHEMA = 6;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS conta (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'corrente',
  instituicao TEXT
);

-- Nunca armazenar numero completo, CVV ou senha: somente apelido e ultimos 4 digitos.
CREATE TABLE IF NOT EXISTS cartao (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  apelido TEXT NOT NULL,
  apelido_norm TEXT NOT NULL,
  ultimos4 TEXT,
  bandeira TEXT,
  conta_id INTEGER REFERENCES conta(id),
  dia_fechamento INTEGER,
  dia_vencimento INTEGER,
  limite_centavos INTEGER
);

-- Gastos, receitas ou aportes que se repetem todo mes no mesmo dia (aluguel, assinaturas, salario...).
CREATE TABLE IF NOT EXISTS recorrencia (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  descricao TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('despesa','receita','investimento')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  categoria TEXT NOT NULL,
  natureza TEXT NOT NULL,
  dia_mes INTEGER NOT NULL CHECK (dia_mes BETWEEN 1 AND 31),
  forma_pagamento TEXT,
  cartao_id INTEGER REFERENCES cartao(id),
  inicio_mes TEXT NOT NULL,
  ativa INTEGER NOT NULL DEFAULT 1,
  criada_em TEXT NOT NULL
);

-- Viagens e outros eventos (ferias, viagem a servico): segunda classificacao dos gastos do periodo, alem da categoria.
CREATE TABLE IF NOT EXISTS evento (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ferias','viagem_servico','outro')),
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lancamento (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  tipo TEXT NOT NULL CHECK (tipo IN ('despesa','receita','transferencia','investimento')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  descricao TEXT NOT NULL,
  estabelecimento_norm TEXT NOT NULL,
  categoria TEXT NOT NULL,
  natureza TEXT NOT NULL,
  forma_pagamento TEXT,
  cartao_id INTEGER REFERENCES cartao(id),
  conta_id INTEGER REFERENCES conta(id),
  parcela_atual INTEGER,
  parcela_total INTEGER,
  ocorrido_em TEXT NOT NULL,
  data_local TEXT NOT NULL,
  hora_local INTEGER,
  precisao_horario TEXT NOT NULL CHECK (precisao_horario IN ('exato','aproximado','desconhecido')),
  status TEXT NOT NULL CHECK (status IN ('pendente','confirmado','cancelado')),
  confianca REAL NOT NULL,
  hash_dedup TEXT NOT NULL,
  possivel_duplicado_de INTEGER REFERENCES lancamento(id),
  motivo_revisao TEXT,
  evento_id INTEGER REFERENCES evento(id),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lanc_data ON lancamento(usuario_id, data_local);
CREATE INDEX IF NOT EXISTS idx_lanc_hash ON lancamento(usuario_id, hash_dedup);

-- Arquivos importados (fatura, extrato, comprovante). O hash do conteudo impede importar o mesmo arquivo duas vezes; cada origem de
-- lancamento aponta para o documento, o que permite excluir ou mover o arquivo inteiro.
CREATE TABLE IF NOT EXISTS documento (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  tipo TEXT NOT NULL,
  formato TEXT,
  nome TEXT NOT NULL,
  hash_arquivo TEXT,
  cartao_id INTEGER REFERENCES cartao(id),
  periodo_inicio TEXT,
  periodo_fim TEXT,
  lidos INTEGER NOT NULL DEFAULT 0,
  criados INTEGER NOT NULL DEFAULT 0,
  mesclados INTEGER NOT NULL DEFAULT 0,
  ja_processados INTEGER NOT NULL DEFAULT 0,
  origem TEXT NOT NULL DEFAULT 'manual',
  versao_de INTEGER,
  importado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documento_hash ON documento(usuario_id, hash_arquivo) WHERE hash_arquivo IS NOT NULL;

-- Arquivos da pasta "00. Documentos financeiros" ja vistos pelo aplicativo (caminho + tamanho + data de modificacao identificam a versao),
-- para nao ler de novo o que ja foi importado nem repetir erros a cada abertura.
CREATE TABLE IF NOT EXISTS arquivo_pasta (
  usuario_id TEXT NOT NULL DEFAULT 'local',
  caminho TEXT NOT NULL,
  tamanho INTEGER NOT NULL,
  modificado INTEGER NOT NULL,
  hash_arquivo TEXT,
  status TEXT NOT NULL,
  mensagem TEXT,
  documento_id INTEGER,
  processado_em TEXT NOT NULL,
  PRIMARY KEY (usuario_id, caminho, tamanho, modificado)
);

-- Controle de pagamentos do mes (planejado -> lancado -> pago). Nao sao lancamentos: nao entram nos totais.
CREATE TABLE IF NOT EXISTS compromisso (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  mes TEXT NOT NULL,
  descricao TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'nao_classificado',
  valor_planejado_centavos INTEGER NOT NULL DEFAULT 0,
  valor_real_centavos INTEGER,
  vencimento TEXT,
  estado TEXT NOT NULL DEFAULT 'planejado' CHECK (estado IN ('planejado','lancado','pago')),
  pago_em TEXT,
  pago_pelo_usuario INTEGER NOT NULL DEFAULT 0,
  lancamento_id INTEGER,
  divergencia_centavos INTEGER,
  recorrencia_id INTEGER,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compromisso_mes ON compromisso(usuario_id, mes);

-- Rastreabilidade: toda origem que gerou ou confirmou o lancamento. UNIQUE = idempotencia.
CREATE TABLE IF NOT EXISTS lancamento_origem (
  id INTEGER PRIMARY KEY,
  lancamento_id INTEGER NOT NULL REFERENCES lancamento(id),
  origem TEXT NOT NULL,
  referencia TEXT NOT NULL,
  texto_bruto TEXT,
  criado_em TEXT NOT NULL,
  UNIQUE (origem, referencia)
);

CREATE TABLE IF NOT EXISTS regra_classificacao (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  padrao_norm TEXT NOT NULL,
  categoria TEXT NOT NULL,
  natureza TEXT NOT NULL,
  fonte TEXT NOT NULL DEFAULT 'usuario',
  UNIQUE (usuario_id, padrao_norm)
);

CREATE TABLE IF NOT EXISTS mensagem_processada (
  id TEXT PRIMARY KEY,
  processada_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('reserva_emergencia','curto_prazo','medio_prazo','longo_prazo')),
  valor_alvo_centavos INTEGER NOT NULL CHECK (valor_alvo_centavos > 0),
  aporte_inicial_centavos INTEGER NOT NULL DEFAULT 0 CHECK (aporte_inicial_centavos >= 0),
  prazo_meses INTEGER NOT NULL CHECK (prazo_meses BETWEEN 1 AND 1200),
  perfil TEXT NOT NULL DEFAULT 'moderado' CHECK (perfil IN ('conservador','moderado','arrojado')),
  ativa INTEGER NOT NULL DEFAULT 1,
  criada_em TEXT NOT NULL
);

-- Premissas editaveis pelo usuario. Nao sao previsoes nem recomendacoes.
CREATE TABLE IF NOT EXISTS premissa (
  usuario_id TEXT NOT NULL DEFAULT 'local',
  chave TEXT NOT NULL,
  retorno_nominal_aa REAL NOT NULL,
  ir_modo TEXT NOT NULL DEFAULT 'regressivo',
  ir_aliquota REAL,
  atualizada_em TEXT NOT NULL,
  PRIMARY KEY (usuario_id, chave)
);

-- Classe do orcamento escolhida pelo usuario para uma categoria (substitui a classe padrao).
CREATE TABLE IF NOT EXISTS classe_categoria (
  usuario_id TEXT NOT NULL DEFAULT 'local',
  categoria TEXT NOT NULL,
  classe TEXT NOT NULL,
  PRIMARY KEY (usuario_id, categoria)
);

-- Valores planejados. mes = '*' vale para todos os meses sem valor proprio; item = categoria ou '__receita'.
CREATE TABLE IF NOT EXISTS orcamento (
  usuario_id TEXT NOT NULL DEFAULT 'local',
  mes TEXT NOT NULL,
  item TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),
  PRIMARY KEY (usuario_id, mes, item)
);

-- Compromissos que o usuario disse que NAO sao recorrentes (a deteccao automatica deixa de sugeri-los).
CREATE TABLE IF NOT EXISTS recorrente_ignorada (
  usuario_id TEXT NOT NULL DEFAULT 'local',
  tipo TEXT NOT NULL,
  chave TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (usuario_id, tipo, chave)
);

-- Liberdade financeira: extratos de investimentos importados (um por arquivo), posicoes por mes, movimentos e cambio.
CREATE TABLE IF NOT EXISTS extrato_investimento (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  instituicao TEXT NOT NULL,
  conta TEXT NOT NULL DEFAULT '',
  moeda TEXT NOT NULL DEFAULT 'BRL',
  periodo_inicio TEXT NOT NULL,
  periodo_fim TEXT NOT NULL,
  hash_arquivo TEXT NOT NULL,
  total_declarado_centavos INTEGER,
  importado_em TEXT NOT NULL,
  UNIQUE (usuario_id, hash_arquivo)
);

-- valor_centavos na moeda original (pode ser negativo: valores em transito). mes = AAAA-MM do fim do periodo.
CREATE TABLE IF NOT EXISTS posicao_investimento (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  extrato_id INTEGER REFERENCES extrato_investimento(id),
  mes TEXT NOT NULL,
  instituicao TEXT NOT NULL,
  conta TEXT NOT NULL DEFAULT '',
  classe_ativo TEXT NOT NULL,
  ativo TEXT NOT NULL,
  codigo TEXT,
  quantidade REAL,
  moeda TEXT NOT NULL DEFAULT 'BRL',
  valor_centavos INTEGER NOT NULL,
  origem TEXT NOT NULL DEFAULT 'manual',
  criada_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pos_mes ON posicao_investimento(usuario_id, mes);

CREATE TABLE IF NOT EXISTS movimento_investimento (
  id INTEGER PRIMARY KEY,
  usuario_id TEXT NOT NULL DEFAULT 'local',
  extrato_id INTEGER REFERENCES extrato_investimento(id),
  data_local TEXT NOT NULL,
  instituicao TEXT NOT NULL,
  conta TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  codigo TEXT,
  moeda TEXT NOT NULL DEFAULT 'BRL',
  valor_centavos INTEGER NOT NULL,
  em_transito INTEGER NOT NULL DEFAULT 0
);

-- Taxa para converter moeda estrangeira em reais, informada pelo usuario por mes (ex.: dolar do fim do mes), taxa x 10000.
CREATE TABLE IF NOT EXISTS cambio (
  usuario_id TEXT NOT NULL DEFAULT 'local',
  mes TEXT NOT NULL,
  moeda TEXT NOT NULL,
  taxa_x10000 INTEGER NOT NULL,
  PRIMARY KEY (usuario_id, mes, moeda)
);

-- Cadastro do ativo por codigo (ou nome, sem codigo), persistente entre extratos: o que o usuario informa e o extrato nao traz.
-- preco_medio na moeda do ativo (unidade, nao centavos); null = nao informado. meta = reserva/provisao fora da liberdade financeira.
CREATE TABLE IF NOT EXISTS ativo_cadastro (
  usuario_id TEXT NOT NULL DEFAULT 'local',
  chave TEXT NOT NULL,
  nome TEXT NOT NULL DEFAULT '',
  especie TEXT,
  setor TEXT,
  exposicao TEXT CHECK (exposicao IS NULL OR exposicao IN ('nacional','estrangeira')),
  preco_medio REAL,
  meta INTEGER NOT NULL DEFAULT 0,
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (usuario_id, chave)
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY,
  lancamento_id INTEGER NOT NULL,
  campo TEXT NOT NULL,
  valor_antigo TEXT,
  valor_novo TEXT,
  quando TEXT NOT NULL
);
`;

/** Cria as tabelas e aplica migracoes de bancos criados antes de colunas novas. Idempotente. */
export function prepararBanco(db: Db): void {
  db.exec(SCHEMA);
  const col = (tabela: string) => (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name);
  if (!col("meta").includes("perfil")) db.exec("ALTER TABLE meta ADD COLUMN perfil TEXT NOT NULL DEFAULT 'moderado'");
  if (!col("lancamento").includes("motivo_revisao")) db.exec("ALTER TABLE lancamento ADD COLUMN motivo_revisao TEXT");
  if (!col("lancamento").includes("evento_id")) db.exec("ALTER TABLE lancamento ADD COLUMN evento_id INTEGER REFERENCES evento(id)");
  if (!col("lancamento_origem").includes("documento_id")) db.exec("ALTER TABLE lancamento_origem ADD COLUMN documento_id INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_origem_documento ON lancamento_origem(documento_id)");
  // Schema versao 5 (extratos de investimento detalhados por ativo). Colunas novas, todas anulaveis: idempotente.
  const novas: [string, string, string][] = [
    ["posicao_investimento", "especie", "TEXT"],
    ["posicao_investimento", "cnpj", "TEXT"],
    ["posicao_investimento", "preco_fechamento", "REAL"],
    ["posicao_investimento", "preco_medio", "REAL"],
    ["posicao_investimento", "custo_total_centavos", "INTEGER"],
    ["posicao_investimento", "detalhe_json", "TEXT"],
    ["movimento_investimento", "quantidade", "REAL"],
    ["movimento_investimento", "preco", "REAL"],
    ["extrato_investimento", "distribuicao_setorial_json", "TEXT"],
  ];
  for (const [tabela, coluna, tipo] of novas) if (!col(tabela).includes(coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
  repararCategoriasIncoerentes(db);
  repararSemCategoriaConfirmada(db);
  migrarCaixinhasParaMeta(db);
  agruparOrigensLegadas(db);
}

/**
 * Importacoes feitas antes do registro de documentos nao sabem de qual arquivo vieram. Para poder ajusta-las, as origens de arquivo
 * (CSV, PDF, OFX, foto) sem documento sao agrupadas em documentos "anteriores" por tipo de origem, cartao e mes. Idempotente.
 */
export function agruparOrigensLegadas(db: Db): number {
  const linhas = db
    .prepare(
      `SELECT o.id oid, o.origem, l.usuario_id, l.cartao_id, substr(l.data_local,1,7) mes, c.apelido
       FROM lancamento_origem o JOIN lancamento l ON l.id = o.lancamento_id LEFT JOIN cartao c ON c.id = l.cartao_id
       WHERE o.documento_id IS NULL AND o.origem IN ('csv','pdf','ofx','fatura_texto','foto')`,
    )
    .all() as { oid: number; origem: string; usuario_id: string; cartao_id: number | null; mes: string; apelido: string | null }[];
  if (linhas.length === 0) return 0;
  const agora = new Date().toISOString();
  const ids = new Map<string, number>();
  const tx = db.transaction(() => {
    for (const r of linhas) {
      const chave = `${r.usuario_id}|${r.origem}|${r.cartao_id ?? 0}|${r.mes}`;
      let id = ids.get(chave);
      if (id === undefined) {
        const rotulo = r.origem === "csv" ? "CSV" : r.origem === "pdf" ? "PDF" : r.origem === "ofx" ? "OFX" : r.origem === "foto" ? "Foto" : "Texto";
        const info = db
          .prepare("INSERT INTO documento (usuario_id, tipo, formato, nome, cartao_id, periodo_inicio, periodo_fim, origem, importado_em) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(r.usuario_id, "legado", r.origem, `Importações anteriores (${rotulo}${r.apelido ? `, cartão ${r.apelido}` : ", conta"}, ${r.mes})`, r.cartao_id, `${r.mes}-01`, `${r.mes}-28`, "manual", agora);
        id = Number(info.lastInsertRowid);
        ids.set(chave, id);
      }
      db.prepare("UPDATE lancamento_origem SET documento_id = ? WHERE id = ?").run(id, r.oid);
    }
  });
  tx();
  return linhas.length;
}

/**
 * Versoes anteriores permitiam confirmar (ou salvar uma edicao de) lancamento sem categoria; ele sumia da revisao, mas continuava
 * em "Sem categoria" nos totais. Todos voltam a pendente, com auditoria. Idempotente.
 */
export function repararSemCategoriaConfirmada(db: Db): number {
  const cond = "status = 'confirmado' AND categoria = 'nao_classificado'";
  const n = (db.prepare(`SELECT COUNT(*) c FROM lancamento WHERE ${cond}`).get() as { c: number }).c;
  if (n === 0) return 0;
  const agora = new Date().toISOString();
  db.prepare(`INSERT INTO auditoria (lancamento_id, campo, valor_antigo, valor_novo, quando) SELECT id, 'status', 'confirmado', 'pendente', ? FROM lancamento WHERE ${cond}`).run(agora);
  db.prepare(`UPDATE lancamento SET status = 'pendente', confianca = 0, motivo_revisao = 'sem categoria: escolha uma categoria', atualizado_em = ? WHERE ${cond}`).run(agora);
  return n;
}

/**
 * Aplicacao e resgate de RDB sao as caixinhas de provisao (classe Meta), nao investimento da Liberdade financeira. Lancamentos e
 * regras aprendidas das versoes anteriores, que os tinham como investimento, passam para as categorias novas (com auditoria). Idempotente.
 */
export function migrarCaixinhasParaMeta(db: Db): number {
  const agora = new Date().toISOString();
  let n = 0;
  for (const [norm, de, para, natureza] of [
    ["aplicacao rdb", "investimento", "provisao_meta", "investimento"],
    ["resgate rdb", "resgate_investimento", "resgate_provisao", "transferencia"],
  ] as const) {
    const cond = "estabelecimento_norm = ? AND categoria = ?";
    const afetados = (db.prepare(`SELECT COUNT(*) c FROM lancamento WHERE ${cond}`).get(norm, de) as { c: number }).c;
    if (afetados > 0) {
      db.prepare(`INSERT INTO auditoria (lancamento_id, campo, valor_antigo, valor_novo, quando) SELECT id, 'categoria', categoria, ?, ? FROM lancamento WHERE ${cond}`).run(para, agora, norm, de);
      db.prepare(`UPDATE lancamento SET categoria = ?, natureza = ?, atualizado_em = ? WHERE ${cond}`).run(para, natureza, agora, norm, de);
      n += afetados;
    }
    db.prepare("UPDATE regra_classificacao SET categoria = ?, natureza = ? WHERE padrao_norm = ? AND categoria = ?").run(para, natureza, norm, de);
  }
  return n;
}

/**
 * Cura dados incoerentes de versoes anteriores: saida com categoria de receita (uma regra aprendida ao receber contaminava o Pix
 * enviado) e entrada com categoria de gasto que nao e estorno. Esses lancamentos voltam a "sem categoria", pendentes, para o
 * usuario decidir, e cada mudanca fica na auditoria. Idempotente: depois de curados, nao ha mais linhas que casem.
 */
export function repararCategoriasIncoerentes(db: Db): number {
  const agora = new Date().toISOString();
  const condSaida = "tipo IN ('despesa','investimento') AND categoria LIKE 'receita%'";
  const condEntrada = "tipo = 'receita' AND natureza != 'estorno' AND categoria NOT LIKE 'receita%' AND categoria NOT IN ('transferencia','resgate_investimento','resgate_provisao','nao_classificado')";
  let n = 0;
  for (const [cond, motivo, novaCat] of [
    [condSaida, "categoria de receita em uma saida: reclassifique", "nao_classificado"],
    [condEntrada, "entrada com categoria de gasto: reclassifique", "receita_outras"],
  ] as const) {
    const afetados = (db.prepare(`SELECT COUNT(*) c FROM lancamento WHERE ${cond}`).get() as { c: number }).c;
    if (afetados === 0) continue;
    db.prepare(`INSERT INTO auditoria (lancamento_id, campo, valor_antigo, valor_novo, quando) SELECT id, 'categoria', categoria, ?, ? FROM lancamento WHERE ${cond}`).run(novaCat, agora);
    db.prepare(`UPDATE lancamento SET categoria = ?, natureza = 'eventual', status = 'pendente', confianca = 0, motivo_revisao = ?, atualizado_em = ? WHERE ${cond}`).run(novaCat, motivo, agora);
    n += afetados;
  }
  return n;
}
