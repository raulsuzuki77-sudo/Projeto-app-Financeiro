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
- Conferência (corrigida em 13/10/2026): a versão anterior deste documento afirmava que a soma não fecharia por causa das linhas tarjadas. Isso estava errado: a tarja cobre só a descrição, e os valores permanecem legíveis. Com OCR, os 37 lançamentos de compra somam R$ 4.364,71, igual ao campo "Despesas e créditos do mês" da fatura (diferença zero).
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

## 5. OCR (implementado em 13/10/2026)

Pipeline: PDF rasterizado a 300 dpi (poppler `pdftoppm`) e Tesseract 5 com idioma português (`--psm 6`, saída TSV para obter confiança por palavra). PNG e JPEG seguem direto ao Tesseract. O tipo do arquivo é detectado pelos primeiros bytes, não pelo Content-Type. Arquivos temporários ficam em diretório exclusivo e são apagados ao final. Um OCR por vez (fila), limite de 30 páginas.

Resultado medido no PDF de exemplo (3 páginas, cerca de 13 s):

- 38 linhas lidas (37 compras e o pagamento da fatura anterior), nenhuma linha de data deixou de ser lida.
- Soma das compras igual ao total declarado na fatura, ao centavo.
- Um erro real de leitura: a data 04/09/2026 foi lida como 14/09/2026. A conferência de ordem cronológica detectou o item e o enviou para revisão. Esse erro NÃO é detectável pela soma, que continuou fechando; por isso as verificações são independentes.
- Linhas com descrição tarjada foram lidas com confiança baixa (47% a 68%) e foram para revisão, como esperado. Algumas linhas corretas também ficaram abaixo do limiar de 80% e foram para revisão (custo de um toque do usuário; limiar configurável em `LIMIAR_CONFIANCA_OCR`).

Verificações aplicadas a cada fatura, de forma independente: confiança da linha, ordem cronológica das datas (maior subsequência não decrescente), descrição legível, e soma dos itens contra o total da fatura. Se a soma não fecha, todo o lote entra como pendente.

Comprovantes (foto de cupom/NFC-e e comprovante de PIX): extrai valor total (recusa se houver dois totais diferentes), estabelecimento, data, hora e CNPJ com validação dos dígitos verificadores. Todo lançamento vindo de foto nasce pendente e exige confirmação. Limitação: validado apenas com imagens sintéticas geradas por computador; fotos reais (ângulo, sombra, papel térmico) ainda não foram testadas e devem reduzir a qualidade da leitura. Para isso, o aplicativo deve oferecer recorte e correção de perspectiva antes do envio.

Dependências do sistema para o OCR: `tesseract-ocr`, `tesseract-ocr-por` e `poppler-utils`. Endpoint: `POST /api/importacoes-arquivo?tipo=fatura|comprovante` com `Content-Type: application/pdf|image/png|image/jpeg`.

## 6. Número do WhatsApp informado pelo usuário

O usuário solicitou usar o número pessoal terminado em 6494. Por ser dado pessoal, o número não é gravado no repositório: é configurado em `WHATSAPP_NUMERO_AUTORIZADO` (formato da Cloud API: código do país + DDD + número, sem símbolos). Efeito: apenas mensagens vindas desse número são processadas; as demais são descartadas. Isso NÃO resolve a limitação do item 1: a Cloud API recebe mensagens enviadas a um número de empresa registrado, e não lê o chat "mensagens para você" do número pessoal. Assim, com a API oficial, o fluxo será o usuário escrever do número pessoal para o número do bot.

## 7. Aplicativo iPhone (implementado em 13/10/2026)

Pasta `app/`: Expo SDK 57, React Native, TypeScript, Expo Router. Cinco abas: Lancar, Revisar, Painel, Gastos e Ajustes.

