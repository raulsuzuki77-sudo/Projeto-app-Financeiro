# Instalação gratuita no iPhone, passo a passo (para quem nunca usou o Xcode)

Custo zero: usa o Xcode do seu MacBook e o seu Apple ID comum (gratuito). O aplicativo roda 100% no iPhone, sem servidor.

Aviso de confiabilidade: este roteiro foi escrito sem acesso a um Mac, ao Xcode nem à documentação da Apple. Os nomes de menus e telas vêm de conhecimento prévio e podem variar com a versão do Xcode e do macOS. Se algo na tela for diferente do descrito, me diga o que aparece (de preferência com uma captura de tela) e eu ajusto o caminho.

Tempo estimado na primeira vez: 1 a 2 horas, a maior parte esperando downloads.

## Parte 0. O que é cada coisa

- **Xcode**: programa gratuito da Apple que transforma o código em um aplicativo de iPhone e o instala no aparelho.
- **Terminal**: janela onde você digita comandos. Abra com Cmd+Espaço, digite "Terminal" e Enter.
- **Node.js e CocoaPods**: ferramentas que o projeto usa por baixo. O script da Parte 2 confere se estão instaladas.
- **Bundle ID**: o "nome único" do seu aplicativo no mundo (ex.: `br.com.joaosilva.controlefinanceiro`). A Apple exige que seja único; por isso você escolhe o seu.
- **Personal Team**: a "equipe" gratuita criada a partir do seu Apple ID, usada para assinar o aplicativo.

## Parte 1. Preparar o Mac (uma vez só)

