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

## 13. Extratos CSV do Nubank e aprendizado por transação repetida (14/10/2026)

Origem: o usuário enviou extratos reais da conta (jul a set/2026) e faturas do cartão (jun a ago/2026) para treinar a classificação. Os arquivos NÃO entram no repositório: os testes usam dados sintéticos no mesmo formato (`core/test/nubank.test.ts`). Nomes de pessoas físicas nunca viram regra base; só marcas e empresas.

Formatos reconhecidos (deduzidos dos arquivos de exemplo; o Nubank pode alterá-los, e qualquer outro cabeçalho cai no leitor genérico, com linhas recusadas listadas):
- Conta: `Data,Valor,Identificador,Descrição`; valor com sinal (negativo = saída); o `Identificador` vira a referência estável de importação (reimportar não duplica; o estorno de um Pix reaproveita o identificador do envio, então o sinal do valor também entra na referência).
- Cartão: `date,title,amount`; valor positivo = compra; negativo = pagamento ou crédito.

Interpretação das descrições (`core/src/importers/nubank.ts`): "Transferência enviada/recebida pelo Pix - NOME - documento - banco, agência, conta" vira "Pix enviado: NOME" (o texto original fica em `texto_bruto`); "Pagamento de boleto efetuado - X" vira "Boleto: X"; "Parcela n/m" vira os campos de parcela; "Pagamento recebido" (cartão) e "Pagamento de fatura" (conta) são a mesma transferência e são unidos pela regra de duplicidade (mesmo valor, data próxima, descrição igual).

Decisões de contabilidade:
- Transferência e aporte nunca somam como despesa: o tipo do lançamento acompanha a natureza da categoria (transferência, aplicação em investimento). Resgate de investimento é transferência (não é renda). Aplicação e resgate de caixinhas (RDB) giram o mesmo dinheiro; o aporte líquido do mês é aplicações menos resgates, e o painel hoje mostra só as aplicações (limitação conhecida).
- Estorno, "Desconto Antecipação" e "IOF de volta" entram como entrada de natureza `estorno`, classificada pela despesa de origem; o resumo mensal os abate da despesa da categoria e não os conta como renda. Alternativa descartada: cancelar o lançamento original (perde a rastreabilidade) ou permitir valor negativo (exigiria migração do esquema).
- Boleto da fatura de outro cartão (Nomad) é transferência, para não contar duas vezes as compras que já vêm da fatura do cartão. Se a fatura do cartão não for importada, esse gasto não aparece: avaliar caso a caso.
- Itens idênticos no mesmo arquivo (duas compras iguais no mesmo dia) permanecem dois lançamentos; a mescla por duplicidade só vale entre fontes diferentes.
- Pix entre as próprias contas: o usuário informa o nome do titular (Mais opções, Cartões, Titular), que vira uma regra do usuário (guardada só no aparelho). Não há nome embutido no código.

Aprendizado por transação repetida: nova camada do classificador, logo após as regras do usuário. Uma transação com a mesma descrição e o mesmo valor, já validada pelo usuário em outro mês, é proposta com a mesma categoria. Só conta como prova a classificação confirmada, editada ou lançada pelo próprio usuário (confiança 1): classificação automática não serve de prova, para que um erro não se repita sozinho. Se as ocorrências validadas divergem entre si, nada é proposto. Descrição igual com valor diferente cai no histórico por estabelecimento (já existente). Na tela de revisão, o motivo aparece como "mesma transação de mês anterior".

Efeito medido nos arquivos do usuário (importação em memória, nenhuma revisão manual ainda): 249 lançamentos, 161 classificados pelas regras base (65%) e 88 pendentes em 43 descrições distintas; 76 dos 88 pendentes são Pix de ou para pessoas físicas e empresas pequenas, que dependem de decisão do usuário (uma classificação resolve todos os itens do mesmo favorecido). A camada de transação repetida só passa a agir depois dessa primeira validação, nos meses seguintes.

Tela de revisão: pendentes agrupados por estabelecimento (maiores grupos primeiro; "+N parecidos"), porque classificar um resolve todos.

Não verificado: nenhum formato além dos arquivos enviados; extratos de outros meses ou bancos.

## 14. Versão web para computador e leitura de PDF/imagem no navegador (14/10/2026)