- Lancar: texto livre ("mercado 187,40 credito nomad"), foto de comprovante pela camera ou galeria, importacao de fatura (PDF ou foto). O resultado da fatura informa se a soma confere com o total declarado.
- Revisar: lista os pendentes com o motivo (ex.: "data fora da ordem cronologica", "confianca do OCR baixa"), permite confirmar, corrigir a categoria (a correcao e aprendida) ou excluir.
- Painel: receitas, despesas, investimentos, saldo, taxa de poupanca, despesas por categoria e por natureza.
- Gastos: calendario do mes por intensidade de gasto e mapa de calor (dia da semana x faixa horaria), com a quantidade de gastos sem horario confiavel que ficaram de fora.
- Ajustes: endereco do servidor e token, guardados no Chaveiro do iPhone (expo-secure-store). O aplicativo recusa http fora da rede local.

Mudanca no backend para suportar a revisao: coluna `motivo_revisao` (com migracao automatica de bancos antigos).

Verificado: typecheck, 3 testes de logica do aplicativo, 27 testes do backend e `expo export --platform ios` (bundle Hermes gerado). Nao verificado: execucao em aparelho ou simulador, aparencia real das telas, camera e seletor de arquivos. A documentacao oficial do Expo (docs.expo.dev) nao estava acessivel a partir deste ambiente; as APIs usadas foram conferidas nas definicoes de tipos dos pacotes instalados no SDK 57. Dependencias foram instaladas com versoes do `bundledNativeModules.json` do proprio SDK, porque o comando `expo install` falhou por restricao de rede.

Pendente: canal de WhatsApp em producao (credenciais da Meta), notificacoes, modo offline, metas e cenarios, Open Finance.

## 8. T3 Metas e cenarios (implementado em 13/10/2026)

Motor de calculo em `backend/src/metas/calculos.ts` (funcoes puras) e servico/API em `servico.ts`. Tela "Metas" no aplicativo.

- Reserva de emergencia: meses de cobertura (padrao 6) x despesa essencial mensal media, calculada dos ULTIMOS 3 MESES FECHADOS, usando apenas lancamentos confirmados de natureza fixa, recorrente variavel, parcelada e custos financeiros. Os meses sem dados sao informados, porque a estimativa fica subestimada quando ha pendentes.
- Capacidade de poupanca: media de (receitas - despesas) confirmadas nos ultimos 3 meses fechados.
- Metas: tipo (reserva, curto, medio, longo prazo), valor em moeda de hoje, prazo em meses, valor inicial. O aporte mensal necessario e calculado por formula fechada, liquido de IR, com a meta corrigida pelo IPCA informado. Tambem calcula em quantos meses a meta seria atingida com a sobra media atual do usuario.
- Cenarios conservador, moderado e arrojado com retorno nominal anual e regra de IR editaveis.
- Verificacao: 10 testes dos calculos contra valores de tabela conferidos a mao (por exemplo, 1.000 por mes durante 12 meses a 1% ao mes = 12.682,50), mais testes de consistencia (o aporte calculado reproduz a meta; aporte e prazo sao inversos) e 3 testes de API.

Premissas e limites que o usuario deve conhecer:

- Os retornos iniciais (8%, 10% e 12% ao ano) e o IPCA (4,5%) sao VALORES ILUSTRATIVOS escolhidos para exemplo. Nao sao as taxas atuais de mercado nem projecao. Enquanto o usuario nao os editar, a API e o aplicativo exibem aviso. Nao foi feita consulta a series oficiais do Banco Central; isso pode ser automatizado depois.
- Retorno constante e aportes no fim do mes. Monte Carlo nao foi implementado.
- IR: na renda fixa usa a tabela regressiva (22,5%, 20%, 17,5%, 15%) pela duracao total, aplicada a todos os aportes, o que superestima o imposto (resultado conservador). Come-cotas, IOF e isencoes nao sao modelados. Confirmar a regra vigente com fonte oficial antes de usar para decisao.
- O resultado e simulacao educacional, nao recomendacao individualizada de investimento (aviso exibido junto de cada simulacao).
- A tela ainda nao permite editar as premissas (apenas a API `PUT /api/premissas`).