1. **Xcode**: abra a App Store, procure "Xcode" e instale (é grande, vários GB; precisa de espaço livre). Depois abra o Xcode uma vez, aceite a licença e deixe instalar os componentes adicionais. Se ele oferecer baixar a plataforma ou o runtime do iOS, aceite.
2. **Ferramentas de linha de comando** (no Terminal): `xcode-select --install` (se disser que já estão instaladas, siga adiante). Depois confirme que o Terminal aponta para o Xcode:
   `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
3. **Node.js**: baixe a versão LTS em https://nodejs.org e instale. Confira com `node -v`. O projeto exige a versão 20.19.4 ou superior, 22.13 ou superior, ou 24.3 ou superior.
4. **CocoaPods**: `brew install cocoapods` (se usa Homebrew) ou `sudo gem install cocoapods`. Confira com `pod --version`.
5. **Git**: confira com `git --version`. Se não houver, o macOS oferece instalar.

## Parte 2. Baixar o projeto e prepará-lo (script automático)

No Terminal:

```
git clone <endereço do repositório no GitHub>
cd Projeto-app-Financeiro
git checkout claude/financial-control-system-plan-fl4o1k
cd app
./scripts/preparar-mac.sh br.com.SEUNOME.controlefinanceiro
```

Troque `SEUNOME` por algo seu, só com letras minúsculas e números (ex.: `br.com.joaosilva.controlefinanceiro`).

O que o script faz: confere Xcode, Node e CocoaPods e para com uma mensagem clara se algo faltar; instala as dependências (nas pastas `core` e `app`); grava o seu Bundle ID; gera o projeto do iOS; e anota onde está o Node para o Xcode achar. Ele **não** compila nem assina o aplicativo. Leva alguns minutos. No final, ele mostra o caminho do arquivo a abrir no Xcode.

Se der erro, copie a mensagem completa e me envie (veja a Parte 7).

## Parte 3. No Xcode: assinar e instalar no iPhone

1. Abra o arquivo `app/ios/ControleFinanceiro.xcworkspace` (dê duplo clique no Finder). Abra o **.xcworkspace**, não o .xcodeproj.
2. **Entrar com o Apple ID**: menu Xcode > Settings (em versões antigas, Preferences) > aba Accounts > botão "+" > Apple ID > entre com o seu Apple ID e senha. Feche a janela.
3. **Assinatura**: na coluna da esquerda, clique no item azul **ControleFinanceiro** (o primeiro). No centro, em TARGETS, selecione **ControleFinanceiro** > aba **Signing & Capabilities**. Marque "Automatically manage signing" e, em **Team**, escolha "seu nome (Personal Team)". Confirme que o Bundle Identifier é o que você definiu. Não deve restar mensagem de erro em vermelho nessa tela.
4. **Conectar o iPhone**: ligue o iPhone ao Mac por cabo, desbloqueie-o e toque em "Confiar neste computador". No Xcode, na barra do topo, escolha o seu iPhone na lista de dispositivos (ao lado do nome ControleFinanceiro). Na primeira vez o Xcode pode levar vários minutos em "Preparing"/"Processing symbol files"; espere terminar.
5. **Modo de Desenvolvedor no iPhone** (iOS 16 ou superior): Ajustes > Privacidade e Segurança > role até o fim > **Modo de Desenvolvedor** > ativar e reiniciar. Essa opção só aparece depois que o iPhone foi conectado ao Xcode pelo menos uma vez. Se não aparecer, tente a instalação do passo 7 e volte aqui quando o Xcode reclamar.
6. **Modo Release** (para o app funcionar sem o Mac ligado): menu Product > Scheme > **Edit Scheme...** > coluna esquerda **Run** > aba **Info** > **Build Configuration: Release** > Close. Se ficar em Debug, o aplicativo instalado exibirá erro ao abrir fora do Mac.
7. **Instalar**: clique no botão ▶ (Run) no canto superior esquerdo ou use Cmd+R. A primeira compilação demora (10 a 30 minutos é comum). Se o Mac pedir a senha para usar o "chaveiro" (keychain), digite e escolha "Sempre Permitir".
8. **Confiar no desenvolvedor no iPhone** (na primeira abertura): Ajustes > Geral > **VPN e Gerenciamento de Dispositivo** > toque no seu Apple ID, em "App do Desenvolvedor" > **Confiar**. Depois abra o aplicativo pelo ícone "Controle Financeiro".

## Parte 4. Primeiro uso (roteiro de verificação)

1. Ajustes: cadastre seu cartão (ex.: "nomad") e ative o bloqueio por Face ID.
2. Lançar: registre "teste 10 pix". Confira no Painel. Para apagar, abra a aba Revisar.
3. Ajustes > Backup cifrado: exporte um backup (senha de 10 ou mais caracteres) e salve no Arquivos/iCloud Drive. Restaure o mesmo arquivo para confirmar que funciona, **antes** de confiar seus dados ao aplicativo.
4. Lançar > Importar fatura (PDF ou foto), com a sua fatura real; leia a mensagem de conferência da soma.
5. Lançar > Fotografar comprovante, com um cupom e com um comprovante de PIX.

## Parte 5. Rotina semanal: renovar a cada 7 dias

Pelo que sei, o app instalado com Apple ID gratuito deixa de abrir após 7 dias. O ícone continua, mas o app fecha ao tocar. Para renovar (cerca de 2 minutos): conecte o iPhone, abra o `.xcworkspace` e clique em Run (Cmd+R) de novo. Instalar por cima preserva os dados.

- **Nunca apague o aplicativo do iPhone sem antes exportar um backup**: apagar remove o banco de dados.
- Antes de cada reinstalação, exporte um backup cifrado.
- Contas gratuitas têm limites de aplicativos e identificadores por semana; um único app costuma ficar dentro deles. Confirme as regras vigentes no site da Apple.

## Parte 6. Se mudar o Bundle ID ou atualizar o projeto

- Mudou o Bundle ID: rode de novo o script da Parte 2 com o novo identificador. **Atenção**: um Bundle ID diferente é outro aplicativo para o iOS, com banco de dados separado; exporte o backup antes e restaure no novo.
- Baixou uma versão nova do código: `git pull`, depois rode o script de novo (ele reinstala as dependências e regenera o projeto) e faça Run no Xcode. **Atenção**: regenerar o projeto apaga as configurações feitas no Xcode. Depois de rodar o script, refaça na Parte 3 o passo 3 (escolher o Team) e o passo 6 (Build Configuration: Release). O Apple ID e o iPhone já cadastrados continuam valendo.

## Parte 7. Erros comuns e como pedir ajuda

| O que aparece | O que fazer |
|---|---|
| `Signing for "ControleFinanceiro" requires a development team` | Parte 3, passo 3: escolher o Personal Team |
| `Failed to register bundle identifier` ou `No profiles for ... were found` | O Bundle ID já existe no mundo. Rode o script de novo com outro (ex.: acrescente números ao fim) |
| `Developer Mode disabled` | Parte 3, passo 5 |
| O iPhone não aparece na lista | Cabo, iPhone desbloqueado, "Confiar neste computador"; no Xcode, Window > Devices and Simulators mostra o estado |
| `Untrusted Developer` ao abrir o app | Parte 3, passo 8 |
| `node: command not found` na etapa "Bundle React Native code and images" | Confirme que existe `app/ios/.xcode.env.local` com uma linha `export NODE_BINARY=/caminho/do/node` (o script cria; `which node` mostra o caminho) |
| Erro de CocoaPods | `cd app/ios && pod install --repo-update` e tente de novo |
| Erro de compilação em `OcrNativoModule.swift` | Esse arquivo ainda não foi compilado por mim. Envie a mensagem completa (veja abaixo) |
| O app abre e fecha na hora | Rode pelo Xcode (Cmd+R) com o iPhone conectado e copie o texto que aparecer na área de console, embaixo |
| Console: `Application failed to launch: UIScene life cycle is required for apps built with this SDK` | O Xcode 27 exige o ciclo de vida por scenes, que o template do Expo SDK 57 ainda não traz. Corrigido pelo plugin `app/plugins/with-scene-lifecycle.js`: faça `git pull`, rode o script da Parte 2 de novo e refaça os passos de Team e Release da Parte 3 |
| O app parou de abrir depois de uns dias | Parte 5 |
| `No script URL provided` | Estava em Debug; use Release (Parte 3, passo 6) |

**Como me enviar um erro**: no Xcode, tecle Cmd+9 (Report navigator), clique na última compilação, expanda as linhas em vermelho, clique com o botão direito e escolha "Copy". Cole a mensagem completa no chat. Se o erro vier do Terminal, copie as últimas 40 linhas. Pode enviar capturas de tela também. Nunca envie a senha do Apple ID.

## O que NÃO foi verificado

O código foi escrito e testado em Linux, sem Xcode nem iPhone.

- Verificado: tipos, 50 testes do núcleo, o adaptador do SQLite com simulação da API do expo-sqlite, a geração do projeto iOS (`expo prebuild`), o reconhecimento do módulo nativo, a compilação do pacote JavaScript e a instalação das dependências a partir de um clone limpo do repositório.
- Não verificado: o script `preparar-mac.sh` em um Mac (só a sintaxe e a lógica de validação foram testadas em Linux), a compilação do Swift de OCR, a execução em aparelho (telas, câmera, Face ID, compartilhamento do backup), a qualidade do OCR do iOS nas suas faturas e a velocidade da cifragem em JavaScript.
