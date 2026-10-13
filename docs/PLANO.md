# Plano do Sistema de Controle Financeiro Pessoal

Versão 0.1 (planejamento) - 13/10/2026

## 1. Objetivo

Concentrar em um único lugar todas as movimentações financeiras pessoais, com captura o mais automática possível (WhatsApp, fotos de comprovantes, extratos, faturas em PDF e dados bancários), classificação automática, relatórios, dashboards, metas de investimento e análise de comportamento de gasto (dias e horários).

Princípios de projeto:

- Toda informação extraída automaticamente é uma proposta, não um fato: o usuário confirma o que tiver baixa confiança (ceticismo).
- Todo lançamento mantém rastreabilidade até a origem (mensagem, imagem, arquivo, transação bancária) e histórico de alterações.
- Dados sensíveis ficam sob controle do usuário (LGPD, Lei 13.709/2018).
- Começar simples (MVP) e evoluir por fases.

## 2. Pontos de atenção e decisões a validar antes de construir

### 2.1 WhatsApp "puxar da minha conversa"

O WhatsApp pessoal não tem API oficial para ler conversas. Há três caminhos:

| Opção | Como funciona | Vantagens | Riscos |
|---|---|---|---|
| A. WhatsApp Business Cloud API (recomendada) | Número dedicado do "bot"; o usuário conversa com ele como se fosse um contato. A Meta envia cada mensagem por webhook HTTPS; imagens chegam como identificador de mídia e o arquivo é baixado em segunda chamada à Graph API. | Oficial, estável, em conformidade com os termos. | Exige número exclusivo, conta Business e verificação; custos por conversa podem se aplicar. |
| B. Bibliotecas não oficiais (ex.: Baileys, whatsapp-web.js) | Emulam o WhatsApp Web na conta pessoal. | Lê a conversa pessoal; sem custo da Meta. | Viola os termos de uso; risco de banimento do número; quebra com atualizações. Não recomendada. |
| C. Exportação manual de conversa (arquivo .txt/.zip) | Importação periódica do histórico. | Sem risco de conta; útil para carga histórica. | Não é tempo real. |

Recomendação: A para o fluxo diário (conversa com o próprio bot) e C para importar o histórico já existente.

Pontos técnicos do webhook (a confirmar na documentação oficial da Meta, pois a pesquisa retornou apenas fontes de terceiros): HTTPS com certificado válido; token de verificação no handshake; validação da assinatura das requisições; responder 200 rapidamente e processar em fila; idempotência pelo identificador único da mensagem (wamid) para ignorar duplicados.

### 2.2 Dados bancários e de cartão

O caminho regulado é o Open Finance Brasil, via instituição agregadora (por exemplo Belvo ou Pluggy; a pesquisa não retornou a documentação técnica da Pluggy, portanto a comparação deve ser feita nos portais dos fornecedores). Pelo material consultado da Belvo, o usuário concede consentimento a cada instituição, é criado um vínculo (link) e a plataforma recupera automaticamente até 12 meses de contas, titular, transações e faturas de cartão. O consentimento só pode ser renovado ou revogado pelo usuário.

Não armazenar senha de internet banking nem número completo de cartão (PAN/CVV). Guardar apenas os quatro últimos dígitos e o apelido do cartão. Fornecedor, custo e cobertura de instituições precisam ser validados em prova de conceito antes da escolha definitiva.

Alternativa sem custo de agregador: importação manual de OFX/CSV dos extratos e PDF das faturas (previsto na Fase 1).

### 2.3 Reconhecimento de comprovantes e documentos

- Foto de comprovante/nota: OCR para texto + extração estruturada (estabelecimento, CNPJ, data/hora, valor, itens, forma de pagamento).
- Nota fiscal com QR Code (NFC-e): leitura do QR Code leva à consulta pública na SEFAZ, que oferece dados mais confiáveis que o OCR (verificar a viabilidade por estado).
- PDF de fatura: extração de texto (quando o PDF tem camada de texto) ou OCR; parser por emissor com fallback para extração por modelo de linguagem.
- Comprovante PIX/TED: campos padronizados (valor, favorecido, data/hora, ID da transação).
- Mensagem de texto livre ("almoço 42,90 débito"): interpretação por modelo de linguagem com saída em formato estruturado e validação por regras.