Objetivo: testar importação e classificação no computador antes de instalar no iPhone. O mesmo código roda no navegador (react-native-web); o banco é SQLite (sql.js) gravado no IndexedDB do navegador, no endereço `http://localhost:8123`, e o backup cifrado usa o mesmo formato do iPhone (restaura nos dois sentidos). Empacotamento: `npm run empacotar-pc` gera um zip com o site estático, um servidor local mínimo (`scripts/pc/servir.cjs`, só Node, só 127.0.0.1) e atalhos para macOS e Windows. Motivo do servidor: o roteador do aplicativo precisa de um endereço http; abrir o HTML direto do disco (file://) quebra a navegação e o carregamento do SQLite.

Leitura de documentos no navegador (`app/src/lib/ocr.web.ts`): PDF com camada de texto é lido pelo pdf.js sem OCR; PDF de imagem e fotos passam pelo Tesseract (português, empacotado localmente, funciona sem internet); PDF com senha pede a senha e distingue "protegido" de "senha incorreta". A senha não é guardada na versão web (só dura a sessão da página). HEIC não é lido pelo navegador.

Verificado no Chromium com a fatura de exemplo (PDF de imagem, 3 páginas): 38 itens lidos, soma confere com o total da fatura; a cópia protegida por senha foi recusada sem senha, recusada com senha errada e lida com a senha certa. Tempo: 7 a 9 s por página, mais o carregamento inicial (cerca de 5 MB). Ajuste necessário: reamostrar a página renderizada pelo pdf.js fazia o Tesseract errar o último dígito do ano; a solução foi ler a imagem original embutida no PDF e ampliá-la. Esse ajuste foi calibrado com uma única fatura; a conferência de soma continua sendo a rede de segurança e outros PDFs digitalizados podem se comportar diferente. O reconhecimento no navegador (Tesseract) não é o mesmo do iPhone (Vision): os resultados podem divergir.

No iPhone, o PDF com senha usa o desbloqueio do PDFKit e a senha por cartão fica no Chaveiro. NÃO verificado em aparelho: a compilação do Swift, o fluxo de senha e a leitura real.

## 15. Orçamento, classes, eventos e recorrentes (14/10/2026)

Origem: planilha de orçamento do usuário ("Classificação dos gastos", "Orçamento ATUAL", "Manejo de faturas", "Aluguéis"). A planilha não entra no repositório; o que foi aproveitado é a estrutura.

Classes do orçamento (segunda visão dos gastos, além da categoria): Custo fixo, Meta, Prazeres, Eventualidade, Liberdade financeira, Conforto e Conhecimento. O mapeamento categoria para classe segue os exemplos e as fórmulas da planilha (por exemplo: feira, remédio, gasolina, seguros, plano de saúde e sindicato em Custo fixo; Livelo, doações e viagens em Meta; IA e Audible em Conhecimento; previdência, apartamento e aportes em Liberdade financeira) e é uma inferência: o usuário pode mudar a classe de qualquer categoria (tela Orçamento) e o padrão fica em `core/src/classification/categorias.ts`.

Hierarquia: toda categoria pertence a um grupo (Alimentação contém Supermercado, Delivery, Bares...). As telas mostram o grupo em destaque e as categorias recuadas; o Início alterna a visão do gráfico entre categoria, grupo e classe e permite trocar o mês.

Regras indicadas pelo usuário: GETWAY é parcela de apartamento (categoria própria, tratada como investimento, classe Liberdade financeira); Itoko Tachi é restaurante; Zero Grau é depósito de bebidas; S2P*2FUNAPE é curso de idiomas. Dos valores da planilha foi deduzido, sem confirmação do usuário: a Mútua dos profissionais da engenharia é plano de saúde e coparticipação (os valores coincidem com a linha de coparticipação), o sindicato é a linha "Sindicato TCE-GO" e ICATU e BTG Previdência compõem a "Previdência complementar". Categoria nova "Corte de cabelo" dentro de Saúde.

Eventos (viagem a serviço, férias, outro): entidade própria com período; é uma segunda classificação do gasto, sem duplicar totais (o gasto conta na categoria e, separadamente, no evento). Ao criar o evento, os gastos do período são vinculados (exceto contas fixas, assinaturas, parcelas, aportes, transferências e estornos); gastos importados depois dentro do período já nascem vinculados; o usuário desvincula caso a caso. A tela pergunta o período quando há gasto de viagem sem evento, ao importar arquivos (com o intervalo de datas lido) e ao classificar um gasto como viagem. Limite de 120 dias por evento.

Recorrentes: (a) detecção: mesmo favorecido (chave do estabelecimento), valores até 15% de diferença, no máximo duas ocorrências por mês, dois meses ou mais; aplicações genéricas em caixinha e pequenos gastos de valor oscilante não entram; (b) cadastro: antes de salvar, mostra em quais meses os lançamentos importados já contemplam o compromisso (mesmo valor com diferença de até 1%, ou mesmo favorecido com valor até 30% diferente); (c) geração: meses já contemplados não geram lançamento, e o lançamento importado passa a ser a ocorrência do mês; quando o extrato chega depois da previsão, o lançamento real substitui a previsão (inclusive o valor, nas contas variáveis), contando uma só vez.

Orçamento: valor planejado por categoria e por mês, com valor padrão para todos os meses; realizado vem dos lançamentos (gastos e aportes somam; estornos abatem; resgates abatem o aporte da categoria Investimento, pois as caixinhas giram o mesmo dinheiro, de modo que o aporte líquido pode ficar negativo em um mês de resgates). Superávit = receita menos despesas e aportes. Alertas: acima do planejado, a partir de 80% e gasto sem valor planejado. Sugestão de preenchimento pela média dos três meses anteriores (nunca grava sem confirmação). Metas e orçamento: compara o planejado em Liberdade financeira com a soma dos aportes mensais que as metas ativas exigem (simulação educacional com premissas editáveis, sem recomendação de investimento).

Pix entre as próprias contas: a chave agora inclui a direção (enviado ou recebido), então o usuário pode classificar de modos diferentes o que envia e o que recebe de si mesmo (por exemplo, o recebido de outra conta como "Custo de vida"). Pix enviado a uma corretora (BTG, XP, Rico, Genial, Warren, Clear, Órama, Toro, Ágora, Avenue) é tratado como aporte. Decisão pendente do usuário: o Pix recebido do próprio titular, na planilha, é a "receita" do orçamento (custo de vida transferido de outra conta); a categoria "Custo de vida (recebido de outra conta sua)" existe para isso, mas nenhuma regra foi presumida.

Esquema do banco versão 3 (tabelas `evento`, `orcamento`, `classe_categoria`; coluna `lancamento.evento_id`); o backup inclui as novas tabelas. Um backup da versão 3 não restaura em aplicativo anterior.

Interface: campo de valor com máscara em todos os campos em reais (digitam-se números; vírgula e pontos de milhar entram sozinhos). Fora de escopo por falta de amostra: extrato da corretora (ver resposta ao usuário: proposta de patrimônio mensal).

## 16. Correções e ampliações após o uso do app na versão para computador (14/10/2026)

Totais consistentes. Causa do problema relatado (totais diferentes ao trocar entre categoria, grupo e classe): a visão por categoria e por grupo omitia "Sem categoria", a visão por classe vinha do orçamento (incluía aportes e não incluía o sem categoria) e os estornos eram abatidos na categoria, mas não na natureza. Correção: as despesas do mês saem de uma única matriz (categoria x natureza), já líquidas de estornos, e as três visões (categoria, grupo, classe), o total por natureza e o total de despesas somam exatamente o mesmo valor; "Sem categoria" aparece nas três. O calendário também abate os estornos. Aportes e transferências ficam fora do gráfico por definição. Teste de regressão em `core/test/consistencia.test.ts`.

Categoria de receita em despesa (Painel). Causa provável: uma regra aprendida ao classificar um Pix RECEBIDO (por exemplo como "Salário e trabalho") passava a valer também para o Pix ENVIADO ao mesmo favorecido, porque a regra não distinguia tipo nem direção. Correções: (a) o classificador nunca aplica categoria de receita a saída, nem categoria de gasto a entrada (regras do usuário, repetição, histórico e regras base); (b) ao reclassificar, saída com categoria de receita vira entrada, e entrada com categoria de gasto vira estorno (devolução que abate o gasto, sem contar como renda); (c) migração automática na abertura do banco: saídas com categoria de receita e entradas com categoria de gasto (que não sejam estorno) voltam a "Sem categoria", pendentes, com motivo e registro na auditoria; idempotente. Decisão que cabe ao usuário: o app não tem como saber a categoria correta desses itens.

Eventos. O vínculo automático pelo período passou a valer só para gastos de alta probabilidade: hospedagem e passagens, comer e beber fora, passeios e deslocamento por aplicativo. Mercado, compras, saúde e o restante aparecem em "Conferir gastos do período", para o usuário incluir os que foram da viagem. Nunca são sugeridos: entradas (salário), contas da casa (aluguel, condomínio, energia, plano de saúde, seguros, sindicato, impostos), assinaturas, parcelas, aportes, transferências, boletos e compromissos detectados como recorrentes. Isso evita atribuir à viagem o salário e as contas da casa quando o período atravessa a virada do mês. O vínculo manual não depende de data: qualquer gasto pode ser vinculado ao evento (reserva de hotel feita meses antes), com busca e ordenação (primeiro viagens sem evento, depois os mais próximos do período).

Recorrentes. O usuário pode recusar a sugestão ("Não é recorrente"): o compromisso deixa de ser sugerido e de ser marcado no extrato, com opção de desfazer e de restaurar.

Extrato. Ordenação por data (mais recentes ou mais antigos) e por valor (maior ou menor), e filtro por evento (todos, sem evento ou um evento; neste caso mostra o evento inteiro, de todos os meses).

Orçamento. As classes abrem recolhidas (só o total) e expandem para os itens por valor decrescente; há "Expandir tudo" e "Recolher tudo".

Compras parceladas (fluxo de caixa). Antes, o valor da compra parcelada digitada ("3000 em 10x") entrava inteiro no mês da compra. Agora cada mês entra com a sua parcela: a compra digitada gera as parcelas mensais (o resto dos centavos vai para as primeiras, e a soma fecha com o total); a parcela lida em fatura ou CSV projeta as seguintes como "previstas". Quando a fatura do mês seguinte traz a parcela, ela substitui a previsão (contada uma só vez, mesmo com data diferente); parcelas antecipadas no mesmo dia, em qualquer ordem, não geram previsões sobrando. As previstas herdam a categoria da primeira parcela, não servem de prova de classificação, e se a primeira estiver pendente as demais acompanham e só aparecem na revisão quando o mês chega. O Orçamento mostra o fluxo das parcelas já comprometidas por mês. Limitação: a conciliação supõe o mesmo valor (diferença de até 1%) e a mesma descrição base; parcelas de valores diferentes na mesma compra não se conciliam sozinhas.

Revisão. A aba Revisar foi substituída por um botão circular flutuante no Início: neutro quando não há pendências; laranja, com anel pulsante e contador, quando há. Conta pendências de todos os meses até hoje (parcelas futuras previstas não entram).

Liberdade financeira: ver o item 17.

## 17. Aba Liberdade financeira: extratos de investimento (14/10/2026)

Origem: dois extratos de exemplo enviados pelo usuário, do BTG Pactual: o Extrato da Conta Investimento (Brasil, em reais) e o Account Statement da BTG Pactual US Capital (em dólares). Os PDFs não entram no repositório; os testes usam texto sintético no mesmo formato (`core/test/fixtures-investimentos/`). CPF, endereço, nome e número completo da conta nunca são lidos nem gravados: a conta guarda só os quatro últimos caracteres.

Leitura: dois leitores (`core/src/investimentos/`) operam sobre linhas de texto, tolerando colunas em linhas separadas. Cada extrato traz uma conferência: a soma das posições é comparada com o total declarado e com os totais de cada seção (nas amostras reais todas fecharam, diferença zero: Brasil R$ 27.933,89 em 16 posições; EUA US$ 3.736,84 em 3 posições). Divergência nunca é descartada em silêncio: aparece destacada na prévia e nada é gravado antes da confirmação do usuário. Reimportar o mesmo arquivo não duplica (identificado pelo hash); um novo extrato da mesma conta e do mesmo mês substitui as posições anteriores. Um rendimento que aparece duas vezes no mesmo extrato (na conta corrente e na renda variável) é contado uma só vez, com aviso.

Moeda: valores em dólar são convertidos pela taxa que o usuário informa por mês (sem taxa, a conta em dólar fica fora do total em reais, com aviso). O patrimônio de cada conta no mês usa o último extrato disponível até aquele mês e marca como defasado quando é de um mês anterior.

Visões: patrimônio total (a mesma soma por classe de ativo e por instituição), evolução de 12 meses, posições recolhíveis, aportes do mês (movimentos dos extratos ao lado dos lançamentos do app do tipo investimento), câmbio, extratos importados com conferência, posição manual e comparação com as metas. Rentabilidade estimada = variação do patrimônio menos aportes registrados nos extratos (inclui contribuição de previdência em trânsito); é sempre rotulada como estimativa, só calculada quando cada conta tem posição no mês anterior e, nas contas em dólar, embute a variação cambial.

Achado técnico: na versão web, o pdf.js devolve "a" e ligaturas como caracteres nulos neste PDF (fonte Type 3) e parte palavras em trechos; a aba usa um extrator próprio (`extrato-pdf.web.ts`) que junta os trechos e corrige o "a". As ligaturas continuam erradas em textos descritivos ("financeiro" vira "ananceiro"), sem efeito nos valores, que a conferência protege.

NÃO verificado: a leitura no iPhone (o texto do PDF vem do PDFKit, cujas quebras de linha podem diferir; os leitores foram testados com três formatos de linha simulados, mas não com o PDFKit real). Se falhar, a leitura acusa erro ou divergência, nunca grava em silêncio; alternativa: importar na versão para computador e levar o backup cifrado ao iPhone. Cobertura de layouts: só BTG Brasil e BTG EUA. Transferências ACATS da conta americana trazem valor zero no extrato e não entram nos aportes.


## 18. Liberdade financeira: leitura posicional no iPhone, detalhe por ativo, Meta e pizzas (14/10/2026)

Origem: no aparelho, o informe Brasil teve os valores dos investimentos nao reconhecidos, a conta internacional nao foi detectada e o caixa da conta internacional aparecia como "DW Bank Sweep (...)". Com as linhas montadas pelo pdf.js (caminho da web), os dois leitores ja funcionavam; o defeito esta no texto do PDFKit, que divide `PDFPage.string` por quebras de linha e emite celulas de tabela em linhas proprias ou fora de ordem.

Extracao no iPhone. O modulo nativo ganhou `extrairItens(uri, senha)`: percorre os caracteres de cada `PDFPage` (indices UTF-16 de `page.string`, `characterBounds(at:)`) e devolve trechos `{str, x, y, largura, tamanho, pagina}` no mesmo formato do pdf.js (pontos, origem inferior esquerda). Novo trecho em espaco ou quebra, quando a linha-base muda (0,45 x tamanho da fonte) e quando a folga horizontal passa de 15% do tamanho; o tamanho vem do texto atribuido da pagina (so se o comprimento bater com `string`), senao da altura da caixa dividida por 1,2. Caracteres sem geometria acompanham o trecho vizinho; pagina sem nenhuma geometria devolve as linhas do texto sem colunas; cada pagina comeca com um item vazio (marca de existencia, para detectar paginas sem texto). O reparo U+0000 -> "a" e aplicado no Swift e no TS; senha (PDF_PROTEGIDO, PDF_SENHA_INCORRETA) usa o mesmo desbloqueio (`abrirPdf`) do caminho antigo. No TS (`extrato-pdf.ts`) as linhas saem do MESMO `itensParaLinhas` da web; PDF misto manda so as paginas sem texto para OCR; se a funcao nativa nao existe (build antigo), falha ou devolve pouco texto, cai no caminho antigo (`PDFPage.string`) e depois no OCR. Validado em Linux: um modelo em TypeScript do agrupamento (caixas de caractere derivadas dos itens do pdf.js, celulas embaralhadas, duas hipoteses de caixa: tipografica e de tinta) reproduz as mesmas linhas e a mesma leitura conferida. NAO verificado: o Swift (nao ha como compilar aqui), o PDFKit real (comportamento de `characterBounds`, ordem do texto, existencia de U+0000 ou outros caracteres de substituicao, alinhamento do texto atribuido), e o desempenho em 13 paginas. Se falhar no aparelho, o caminho antigo continua valendo e o "Copiar diagnostico" mostra o que ocorreu.

Diagnostico. Quando o PDF nao e reconhecido, a leitura falha ou a soma nao confere, a importacao oferece "Copiar diagnostico": caminho usado (pdfkit-posicional, pdfkit-antigo, ocr, pdfjs, ocr-web), tentativas, quantidade de itens e linhas, marcas de deteccao de cada leitor e as 80 primeiras linhas, com CPF, numeros longos de conta, e-mail, telefone, CEP, enderecos, "Account Name" e a linha de nome do titular ocultados por padroes (melhor esforco; o usuario deve conferir antes de enviar). No iPhone abre a folha de compartilhamento (escolher Copiar), pois nao ha modulo de area de transferencia no app; adicionar `expo-clipboard` exigiria novo build.

Modelo (schema versao 5, migracao incremental e idempotente por colunas anulaveis): posicao com especie, CNPJ, preco de fechamento/cotacao, preco medio (nulo quando o documento mostra "-"; nunca zero), custo total e `detalhe_json` (rentabilidade e benchmark, lotes por aliquota de IR, valor liquido, IR, setor, vencimento e cupom, fator de cotacao por 100 de face); movimento com quantidade e preco; extrato com a distribuicao setorial guardada; tabela `ativo_cadastro` (por codigo ou nome: preco medio informado, especie, setor, exposicao, Meta), incluida no backup. Hierarquia: genero (previdencia, renda variavel, renda fixa, caixa, valores em transito, outros, mais Meta) > especie (PGBL, Acoes, ETFs, Fundos listados, Treasury Bills/Notes/Bonds, Conta corrente, Cash, Compras a liquidar, Proventos a receber, Contribuicao de previdencia a creditar) > ativo. Valores em transito agora sao uma posicao por item (antes eram dois agregados); a soma e o total declarado seguem conferidos, assim como cada secao e a soma das posicoes por aliquota contra o saldo bruto. Resultado = saldo bruto - quantidade x preco medio, so com preco medio (do extrato, que prevalece, ou informado e persistente); nunca calculado sem ele. Conta americana: custo 0,00 (transferencia ACATS) e tratado como nao informado, nao como lucro de 100% (aviso na leitura); titulos do Tesouro cotados por 100 de face usam fator 0,01; o saldo DWBDS chama-se "Cash" (classe caixa).

Setor. A "Distribuicao Setorial" do extrato e guardada por extrato e conciliada com os saldos das acoes: procuram-se as particoes das acoes cujas somas batem com cada percentual (tolerancia de 0,0105% da base mais 1 centavo); so se atribui setor ao que e igual em todas as particoes possiveis; sem solucao ou com ambiguidade, avisa e o ativo fica "Sem setor". Dicionarios pequenos e editaveis (setor por ticker; exposicao estrangeira para ETFs de indice americano e BDRs) sao padrao, escritos de memoria e NAO verificados contra a classificacao da B3; o cadastro do ativo sempre prevalece.

Meta. Renda fixa marcada como Meta (reserva ou provisao sacada quando o fato provisionado ocorre) fica fora da base da liberdade financeira (comparacao com as metas) e aparece separada no patrimonio; variacao, rentabilidade estimada e evolucao continuam sobre o patrimonio total. Secao de renda fixa dos extratos BTG: o layout NAO esta nos exemplos; a leitura e generica e so aceita a coluna cuja soma fecha com o total declarado (da secao ou do sumario); do contrario, as posicoes nao sao lidas e o aviso diz isso, e o total diverge de forma visivel. Secoes "X - Posicao/Movimentacao" desconhecidas e linhas do sumario desconhecidas geram aviso; a movimentacao de renda fixa nao e lida (avisado).

Pizzas (estilo da aba Inicio, `pizza.tsx`): (1) genero e especie, (2) setorial com base escolhida (so acoes, renda variavel ou tudo), (3) nacional x estrangeira; cada uma mostra a base, o total, a soma das fatias e, se houver, o valor negativo que uma pizza nao desenha (por exemplo, caixa liquido de valores em transito negativo). Caixa e valores em transito aparecem somados na pizza 1 (liquidar uma compra consome o caixa). Alternancia "Total (com Meta)" ou "Sem Meta" para todas. Dolar entra pelo cambio do mes ja existente; sem cambio, o item aparece na lista e fica fora dos totais.

Verificado: 139 testes do nucleo (fixtures sinteticas com a estrutura de cada secao; testes com os itens reais lidos em tempo de execucao de /tmp, pulados sem eles e sem valores reais no codigo), tipos do nucleo e do app, e a tela no Chromium com os dois PDFs reais enviados pelo seletor de arquivos (conferencia igual ao total declarado nos dois, Meta, preco medio informado, pizzas e diagnostico). NAO verificado: tudo o que depende do aparelho (Swift, PDFKit, folha de compartilhamento).
