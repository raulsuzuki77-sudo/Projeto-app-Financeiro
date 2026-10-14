# Pipeline do projeto

Atualizado em 14/10/2026 (segunda versao do app). Base: decisao de tornar o aplicativo 100% local no iPhone, sem custo.

## Concluido

| Item | Entrega |
|---|---|
| T1 Comprovante PIX real | Leitura correta de comprovante real de banco digital |
| T3 Metas e cenarios | Reserva de emergencia, metas, cenarios, perfil de risco, premissas editaveis |
| L1 Nucleo compartilhado | `core/` sem Node e sem React Native, interface de banco, SHA-256 puro |
| L2 Importacao, cartoes, backup | Orquestracao de importacao, cadastro de cartoes, backup cifrado AES-GCM |
| L3 Aplicativo local | expo-sqlite, telas sem servidor, Face ID, backup/restauracao |
| L4 OCR nativo | Modulo Swift (Vision + PDFKit) e agrupamento de linhas |
| L5 Guia de instalacao | `docs/INSTALACAO_IPHONE.md` |
| N1 Extratos Nubank e aprendizado | CSV de conta e cartao, estorno, transferencia, aporte, camada de transacao repetida (DECISOES, item 13) |
| N2 Versao web para computador | Pacote zip com banco persistente no navegador, importacao de CSV/OFX/PDF/imagem, PDF com senha (DECISOES, item 14) |
| O1 a O5 Orcamento, eventos, recorrentes | Classes do orcamento, eventos (viagens e ferias), recorrentes detectadas, orcamento planejado x realizado, campo de valor com mascara (DECISOES, item 15) |
| P1 a P6 Correcoes e liberdade financeira | Totais consistentes, cura de dados, eventos por alta probabilidade, parcelas em fluxo de caixa, botao de revisao flutuante, aba Liberdade com extratos BTG (DECISOES, itens 16 e 17) |
| P7 Liberdade detalhada | Leitura posicional no iPhone (PDFKit), detalhe por ativo, cadastro, Meta, tres pizzas e diagnostico (DECISOES, item 18); NAO verificado no aparelho |
| U1 a U4 Segunda versao | Nova navegacao, pizza, revisao rapida, recorrentes, edicao/exclusao, senha de PDF, PDF pelo Compartilhar, previa web (ver DECISOES, item 12) |

## Em aberto (depende do usuario)

| Item | O que fazer | Quem |
|---|---|---|
| V1 Validar no aparelho | Atualizar o projeto no Mac (Parte 6 do guia), compilar, seguir o roteiro de primeiro uso e reportar erros (principalmente de compilacao do Swift e qualidade do OCR) | Usuario, depois ajustes por mim |

## Proximas tarefas (apos V1)

| # | Tarefa | Criterio de aceite |
|---|---|---|
| T4 | Orcamento e alertas (parcial) | Feito: orcamento por categoria e classe, alertas de estouro. Falta: alerta de cobranca duplicada, custo de juros do rotativo, compromisso de parcelas futuras |
| T10 | Patrimonio e corretora | Extrato mensal da corretora (precisa de amostra), patrimonio por posicao e progresso das metas |
| T7 | Seguranca, LGPD e qualidade | Exportar e excluir todos os dados; revisao de seguranca; politica de retencao |
| T8 | Notificacoes locais | Lembrete de vencimento e de revisao semanal, sem servidor |
| T9 | Atualizacao de taxas | Importacao manual/assistida de Selic, CDI e IPCA com fonte e data |

## Fora do escopo atual (exigem servidor)

WhatsApp, Open Finance, sincronizacao entre aparelhos. O codigo do servidor opcional continua em `backend/`.

## Regras de execucao

1. Testes automatizados junto do codigo; nenhuma afirmacao de funcionamento sem teste ou execucao.
2. O que nao puder ser verificado neste ambiente e registrado como nao verificado.
3. Dados pessoais reais usados so para validar e nunca versionados; fixtures usam dados ficticios.
4. Commits pequenos e documentacao atualizada em `docs/DECISOES.md`.
