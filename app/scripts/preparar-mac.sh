#!/usr/bin/env bash
# Prepara o projeto no Mac para compilar o aplicativo no Xcode.
# Uso (dentro da pasta app):  ./scripts/preparar-mac.sh br.com.SEUNOME.controlefinanceiro
# O identificador (bundle id) precisa ser unico no mundo; use algo com o seu nome.
# O script NAO compila nem assina o app: isso e feito no Xcode (passo a passo em docs/INSTALACAO_IPHONE.md).
set -euo pipefail

erro() { printf '\nERRO: %s\n' "$1" >&2; exit 1; }
ok()   { printf '  ok  %s\n' "$1"; }

validar_bundle() {
  local id="$1"
  [[ "$id" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]] || return 1   # letras, numeros, hifen e pontos; ao menos dois trechos
  [[ "$id" != com.example.* ]] || return 2                        # marcador do projeto, nao serve
  return 0
}

# Verifica se a versao do Node atende ao exigido pelo React Native 0.86: ^20.19.4 || ^22.13.0 || ^24.3.0 || >=25
node_ok() {
  local v="${1#v}" maj min pat
  IFS=. read -r maj min pat <<<"$v"
  if   (( maj >= 25 )); then return 0
  elif (( maj == 24 )); then (( min > 3 || (min == 3 && pat >= 0) ))
  elif (( maj == 22 )); then (( min > 13 || (min == 13 && pat >= 0) ))
  elif (( maj == 20 )); then (( min > 19 || (min == 19 && pat >= 4) ))
  else return 1; fi
}

principal() {
  local bundle="${1:-}"
  echo "Verificando o ambiente..."
  [[ "$(uname)" == "Darwin" ]] || erro "Este script e para macOS (voce esta em $(uname))."
  [[ -f app.json && -d ../core ]] || erro "Rode dentro da pasta 'app' do projeto (precisa existir ../core)."

  command -v xcodebuild >/dev/null || erro "Xcode nao encontrado. Instale pela App Store, abra uma vez e aceite a licenca."
  xcode-select -p | grep -q "Xcode.app" || erro "Aponte o Terminal para o Xcode: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  ok "Xcode: $(xcodebuild -version | head -1)"

  command -v node >/dev/null || erro "Node.js nao encontrado. Instale a versao LTS em https://nodejs.org"
  node_ok "$(node -v)" || erro "Node $(node -v) e antigo. O projeto exige 20.19.4+, 22.13+ ou 24.3+. Atualize em https://nodejs.org"
  ok "Node $(node -v)"

  command -v pod >/dev/null || erro "CocoaPods nao encontrado. Instale com: brew install cocoapods  (ou: sudo gem install cocoapods)"
  ok "CocoaPods $(pod --version)"

  [[ -n "$bundle" ]] || erro "Informe seu identificador unico. Exemplo: ./scripts/preparar-mac.sh br.com.joaosilva.controlefinanceiro"
  validar_bundle "$bundle" && rc=0 || rc=$?
  [[ $rc -ne 1 ]] || erro "Identificador invalido: use letras, numeros, hifens e pontos (ex.: br.com.joaosilva.controlefinanceiro)."
  [[ $rc -ne 2 ]] || erro "Troque 'com.example' por algo seu (ex.: br.com.joaosilva.controlefinanceiro)."
  ok "Identificador: $bundle"

  echo "Instalando dependencias (pode demorar alguns minutos)..."
  (cd ../core && npm install)
  npm install

  # Identificacao da versao, exibida no aplicativo (Mais opcoes > Backup e seguranca > Sobre esta versao).
  local build
  build="$(git -C .. rev-parse --short HEAD 2>/dev/null || true)"
  [[ -n "$build" ]] || build="$(tr -d '[:space:]' < ../BUILD.txt 2>/dev/null || true)"
  [[ -n "$build" ]] || build="desconhecida"
  ok "Versao do codigo: $build"

  echo "Gravando o identificador em app.json..."
  BUNDLE="$bundle" BUILD="$build" node -e '
    const fs = require("fs");
    const a = JSON.parse(fs.readFileSync("app.json", "utf8"));
    a.expo.ios.bundleIdentifier = process.env.BUNDLE;
    a.expo.extra = { ...(a.expo.extra || {}), build: process.env.BUILD };
    fs.writeFileSync("app.json", JSON.stringify(a, null, 2) + "\n");'

  echo "Gerando o projeto iOS (expo prebuild)..."
  npx expo prebuild --platform ios --clean

  # O Xcode nao herda o PATH do seu Terminal; sem isto, o passo que empacota o JavaScript pode falhar com "node: command not found".
  printf 'export NODE_BINARY=%s\n' "$(command -v node)" > ios/.xcode.env.local
  ok "Caminho do Node gravado em ios/.xcode.env.local"

  # Faz o botao Run do Xcode compilar em Release (o app instalado funciona sem o Mac ligado).
  # Melhor esforco: se o arquivo do scheme nao existir ou ja estiver em Release, nada muda.
  local scheme="ios/ControleFinanceiro.xcodeproj/xcshareddata/xcschemes/ControleFinanceiro.xcscheme"
  if [[ -f "$scheme" ]]; then
    sed -i '' '/<LaunchAction/,/>/ s/buildConfiguration = "Debug"/buildConfiguration = "Release"/' "$scheme" \
      && ok "Scheme configurado para Release" || echo "  aviso: nao consegui ajustar o scheme; use Product > Scheme > Edit Scheme > Run > Release"
  else
    echo "  aviso: scheme nao encontrado; use Product > Scheme > Edit Scheme > Run > Release"
  fi

  cat <<MSG

Pronto. Proximo passo: abra no Xcode o arquivo
  $(pwd)/ios/ControleFinanceiro.xcworkspace
(abra o .xcworkspace, NAO o .xcodeproj) e siga a parte 3 do guia docs/INSTALACAO_IPHONE.md.
MSG
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then principal "$@"; fi
