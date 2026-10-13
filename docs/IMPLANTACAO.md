> **Substituído em 13/10/2026.** O projeto passou a ser 100% local no iPhone (ver `docs/INSTALACAO_IPHONE.md`). Este documento só vale se um dia for retomado o servidor opcional (WhatsApp, Open Finance, sincronização).

# Implantação do servidor (T2)

Objetivo: o aplicativo do iPhone precisa de um servidor sempre ligado e acessível com segurança. Os dados financeiros ficam nele.

## Em linguagem simples

O aplicativo do iPhone é só a "tela". Os dados e os cálculos ficam em um programa (o servidor) que precisa estar ligado o tempo todo e que o iPhone consiga alcançar, de casa ou da rua. Hospedar é escolher onde esse programa roda:

- Em um computador seu (em casa): custo de compra zero se você já tiver o computador, mas ele precisa ficar ligado e conectado à internet.
- Em uma VPS: um computador virtual alugado de uma empresa, que fica ligado 24 horas e tem endereço fixo na internet. VPS significa servidor virtual privado. Você paga uma mensalidade, em geral em dólar ou euro.

## Custos e limitações (valores a conferir nas páginas oficiais, pois mudam)

| Item | Custo | Limitações |
|---|---|---|
| Computador próprio ou Raspberry em casa | Sem mensalidade; paga-se a energia e o equipamento, se ainda não existir | Se desligar ou cair a internet, o aplicativo para de funcionar; o backup precisa ser copiado para fora do equipamento por você; o equipamento fica sujeito a falha, roubo e queda de energia |
| Tailscale (rede privada, para acessar de fora de casa) | O plano pessoal gratuito, segundo o site da Tailscale, inclui até 6 usuários e dispositivos de usuário ilimitados, para uso não comercial; limites mudaram em 2026 e devem ser conferidos | O iPhone precisa ter o aplicativo Tailscale instalado e conectado; o endereço só funciona dentro da rede privada. O recurso Funnel, que expõe um endereço público, é necessário para o WhatsApp e tem limites próprios a conferir |
| Cloudflare Tunnel (endereço público sem abrir portas no roteador) | O uso básico é gratuito segundo fontes de terceiros; exige um domínio próprio (o domínio é pago, em geral por ano) e conta na Cloudflare, que pode pedir meio de pagamento | Depende de serviço de terceiro; confirmar limites na página oficial |
| VPS | Mensalidade. Referências de 2026 em fontes secundárias: Hetzner cerca de 4,50 a 6 euros por mês para planos pequenos, com reajuste em abril de 2026. Contabo e DigitalOcean variam. Há ofertas gratuitas (como a Oracle Cloud Always Free), mas não consegui confirmar as condições atuais | Cobrança em moeda estrangeira; você administra atualizações de segurança; os dados financeiros ficam em servidor de terceiro (o banco de dados e os backups são cifrados por você, mas a empresa hospeda a máquina); precisa de domínio para HTTPS com Caddy, ou usar Tailscale também na VPS |

## Como escolher

- Menor custo e dados em casa: computador próprio com Tailscale (gratuito). Limitação: depende do equipamento ligado.
- Sempre no ar e WhatsApp em produção sem depender do computador de casa: VPS pequena (basta 1 a 2 GB de memória e 20 GB de disco para uma pessoa; o OCR é a parte mais pesada, prefira 2 GB).
- Dica de escolha de VPS: região na Europa ou nos EUA funciona; escolha provedor com cobrança mensal sem fidelidade, backup de disco opcional, e confirme se aceita cartão de crédito brasileiro. Compare latência para o Brasil se isso incomodar (o aplicativo transfere pouco dado).

## Escolha de hospedagem (decisão do usuário)

| Opção | Como | Prós | Contras |
|---|---|---|---|
| A. Computador ou Raspberry em casa + Tailscale (recomendada) | Servidor em casa; o iPhone acessa por rede privada (VPN) | Nada exposto na internet pública; custo zero ou baixo; dados em casa | Depende de o equipamento ficar ligado e conectado; o webhook do WhatsApp (T5) precisa de endereço público, o que exige exposição pontual do endpoint `/webhooks/whatsapp` |
| B. VPS pequena com domínio + Caddy (HTTPS automático) | `docker compose --profile https up -d` | Sempre no ar; endereço público para o WhatsApp | Custo mensal; superfície pública exposta (mitigada por token, limite de corpo e HTTPS) |

Para a opção A, o comando `tailscale serve` publica a porta local com HTTPS dentro da rede privada; confirme a sintaxe vigente na documentação da Tailscale. O aplicativo aceita `https` em qualquer endereço e `http` apenas em redes locais privadas.

## Passo a passo (qualquer opção)

1. Instale Docker no servidor.
2. `cp backend/.env.example backend/.env` e preencha. Gere o token com `openssl rand -hex 24`. Preencha `WHATSAPP_NUMERO_AUTORIZADO` com o seu número (DDI+DDD+número, sem símbolos). O arquivo `.env` é ignorado pelo git; nunca o versione.
3. Opção A: `docker compose up -d`. Opção B: defina `DOMINIO` e `EMAIL_ACME` no ambiente e rode `docker compose --profile https up -d`.
4. No aplicativo, aba Ajustes: informe o endereço do servidor e o token.
5. Agende o backup diário cifrado (exemplo de cron, 3h da manhã):
   `0 3 * * * BACKUP_PASSPHRASE='...' docker compose -f /caminho/docker-compose.yml exec -T api /app/scripts/backup.sh`
   Copie periodicamente a pasta de backups para fora do servidor. Guarde a frase de cifragem em local separado: sem ela o backup não pode ser aberto. Teste a restauração (comando no final de `backend/scripts/backup.sh`).

## O que foi verificado e o que não foi

- Verificado: o script de backup (cópia consistente, cifragem, restauração e retenção) em teste automatizado e manual; a sintaxe do `docker-compose.yml`; o servidor iniciando e respondendo localmente.
- NÃO verificado: a construção da imagem Docker. O ambiente de desenvolvimento não tem o serviço do Docker em execução, então `docker build` não pôde ser executado. Rode `docker compose build` no servidor real e reporte qualquer erro.
- NÃO verificado: emissão de certificado do Caddy e o acesso pelo iPhone, que dependem do seu domínio e da sua rede.