## 3. Arquitetura proposta

```
 WhatsApp (bot)   Upload web/app   Open Finance   Importação OFX/CSV/PDF
        \               |               |                /
         +--------------+---------------+---------------+
                                |
                     Camada de ingestão (fila)
                                |
        +-----------------------+------------------------+
        |                       |                        |
   Extração (OCR/LLM)    Normalização            Deduplicação
        |                       |                        |
        +-----------------------+------------------------+
                                |
                   Classificação + score de confiança
                                |
               Fila de revisão (baixa confiança)
                                |
              Banco de dados (lançamentos, contas, metas)
                                |
        +-----------+-----------+-----------+-------------+
        | Dashboards| Relatórios| Metas     | Alertas     |
        +-----------+-----------+-----------+-------------+
```

Stack sugerida (ajustável):

- Backend: Python (FastAPI) ou Node (NestJS), com fila (Redis + worker) para processamento assíncrono.
- Banco: PostgreSQL (lançamentos, auditoria, metas); armazenamento de objetos criptografado para imagens e PDFs.
- OCR/extração: serviço de OCR (Tesseract local ou serviço em nuvem) combinado com modelo de linguagem para estruturar campos.
- Front-end: aplicação web responsiva (PWA) com dashboards; opcional app móvel numa fase posterior.
- Segurança: criptografia em repouso e em trânsito, segredos em cofre, autenticação com MFA, log de auditoria, política de retenção e exclusão (LGPD).

## 4. Modelo de dados (resumo)

- usuario
- conta (corrente, poupança, carteira, investimento) e cartao (apelido, últimos 4 dígitos, fechamento, vencimento, limite)
- lancamento: data_hora, valor, moeda, tipo (despesa, receita, transferência, investimento), categoria, subcategoria, natureza (ver item 5), estabelecimento, forma_pagamento, parcela_atual/total, conta_id, cartao_id, origem (whatsapp, foto, ofx, pdf, open_finance, manual), referencia_origem, confianca, status (pendente, confirmado), hash_dedup
- fatura (cartão, competência, total, itens)
- anexo (imagem/PDF, hash, texto extraído)
- regra_classificacao (padrão -> categoria; aprendida a partir das correções do usuário)
- meta, cenario, orcamento, alerta
- auditoria (quem/quando/o que alterou)

Deduplicação: o mesmo gasto pode chegar pelo WhatsApp, pela foto e pelo extrato/Open Finance. Conciliar por valor, janela de data/hora, estabelecimento normalizado e conta; vincular os registros a um único lançamento mantendo todas as origens.

## 5. Classificação dos gastos

Duas dimensões independentes:

Natureza (comportamento do gasto):

| Natureza | Definição | Exemplos |
|---|---|---|
| Fixo | Valor e data previsíveis | Aluguel/financiamento, condomínio, plano de saúde, escola |
| Recorrente variável | Periódico, valor oscila | Energia, água, internet, combustível, supermercado |
| Assinatura | Cobrança recorrente de serviço | Streaming, aplicativos, academia |
| Parcelado | Compra dividida | Parcelas de cartão, financiamentos |
| Eventual/discricionário | Sem periodicidade | Restaurantes, lazer, vestuário |
| Extraordinário | Imprevisto ou anual | Manutenção, IPVA/IPTU, saúde não coberta |
| Investimento | Aplicação de capital | Renda fixa, ações, fundos, previdência, reserva |
| Dívida/juros/tarifas | Custo financeiro | Juros de cartão, tarifas, multas |
| Transferência | Movimentação entre contas próprias (não é gasto) | Pagamento de fatura, PIX entre contas |

Categoria (finalidade): moradia, alimentação, transporte, saúde, educação, lazer, vestuário, impostos, família, pets, presentes/doações, etc.

Atenção: o pagamento da fatura do cartão e a transferência entre contas devem ser tratados como transferência, para não contar o mesmo gasto duas vezes (uma vez na compra e outra no pagamento da fatura).

Método de classificação, em camadas:

