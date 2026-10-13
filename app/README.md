# Aplicativo iPhone (Expo / React Native, TypeScript), 100% local

Os dados ficam no banco SQLite do iPhone; os calculos rodam no aparelho, usando o nucleo compartilhado em `../core`.
Nao ha servidor. Instalacao gratuita via Mac: veja `../docs/INSTALACAO_IPHONE.md`.

Abas: Lancar (texto livre, foto de comprovante, fatura em PDF/foto, extrato OFX/CSV), Revisar (pendentes), Painel, Gastos
(calendario e mapa de calor por dia e horario), Metas (reserva, metas, cenarios, perfil de risco) e Ajustes (cartoes,
bloqueio por Face ID, backup cifrado).

## Desenvolvimento

    cd ../core && npm install     # o app importa o codigo de ../core
    cd ../app && npm install
    npm run typecheck
    npm test                      # testes de utilitarios do app; a logica de negocio e testada em ../core
    npx expo export --platform ios   # compila o pacote JavaScript (nao exige macOS)

O OCR usa um modulo nativo local (`modules/ocr-nativo`, Swift com Vision e PDFKit) e por isso exige um build nativo
(nao roda no Expo Go).

## Limitacoes conhecidas

- Nao foi executado em aparelho nem em simulador neste ambiente.
- Sem sincronizacao entre aparelhos, sem WhatsApp, sem Open Finance (o codigo do servidor opcional continua em `../backend`).
- Dados existem so no aparelho: faca backups cifrados com frequencia.
