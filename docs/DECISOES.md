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
- As premissas sao editaveis no aplicativo (secao "Premissas de rentabilidade" na aba Metas) e pela API.

## 9. Perfis de risco e metas ajustaveis (13/10/2026)

Cada meta passa a ter um perfil de risco (conservador, moderado ou arrojado) escolhido pelo usuario; o cenario correspondente aparece destacado ("seu perfil"). Metas podem ser editadas a qualquer momento (nome, tipo, valor, prazo, valor inicial e perfil), com revalidacao completa a cada edicao (`PATCH /api/metas/:id`). As premissas de rentabilidade de cada perfil tambem sao editaveis. O sistema NAO sugere perfil nem produto: o perfil e escolha do usuario, e as simulacoes continuam sendo educacionais. Verificado: 44 testes do servidor (um novo cobre perfil e edicao parcial) e compilacao do bundle iOS; nao verificado em aparelho.

## 10. Mudanca de arquitetura: aplicativo 100% local no iPhone (13/10/2026)

Decisao do usuario, apos analise: o aplicativo guarda os dados e faz todos os calculos no proprio iPhone. Custo zero e sem servidor. WhatsApp e Open Finance saem do escopo inicial (ambos exigem servidor); o servidor em `backend/` permanece como opcao futura. As secoes 1 (canal WhatsApp), 7 (aplicativo falando com o servidor) e `docs/IMPLANTACAO.md` ficam como historico.

- `core/`: logica de negocio pura (sem Node e sem React Native): interpretacao de mensagens, classificacao, deduplicacao, importadores, dashboards, metas, cartoes, backup. Roda identica no iPhone e no servidor. Acesso a dados por uma interface minima (`Db`), implementada pelo better-sqlite3 (testes e servidor) e por um adaptador do expo-sqlite (iPhone).
- Sem dependencias de Node: SHA-256 em TypeScript puro (testado contra node:crypto e vetores NIST), formatacao de moeda e fuso sem `Intl`, base64 e UTF-8 proprios (sem `TextDecoder`).
- Backup: exporta todas as tabelas em JSON e cifra com AES-256-GCM (chave derivada da senha por PBKDF2-HMAC-SHA256, 210 mil iteracoes, parametros autenticados), usando as bibliotecas auditadas @noble em JavaScript puro. Restaurar valida tabelas e colunas contra o schema e e tudo-ou-nada (transacao). Testado: ida e volta, senha errada, adulteracao, parametros forjados, tentativa de injecao por nome de coluna, rollback.
- Seguranca no aparelho: bloqueio opcional por Face ID/Touch ID/codigo (ao abrir e apos 30 s em segundo plano). O banco usa a protecao de dados padrao do iOS; nao ha cifragem adicional do banco em repouso (a cifragem aplica-se ao backup).
- OCR no aparelho: modulo Expo local em Swift (`app/modules/ocr-nativo`): Vision (`VNRecognizeTextRequest`, nivel preciso, pt-BR quando disponivel, sem correcao de linguagem para nao reescrever nomes e codigos) e PDFKit. PDFs com camada de texto usam o texto exato; PDFs de imagem sao rasterizados a 300 dpi. As observacoes (com coordenadas) sao agrupadas em linhas em TypeScript (`agruparEmLinhas`, testado), e a partir dai segue o mesmo fluxo ja validado: leitura da fatura, conferencia da soma, ordem cronologica, confianca por linha. Ajuste feito para o Vision: area tarjada sem texto ainda gera o item (valor lido) e vai para revisao.
- Instalacao sem custo: compilar com Xcode e Apple ID gratuito (ver `docs/INSTALACAO_IPHONE.md`); limitacao: renovar a cada 7 dias.

Verificado: 50 testes do nucleo, 13 do servidor e 5 do app; tipos; geracao do projeto iOS (`expo prebuild`); autolinking do modulo nativo; compilacao do pacote JavaScript. NAO verificado: compilacao do Swift, execucao em aparelho, qualidade do Vision nas suas faturas.

## 11. Falha ao abrir com Xcode 27: ciclo de vida por UIScene (13/10/2026)

