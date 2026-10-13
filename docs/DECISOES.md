# Decisões da Fase 0/1 e achados da análise da fatura de exemplo

Data: 13/10/2026

## 1. WhatsApp pessoal com mensagens para si mesmo

Pergunta do usuário: funciona usar o número pessoal, enviando mensagens para si mesmo?

Resposta, com o que foi possível confirmar:

| Caminho | Lê o chat "mensagens para você"? | Observação |
|---|---|---|
| Cloud API oficial (Meta) | Não | A API entrega mensagens enviadas a um número de empresa registrado na plataforma. Não há acesso ao chat pessoal. Registrar o número pessoal na Cloud API tende a tirá-lo do aplicativo comum (a confirmar na documentação da Meta; existe um modo de coexistência para o aplicativo WhatsApp Business, também a confirmar). |
| Biblioteca não oficial (dispositivo vinculado, ex.: Baileys) | Sim | Viola os termos de uso do WhatsApp; há risco de banimento do número pessoal e quebra a cada atualização do protocolo. Não implementado. |
| Exportação manual da conversa (.txt) | Sim, em lote | Sem tempo real. Útil para carga histórica. Previsto na Fase 2. |

Decisão de arquitetura: o núcleo é independente do canal. Qualquer canal chama `processarMensagem` com um identificador único e o texto. Já existem dois adaptadores: o webhook da Cloud API (assinatura validada, idempotente, número autorizado) e `POST /api/mensagens`. Isso permite trocar o canal sem tocar nas regras de negócio.

Recomendação: como o requisito é uma experiência no iPhone, o canal principal passa a ser o aplicativo (entrada rápida e atalho de Compartilhar/Atalhos do iOS), e o WhatsApp via número dedicado fica como canal opcional. A decisão final é do usuário.

## 2. Aplicativo para iPhone

Linguagem única: TypeScript. Backend em Node (implementado). Aplicativo móvel em React Native com Expo (próximo passo), que roda no iPhone com o Expo Go para testes sem Mac e gera build de distribuição em nuvem. Publicar no TestFlight/App Store exige conta paga do Apple Developer Program (valor e condições a confirmar no site da Apple). Alternativa descartada por ora: Swift nativo (exige Mac com Xcode).

## 3. Achados da fatura de exemplo (Nomad, referência setembro/2026)

- O PDF não tem camada de texto (é imagem). Extração por texto retorna vazio; é necessário OCR. O ambiente de desenvolvimento não tem Tesseract instalado; o OCR entra na Fase 2. O interpretador de fatura já existe e foi testado com um trecho transcrito do layout (`backend/test/fixtures/fatura-nomad-trecho.txt`).
- Layout observado: linhas `DD/MM/AAAA  ESTABELECIMENTO  CIDADE  UF  R$ valor`; parcelas no formato `(02/02)` ao final da descrição; pagamento da fatura anterior como `PAGAMENTO DE FATURA - CNAB` com valor negativo; fatura distribuída em três páginas, com o extrato continuando na página 2 e o pagamento na página 3.
- Pagamento da fatura anterior é tratado como transferência e não entra nas despesas (evita dupla contagem).
- A fatura não traz horário das compras. Esses lançamentos têm `precisao_horario = desconhecido` e ficam fora do mapa de calor.
- Conferência: a fatura informa o total e a soma de despesas e créditos do mês. Como o arquivo foi anonimizado com linhas tarjadas, a soma das linhas legíveis não fecha com o total, e a conciliação automática (soma dos itens x total da fatura) deve ser feita na Fase 2 com o documento original.
- O documento traz também dados úteis para alertas futuros: pagamento mínimo, simulação de parcelamento da fatura e tabela de taxas (rotativo, parcelamento, mora). Isso alimenta o alerta de custo de juros previsto no plano.

## 4. O que a Fase 1 entrega neste commit

- Banco SQLite com lançamentos, origens (rastreabilidade e idempotência), regras aprendidas, auditoria.
- Interpretador de mensagens em português (valor, data, hora, parcelas, forma de pagamento, cartão), que recusa o que não consegue ler em vez de inventar.
- Classificador em camadas (regras do usuário, regras base, revisão), natureza e categoria separadas.
- Deduplicação entre origens, sem mesclar automaticamente quando a descrição é dessemelhante.
- Importadores OFX, CSV e texto de fatura; linhas inválidas são reportadas.
- Consultas de dashboard: resumo mensal, calendário de gastos e mapa de calor (dia da semana x hora).
- API HTTP autenticada e webhook do WhatsApp.
- 20 testes automatizados.

Não entregue ainda: aplicativo iPhone, tela de dashboard, OCR de imagem e PDF, envio real de resposta pelo WhatsApp, Open Finance, metas e cenários.
