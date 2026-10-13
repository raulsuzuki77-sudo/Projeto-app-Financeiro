# Pipeline do projeto

Atualizado em 13/10/2026, apos a decisao de tornar o aplicativo 100% local no iPhone, sem custo.

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

## Em aberto (depende do usuario)

| Item | O que fazer | Quem |
|---|---|---|
| V1 Validar no aparelho | Compilar no Mac, seguir o roteiro de primeiro uso e reportar erros (principalmente de compilacao do Swift e qualidade do OCR) | Usuario, depois ajustes por mim |

## Proximas tarefas (apos V1)

| # | Tarefa | Criterio de aceite |
|---|---|---|
| T4 | Orcamento e alertas | Orcamento 50/30/20 e por categoria; alertas locais de estouro, assinatura nova, cobranca duplicada, custo de juros do rotativo; compromisso de parcelas futuras |
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