1. Regras determinísticas (CNPJ/estabelecimento conhecido, palavras-chave, MCC do cartão quando disponível).
2. Histórico do próprio usuário (regras aprendidas das correções).
3. Modelo de linguagem para casos novos, com justificativa e score de confiança.
4. Abaixo do limiar de confiança: fila de revisão e pergunta ao usuário no próprio WhatsApp.

Detecção de recorrência: identificar lançamentos com mesmo favorecido e intervalo regular (semanal, mensal, anual) e sugerir marcá-los como fixo/assinatura; alertar reajustes de valor.

## 6. Interação via WhatsApp

Exemplos de comandos e respostas:

- "mercado 187,40 crédito nubank" -> "Registrado: Supermercado, R$ 187,40, cartão Nubank, hoje 19:42. Confirma? (sim/editar)"
- Envio de foto de cupom -> extração e confirmação.
- "gastei quanto com alimentação este mês?" -> resumo textual e link para o dashboard.
- "/desfazer", "/editar", "/resumo semana", "/meta" -> atalhos.
- Mensagem proativa: pergunta sobre lançamentos ambíguos, alerta de orçamento, lembrete de vencimentos.

Regras: horário da mensagem é o horário padrão do gasto, salvo se o usuário informar outro; valores sempre confirmados quando a confiança for baixa; mensagens e mídias armazenadas com hash para auditoria.

## 7. Relatórios e dashboards

Dashboards (filtros por período, conta, cartão, categoria, natureza):

1. Visão geral do mês: receitas, despesas, saldo, taxa de poupança, comparação com mês anterior e média de 12 meses.
2. Fluxo de caixa realizado e projetado (inclui fixos, parcelas e faturas futuras).
3. Gastos por natureza e por categoria (composição e evolução).
4. Cartões: fatura aberta, limite usado, parcelas comprometidas por mês futuro, juros pagos.
5. Orçamento por categoria: previsto x realizado.
6. Patrimônio e investimentos: alocação, evolução e aderência às metas.
7. Qualidade dos dados: lançamentos pendentes de revisão, não conciliados e duplicidades suspeitas.

Relatórios: mensal e anual em PDF/planilha, extrato consolidado por categoria, relatório de apoio à declaração de imposto de renda (despesas dedutíveis: saúde, educação; rendimentos), exportação CSV.

## 8. Calendário de gastos: dias e horários

- Mapa de calor semana x hora (dia da semana nas linhas, faixas de hora nas colunas), com valor total e quantidade de transações.
- Calendário mensal colorido por intensidade de gasto, com clique para ver os lançamentos do dia.
- Indicadores: dia da semana e faixa horária de maior gasto, gasto médio por dia da semana, picos próximos ao pagamento do salário, efeito de fim de semana e feriados.
- Filtro por categoria (ex.: onde o horário de maior gasto em delivery se concentra).
- Alertas comportamentais opcionais (ex.: "compras por impulso após as 22h somam R$ X no trimestre").

Limitação a considerar: o horário só é confiável quando vem da mensagem do WhatsApp, do comprovante ou de dados do Open Finance que o informem; extratos e faturas costumam trazer só a data. O sistema deve marcar a precisão do horário (exato, aproximado, desconhecido) e excluir os desconhecidos do mapa de calor.

## 9. Metas financeiras e cenários de investimento

Estrutura de metas:

- Reserva de emergência: 6 a 12 meses de despesas essenciais (fixas + recorrentes), calculadas a partir dos dados reais do próprio usuário.
- Metas de curto prazo (até 2 anos): viagem, equipamento, quitação de dívida.
- Metas de médio prazo (2 a 10 anos): imóvel, veículo, educação.
- Metas de longo prazo: aposentadoria / independência financeira.

Cenários (para cada meta o sistema calcula o aporte mensal necessário e o prazo):

| Cenário | Premissa de retorno (parâmetro editável) | Uso |
|---|---|---|
| Conservador | Taxa próxima à Selic/CDI líquida de IR, ou inflação + juro real baixo | Reserva e metas curtas |
| Moderado | Mistura de renda fixa e variável | Metas médias |
| Arrojado | Maior peso em renda variável | Metas longas |

Cálculos: valor futuro e aporte necessário com juros compostos, ajustados pela inflação (IPCA) e pelo imposto de renda sobre aplicações (tabela regressiva quando aplicável), simulação de aporte inicial + aportes mensais, simulação de aceleração (e se eu aumentar o aporte em 10%?), e de Monte Carlo simplificada para mostrar faixas de resultado em metas longas.

