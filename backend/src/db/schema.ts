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
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lanc_data ON lancamento(usuario_id, data_local);
CREATE INDEX IF NOT EXISTS idx_lanc_hash ON lancamento(usuario_id, hash_dedup);

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

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY,
  lancamento_id INTEGER NOT NULL,
  campo TEXT NOT NULL,
  valor_antigo TEXT,
  valor_novo TEXT,
  quando TEXT NOT NULL
);
`;
