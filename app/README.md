# Aplicativo iPhone (Expo / React Native, TypeScript)

Telas: Lancar (texto livre, foto de comprovante, importar fatura), Revisar (pendentes), Painel (resumo do mes),
Gastos (calendario por dia e mapa de calor por dia da semana e faixa de horario), Ajustes (servidor e token).

## Rodar em desenvolvimento

1. Suba o backend (veja `../backend/README.md`) em um computador na mesma rede do iPhone, escutando em `HOST=0.0.0.0`
   (ou use um servidor com https).
2. `cd app && npm install && npx expo start`
3. No iPhone, abra o Expo Go (ou um development build) e leia o QR code. Confirme na documentacao do Expo se a versao
   do Expo Go da App Store ja suporta o SDK 57; caso contrario use um development build.
4. Aba Ajustes: informe o endereco (ex.: `http://192.168.0.10:3000`) e o `API_TOKEN`. Fora da rede local o aplicativo
   exige `https`.

## Verificacoes

    npm run typecheck
    npm test
    npx expo export --platform ios     # compila o bundle iOS (nao exige macOS)

## Distribuicao (TestFlight / App Store)

Exige conta do Apple Developer Program (paga). Antes: troque `ios.bundleIdentifier` em `app.json`
(o valor atual, `com.example.controlefinanceiro`, e um marcador), depois `npx eas-cli@latest build --platform ios`.

## Limitacoes conhecidas

- Nao foi executado em aparelho nem em simulador iOS neste ambiente; foram validados tipos, testes de logica e a
  compilacao do bundle iOS.
- Fotos em HEIC: o servidor aceita PNG e JPEG. A camera do aplicativo entrega JPEG; da galeria, fotos HEIC sao recusadas
  com mensagem.
- Sem notificacoes e sem modo offline nesta versao.