As taxas de cenário não devem ficar fixas no código: devem ser parâmetros editáveis, com valores de referência atualizados por fonte pública (por exemplo, séries do Banco Central) e data da última atualização exibida. O sistema apresenta simulações educacionais, não recomendação individualizada de investimento; incluir aviso explícito nesse sentido (ver Resolução CVM 20/2021 sobre a atividade de consultoria de valores mobiliários).

Funcionalidades associadas: capacidade de poupança estimada a partir do histórico, plano de redução de gastos por categoria para financiar a meta, acompanhamento de progresso e alerta de desvio.

## 10. Funcionalidades adicionais sugeridas (benchmarking e educação financeira)

Referências de mercado consultadas: Mobills (sincronização bancária, categorização, metas; plano premium), Organizze (simplicidade, alertas de vencimento, exportação) e Minhas Economias (planejamento de sonhos), conforme comparativos publicados por [Mobills](https://www.mobills.com.br/blog/apps-de-controle-financeiro/) e [Serasa](https://www.serasa.com.br/blog/aplicativo-controle-financeiro/). Uma das fontes divergiu quanto à integração bancária do Minhas Economias; esse ponto não foi confirmado e deve ser verificado diretamente antes de usar como referência.

Sugestões priorizadas:

Alta prioridade:

1. Orçamento 50/30/20 (necessidades, desejos, poupança) ou orçamento base zero, com adaptação aos percentuais do usuário.
2. Alertas: vencimento de contas e fatura, estouro de orçamento, cobrança duplicada, valor acima da média da categoria, nova assinatura detectada.
3. Controle de parcelamentos: compromisso futuro mês a mês e simulação do efeito de uma nova compra parcelada.
4. Detecção e gestão de assinaturas (lista, custo anual total, sugestão de cancelamento de sem uso).
5. Conciliação com extratos e detecção de lançamentos duplicados ou ausentes.
6. Modo casal/família com contas compartilhadas e individuais.

Média prioridade:

7. Estratégia de quitação de dívidas (método avalanche por taxa de juros e bola de neve por saldo), com custo total de juros.
8. Score de saúde financeira (taxa de poupança, endividamento, liquidez da reserva, concentração de despesas fixas), com explicação dos componentes.
9. Metas por envelopes/potes (caixinhas virtuais por objetivo).
10. Custo por hora de trabalho: converte o valor de uma compra em horas de trabalho, como recurso de reflexão antes de comprar.
11. Regra das 24 horas para compras acima de um valor definido, com lembrete no WhatsApp.
12. Controle de despesas de viagem em moeda estrangeira com conversão na data.
13. Revisão semanal automática enviada no WhatsApp (3 números e 1 recomendação).

Baixa prioridade / futuro:

14. Gestão de patrimônio e carteira (importação de posições via Open Finance ou B3) e comparação com benchmarks (CDI, IPCA).
15. Planejamento tributário pessoal (carnê-leão, dedutíveis) e organização de recibos para o imposto de renda.
16. Gestão de contratos e garantias (vencimento de seguros, garantias de produtos).
17. Dicas educativas contextuais (microconteúdo ligado ao comportamento observado), sem caráter de recomendação de produto.
18. Previsão de gastos por modelo estatístico, com intervalo de confiança.

Princípios de educação financeira incorporados: pagar-se primeiro (aporte automático antes do consumo discricionário), reserva de emergência antes de investimento de risco, separação entre necessidade e desejo, evitar dívida cara (rotativo do cartão, cheque especial), diversificação, horizonte de tempo compatível com o risco, e consciência do efeito dos juros compostos (a favor e contra).

## 11. Segurança, privacidade e conformidade

- LGPD: base legal de consentimento; finalidade e minimização; direito de exportar e excluir todos os dados; registro de operações de tratamento.
- Open Finance: consentimento por instituição, com prazo e revogação visíveis no sistema.
- Criptografia em repouso e em trânsito; chaves gerenciadas; backups cifrados.
- Autenticação forte (MFA); sessões curtas; log de acesso.
- Não persistir credenciais bancárias, PAN completo ou CVV.
- Envio de imagens e textos a serviços de IA/OCR de terceiros: avaliar contratos, retenção de dados e possibilidade de mascarar dados sensíveis (CPF, conta) antes do envio.
- Validação de assinatura dos webhooks e proteção contra reenvio (idempotência).

## 12. Roteiro de entrega (fases)

Fase 0 - Fundamentos (1 a 2 semanas)
- Decisões do item 2 (canal WhatsApp, agregador, hospedagem), modelo de dados, ambiente e CI.

Fase 1 - MVP manual assistido (3 a 4 semanas)
- Cadastro de contas e cartões; lançamento por mensagem de texto no WhatsApp (Cloud API); importação OFX/CSV; classificação por regras + modelo de linguagem; fila de revisão; dashboard visão geral e por categoria.
- Critério de aceite: 90% dos lançamentos de texto classificados corretamente após o período de aprendizado, e nenhum lançamento duplicado em conciliação de teste.

Fase 2 - Captura multimodal (3 a 4 semanas)
- Foto de comprovante e QR Code de NFC-e; PDF de fatura; PIX; deduplicação entre fontes; separação transferência x gasto; parcelas.

Fase 3 - Open Finance e automação (3 a 5 semanas)
- Integração com agregador, sincronização periódica, conciliação automática, detecção de recorrência e assinaturas, alertas.

Fase 4 - Análise comportamental e metas (3 a 4 semanas)
- Mapa de calor/calendário de gastos, orçamento, metas e cenários, projeção de fluxo de caixa, relatórios PDF/planilha.

Fase 5 - Evolução (contínua)
- Itens de média e baixa prioridade do item 10, app móvel, modo família.

## 13. Métricas de sucesso

- Percentual de lançamentos capturados sem digitação manual.
- Acurácia de classificação (antes e depois da revisão do usuário).
- Taxa de duplicidade e de conciliação.
- Tempo entre o gasto e o registro.
- Taxa de poupança e aderência ao orçamento (efeito sobre o comportamento).

## 14. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Banimento por uso de API não oficial do WhatsApp | Usar Cloud API oficial; importar histórico por exportação |
| Erro de OCR ou de interpretação | Score de confiança, confirmação do usuário, anexo original sempre guardado |
| Dupla contagem (compra + fatura) | Tipo "transferência" e conciliação |
| Custo de agregador e de modelos de IA | Prova de conceito; cache; processar em lote; opção de importação manual |
| Vazamento de dados | Item 11; minimização e criptografia |
| Simulações vistas como recomendação | Avisos claros; parâmetros e premissas explícitos |

## 15. Perguntas em aberto para o usuário

1. Aceita usar um número dedicado de WhatsApp (Cloud API) em vez de ler a conversa pessoal?
2. Quais bancos e cartões usa (para verificar cobertura no Open Finance)?
3. Uso individual ou com cônjuge/família?
4. Preferência de hospedagem (nuvem própria, local) e orçamento mensal para custos de API/agregador?
5. Quais são as metas iniciais e o prazo (reserva, imóvel, aposentadoria)?
6. Há histórico de conversa no WhatsApp ou planilhas a migrar?

## Fontes consultadas

- [Mobills - Apps de controle financeiro](https://www.mobills.com.br/blog/apps-de-controle-financeiro/)
- [Serasa - Aplicativos de controle financeiro](https://www.serasa.com.br/blog/aplicativo-controle-financeiro/)
- [Belvo - Aggregation Brasil (consentimento, vínculo, dados)](https://developers.belvo.com/products/aggregation_brazil/aggregation-brazil-introduction)
- [WhatsApp Business - Webhooks](https://whatsappbusiness.com/pt-br/blog/how-to-use-webhooks-from-whatsapp-business-api/)
- [Aurora Inbox - Guia técnico de webhook do WhatsApp Business](https://www.aurorainbox.com/pt/configurar-webhook-whatsapp-business-guia-tecnica/)

Observação: as fontes de WhatsApp são de provedores terceiros, e os detalhes de payload e requisitos devem ser confirmados na documentação oficial da Meta. As referências normativas citadas (LGPD, Resolução CVM 20/2021) devem ser revisadas na íntegra antes de qualquer implementação ou uso comercial.
