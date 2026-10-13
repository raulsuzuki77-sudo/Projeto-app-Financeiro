> Servidor OPCIONAL, hoje fora do caminho principal: o aplicativo roda sem ele. A logica de negocio mora em `../core`.

# Backend (Fase 1)

Requisitos: Node 22 ou superior. Para OCR: `apt install tesseract-ocr tesseract-ocr-por poppler-utils`.

    npm install
    npm test            # 27 testes (os de OCR exigem tesseract)
    npm run typecheck
    API_TOKEN=$(openssl rand -hex 24) npm start

Variáveis: `API_TOKEN` (obrigatória, 24+ caracteres), `DB_PATH`, `PORT`, `HOST` (padrão 127.0.0.1), `USUARIO_ID`,
`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_NUMERO_AUTORIZADO`.

Nunca versione o banco `.db` nem arquivos reais de extrato/fatura (`.gitignore` já bloqueia).

Exemplos (com `Authorization: Bearer $API_TOKEN`):

    POST /api/mensagens              {"texto":"mercado 187,40 credito nomad"}
    POST /api/importacoes/ofx        (text/plain)    também csv e fatura-texto
    POST /api/importacoes-arquivo?tipo=fatura|comprovante   (application/pdf, image/png, image/jpeg)
    GET  /api/dashboard/resumo?mes=2026-10
    GET  /api/dashboard/mapa-calor?de=2026-10-01&ate=2026-10-31
    GET  /api/dashboard/calendario?mes=2026-10
    PATCH /api/lancamentos/:id       {"categoria":"lazer_passeios"}   (a correção é aprendida)

Comandos de mensagem: `/desfazer`, `/resumo`, `sim`, `categoria <nome>`.