Sintoma (primeiro teste em aparelho, com Xcode recente e iPhone atual): o app instalava, mas fechava ao abrir. O console do Xcode mostrou: `Application failed to launch: UIScene life cycle is required for apps built with this SDK`. A Apple passou a exigir esse ciclo de vida para apps compilados com o SDK do iOS 27.

Causa: o template de projeto do Expo SDK 57 (`expo-template-bare-minimum` 57.0.30) ainda nao adota scenes, embora o pacote `expo` 57.0.28 ja traga as classes nativas `ExpoAppSceneDelegate` e `ExpoReactNativeFactoryProvider`. O template do SDK 58 (58.0.18) adota.

Correcao: plugin de configuracao local `app/plugins/with-scene-lifecycle.js`, registrado em `app.json`, que reproduz no projeto gerado a mesma alteracao do template do SDK 58: manifesto de scenes no Info.plist, `SceneDelegate.swift` incluido no alvo do Xcode e `AppDelegate` conformando com `ExpoReactNativeFactoryProvider` sem criar a janela. E idempotente e falha com mensagem clara se o template mudar. Verificado em Linux: o `expo prebuild` gera os tres ajustes, o projeto referencia o novo arquivo na mesma convencao dos demais e uma segunda execucao nao altera nada. NAO verificado: a compilacao e a execucao no aparelho (aguardando teste do usuario). Alternativa descartada: migrar todo o projeto para o SDK 58 (versao `next`), por risco maior.

## 12. Segunda versao do app: navegacao, classificacao e previa web (14/10/2026)

Pedidos do usuario atendidos nesta versao (itens a a l do pedido):

- Navegacao: 4 abas (Inicio, Extrato, Revisar, Painel) e painel lateral ocultavel (botao de menu) com as opcoes menos usadas: importar documento, gastos recorrentes, metas e cenarios, cartoes e senhas de PDF, backup e seguranca. Botao de atualizar em todas as abas.
- Inicio: grafico de pizza dos gastos por categoria no mes (apenas saidas classificadas; o valor sem categoria e informado a parte para nao distorcer o grafico) e formulario de lancamento com campos fixos (entrada ou saida, valor, detalhamento) sempre abertos.
- Revisao: ate tres sugestoes de categoria por item (historico confirmado, regras e estabelecimentos parecidos), classificacao com um toque, aplicada tambem a itens parecidos; botoes de editar e excluir em cada item.
- Classificacao refinada: camadas em ordem de precedencia (regras do usuario, historico confirmado, regras base, estabelecimentos parecidos, nenhuma). Nada e classificado por palpite sem sinal: sem sinal suficiente, o item vai para revisao.
- Correcao de registros: editar (com trilha de auditoria e recalculo do hash), excluir com opcao de desfazer, e correcao em lote.
- Gastos recorrentes: cadastro de aluguel, assinaturas e salario; geracao idempotente (referencia unica por competencia), incluida no backup (schema versao 2).
- Senha de PDF: guardada apenas no Keychain do iPhone (expo-secure-store), nunca no banco nem no backup. Desbloqueio nativo (PDFKit); mensagens distintas para PDF protegido e senha incorreta.
- Receber PDF do menu Compartilhar: tipos de documento (PDF e imagem) declarados em `app.json` e redirecionamento em `+native-intent` para a tela de importacao. NAO verificado em aparelho: a exibicao do app na lista de compartilhamento depende do iOS.
- Previa web: o mesmo codigo roda no navegador (react-native-web + sql.js) com dados ficticios de demonstracao (`app/src/data/semente.ts`), para iterar o layout sem o aparelho. Limites: nao exercita OCR, Face ID, Keychain nem compartilhamento. Dados reais nunca sao carregados na previa.
- Script `preparar-mac.sh` passa a configurar o scheme do Xcode em Release (melhor esforco). A escolha do Team continua manual.

Verificado: tipos, 61 testes do nucleo, 13 do servidor e 12 do app; compilacao do pacote iOS; `expo prebuild` gera os tipos de documento e o manifesto de scenes. NAO verificado: tudo o que depende do aparelho (Swift com senha de PDF, share sheet, telas nativas, desempenho).

