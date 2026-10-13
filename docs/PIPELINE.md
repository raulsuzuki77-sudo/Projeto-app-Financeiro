# Pipeline do projeto

Atualizado em 13/10/2026.

## Pendência escolhida como prioritária: T2 Implantação

Critério: valor entregue ao usuário por unidade de risco. Hoje o backend e o aplicativo existem e passam nos testes, mas nada disso é usável no dia a dia enquanto não houver um servidor sempre ligado, acessível com segurança pelo iPhone, com backup. Todas as demais tarefas (metas, alertas, WhatsApp) só geram valor depois disso. Em segundo lugar vêm as metas e cenários, que foram pedidas explicitamente no escopo original e não dependem de nenhuma decisão externa.

## Ordem de execução

| # | Tarefa | Depende de | Entradas do usuário | Critério de aceite |
|---|---|---|---|---|
| T1 | Comprovante PIX real | - | feito (comprovante enviado) | Valor, destino, data, hora, ID e forma de pagamento lidos corretamente do comprovante real; testes com dados fictícios |
| T2 | Implantação (Docker, HTTPS ou VPN, backup) | - | escolher hospedagem A ou B | `docker compose up` sobe a API; iPhone registra um gasto no servidor; backup diário cifrado restaurado com sucesso em teste |
| T3 | Metas e cenários de investimento | - | metas, prazos, perfil de risco | Reserva de emergência calculada sobre despesas essenciais reais; aporte necessário por meta e cenário; premissas editáveis e datadas; aviso de simulação; tela no aplicativo; testes dos cálculos contra valores conferidos à mão |
| T4 | Orçamento e alertas | T2 | limites desejados por categoria | Orçamento 50/30/20 e por categoria; alertas de estouro, assinatura nova, cobrança duplicada, custo de juros do rotativo; compromisso de parcelas futuras |
| T5 | WhatsApp em produção | T2 | número de bot e credenciais da Meta (por variável de ambiente, nunca pelo chat) | Mensagem enviada do número autorizado vira lançamento e a resposta chega ao WhatsApp; foto e PDF recebidos pelo WhatsApp passam pelo OCR |
| T6 | Open Finance, prova de conceito | T2 | bancos usados, aceite de custo | Comparação de agregadores com custo e cobertura; sincronização de uma conta; conciliação com lançamentos existentes sem duplicar |
| T7 | Segurança, LGPD e qualidade | T2 | - | Revisão de segurança; exportar e excluir todos os dados; limite de tentativas; criptografia de anexos; notificações; modo offline |

## Regras de execução de cada tarefa

1. Marcar a tarefa como em andamento e declarar o que será entregue e o que não será.
2. Testes automatizados escritos junto com o código; nenhuma afirmação de funcionamento sem teste ou execução.
3. Tudo que não puder ser verificado no ambiente de desenvolvimento é registrado explicitamente como não verificado (ver `docs/IMPLANTACAO.md` como exemplo).
4. Dados pessoais reais (comprovantes, faturas) são usados só para validar e nunca versionados; fixtures usam dados fictícios.
5. Commit pequeno e descritivo, publicação na branch de desenvolvimento, documentação atualizada em `docs/DECISOES.md`.
6. Uma tarefa só é dada como concluída com os critérios de aceite atendidos; o que sobrar vira nova tarefa.

## Estado

T1 concluída. T2 em andamento: artefatos prontos (Dockerfile, compose, Caddy, backup cifrado testado, guia); falta a decisão de hospedagem e a validação em servidor real. Próxima a executar sem depender de decisões: T3.
