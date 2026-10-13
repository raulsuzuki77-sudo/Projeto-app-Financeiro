# Instalação gratuita no iPhone (sem conta paga da Apple)

Custo zero: usa o Xcode do seu MacBook e um Apple ID gratuito. O aplicativo roda 100% no iPhone, sem servidor.

Todas as informações sobre as regras da Apple abaixo vêm de conhecimento prévio e não puderam ser conferidas neste ambiente (a documentação oficial não estava acessível). Confirme no site da Apple se algo divergir.

## O que você precisa

- MacBook com Xcode (gratuito na App Store), Node.js (versão LTS) e CocoaPods.
- iPhone com iOS 16.4 ou superior, cabo USB.
- Seu Apple ID comum (gratuito).
- O iPad M3 não compila apps; ele serve só como segundo aparelho de teste (com dados separados).

## Passo a passo

1. No Mac, instale o Xcode, abra-o uma vez e aceite a licença. Instale o CocoaPods (`brew install cocoapods`, se usar Homebrew).
2. Baixe o projeto e a branch de desenvolvimento:
   `git clone <endereço do repositório>` e `git checkout claude/financial-control-system-plan-fl4o1k`.
3. Instale as dependências, nas duas pastas (o aplicativo importa o código de `core`):
   `cd core && npm install` e depois `cd ../app && npm install`.
4. Em `app/app.json`, troque `ios.bundleIdentifier` por um identificador único seu, por exemplo `br.com.seunome.controlefinanceiro`. O valor atual (`com.example...`) é um marcador e pode conflitar.
5. Gere o projeto nativo: `npx expo prebuild --platform ios`. Isso também instala os Pods.
6. Abra `app/ios/ControleFinanceiro.xcworkspace` no Xcode.
   - Xcode > Settings > Accounts: adicione seu Apple ID.
   - Selecione o projeto, aba Signing & Capabilities: marque "Automatically manage signing" e escolha seu "Personal Team".
7. No iPhone: Ajustes > Privacidade e Segurança > Modo de Desenvolvedor (ativar; o aparelho reinicia). Conecte o cabo e toque em "Confiar neste computador".
8. Para uso diário, compile em modo Release, que embute o aplicativo e não depende do computador ligado:
   `cd app && npx expo run:ios --device --configuration Release`
   (ou, no Xcode, Product > Scheme > Edit Scheme > Run > Build Configuration: Release, e Cmd+R com o iPhone selecionado).
9. Na primeira abertura: Ajustes > Geral > VPN e Gerenciamento de Dispositivo > toque no seu Apple ID > Confiar.

## Limitação importante do modo gratuito: renovação a cada 7 dias

Pelo que sei, apps instalados com Apple ID gratuito têm a assinatura válida por 7 dias. Depois disso o ícone continua lá, mas o app não abre até ser instalado de novo pelo Xcode. Rotina semanal (cerca de 2 minutos): conecte o iPhone ao Mac e repita o passo 8.

- Instalar por cima do app existente preserva os dados. **Nunca apague o aplicativo do iPhone sem antes exportar um backup**: apagar remove o banco de dados.
- Antes de cada reinstalação, exporte um backup cifrado (Ajustes > Backup cifrado) e guarde no iCloud Drive ou no Mac.
- Existem limites de quantidade de apps e de identificadores por semana para contas gratuitas; o uso de um único app costuma ficar dentro deles.

## Primeiro uso (roteiro de verificação)

1. Ajustes: cadastre seu cartão (ex.: "nomad") e ative o bloqueio por Face ID.
2. Lançar: registre "teste 10 pix"; confira em Painel; exclua em Revisar se quiser.
3. Ajustes: exporte um backup (senha de 10+ caracteres) e salve no Arquivos. Restaure o mesmo arquivo para confirmar que funciona, **antes** de confiar seus dados ao aplicativo.
4. Lançar > Importar fatura (PDF ou foto) com um PDF real; veja a mensagem de conferência da soma.
5. Lançar > Fotografar comprovante com um cupom e com um comprovante de PIX.

## O que NÃO foi verificado (preciso do seu retorno)

Este código foi escrito e testado em Linux, sem Xcode nem iPhone. Verificado: tipos, 50 testes do núcleo, a tradução do adaptador do SQLite com simulação da API do expo-sqlite, a geração do projeto iOS (`expo prebuild`), o reconhecimento do módulo nativo pelo autolinking e a compilação do pacote JavaScript. Não verificado:

- A compilação do módulo nativo de OCR em Swift (`app/modules/ocr-nativo/ios/OcrNativoModule.swift`). Se o Xcode apontar erro, envie a mensagem completa para eu corrigir.
- A qualidade real do OCR do iOS (Vision) nas suas faturas e fotos; a validação feita com Tesseract não vale automaticamente para o Vision.
- O funcionamento em aparelho: telas, câmera, seletor de arquivos, Face ID, compartilhamento do backup, e o desempenho da cifragem (feita em JavaScript, pode levar alguns segundos).
- Recursos do motor JavaScript do iPhone (Hermes): evitei `Intl` e `TextDecoder`, mas só o aparelho confirma.
