# Implantação do servidor (T2)

Objetivo: o aplicativo do iPhone precisa de um servidor sempre ligado e acessível com segurança. Os dados financeiros ficam nele.

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
