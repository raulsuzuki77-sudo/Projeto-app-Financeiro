#!/usr/bin/env bash
# Backup diario cifrado do banco. Agende com cron, por exemplo: 0 3 * * * /caminho/backup.sh
# Variaveis: DB_PATH (padrao /data/dados.db), BACKUP_DIR (padrao /data/backups), BACKUP_PASSPHRASE (obrigatoria).
set -euo pipefail
: "${BACKUP_PASSPHRASE:?Defina BACKUP_PASSPHRASE (guarde-a em local seguro: sem ela o backup nao abre)}"
DB_PATH="${DB_PATH:-/data/dados.db}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
cd "$(dirname "$0")/.."
arq="$(npx tsx src/backup.ts "$DB_PATH" "$BACKUP_DIR" 14)"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$arq" -out "$arq.enc" -pass env:BACKUP_PASSPHRASE
chmod 600 "$arq.enc"
rm -f "$arq"
echo "$arq.enc"
# Restaurar: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in dados-XXXX.db.enc -out dados.db -pass env:BACKUP_PASSPHRASE
