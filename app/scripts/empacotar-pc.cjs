// Gera a pasta/zip da VERSAO PARA COMPUTADOR (navegador). Uso: node scripts/empacotar-pc.cjs [saida.zip]
// Resultado: pasta com app/ (site estatico), servir.cjs e atalhos de abertura para macOS e Windows. Requer Node.js e, para o zip, o comando `zip`.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = path.join(__dirname, "..");
const saida = path.resolve(process.argv[2] || path.join(app, "dist-pc", "controle-financeiro-pc.zip"));
const pasta = path.join(path.dirname(saida), "controle-financeiro-pc");
const exportado = path.join(path.dirname(saida), ".export-web");

const sh = (c) => execSync(c, { cwd: app, stdio: "inherit", env: { ...process.env, EXPO_PUBLIC_DEMO: "" } });

fs.rmSync(pasta, { recursive: true, force: true });
fs.rmSync(exportado, { recursive: true, force: true });
fs.mkdirSync(pasta, { recursive: true });

sh("node scripts/preparar-web.cjs");
sh(`npx expo export --platform web --output-dir "${exportado}"`);
fs.cpSync(exportado, path.join(pasta, "app"), { recursive: true });
fs.rmSync(exportado, { recursive: true, force: true });
fs.copyFileSync(path.join(__dirname, "pc", "servir.cjs"), path.join(pasta, "servir.cjs"));

const comando = `#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e abra este arquivo de novo."
  read -n 1 -s -r -p "Tecle algo para fechar."
  exit 1
fi
node servir.cjs
`;
fs.writeFileSync(path.join(pasta, "Abrir Controle Financeiro.command"), comando, { mode: 0o755 });
fs.writeFileSync(
  path.join(pasta, "Abrir Controle Financeiro.bat"),
  `@echo off\r\ncd /d "%~dp0"\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.\r\n  pause\r\n  exit /b 1\r\n)\r\nnode servir.cjs\r\n`,
);
fs.writeFileSync(
  path.join(pasta, "LEIA-ME.txt"),
  `CONTROLE FINANCEIRO - VERSAO PARA COMPUTADOR (teste)

Como abrir
  macOS:   de duplo clique em "Abrir Controle Financeiro.command". Se o macOS bloquear (arquivo baixado), clique com o botao direito,
           escolha Abrir e confirme.
  Windows: de duplo clique em "Abrir Controle Financeiro.bat".
  Qualquer sistema com Node.js: no terminal, nesta pasta, rode: node servir.cjs
Requer o Node.js (versao LTS, https://nodejs.org). O navegador abre sozinho em http://localhost:8123 .
Deixe a janela do terminal aberta enquanto usa o aplicativo.

Onde ficam os dados
  Somente neste navegador, neste endereco (http://localhost:8123), no armazenamento do site (IndexedDB). Nada e enviado a servidores.
  Limpar os dados do site no navegador apaga tudo: exporte um backup cifrado antes (Mais opcoes > Backup e seguranca).
  Use sempre o mesmo navegador e o mesmo endereco. O backup exportado aqui pode ser restaurado no aplicativo do iPhone e vice-versa.

O que funciona e o que nao funciona aqui
  Funciona: importar extratos CSV/OFX (inclui os CSVs do Nubank), classificar, revisar, graficos, recorrentes, metas, backup.
  PDF e foto de fatura/comprovante: lidos no proprio navegador (PDF com texto, PDF de imagem e imagens JPG/PNG), inclusive PDF com senha.
  PDF de imagem leva em torno de 8 segundos por pagina (a primeira leitura carrega cerca de 5 MB); a tela fica ocupada nesse tempo.
  A qualidade do reconhecimento de imagem aqui (Tesseract) pode diferir da do iPhone (Vision): confira sempre a mensagem de conferencia da soma.
  Nao existe aqui: Face ID, Chaveiro (a senha do PDF so dura enquanto a pagina estiver aberta), camera e menu Compartilhar.
`,
);

fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.rmSync(saida, { force: true });
execSync(`zip -r -q "${saida}" controle-financeiro-pc`, { cwd: path.dirname(saida), stdio: "inherit" });
console.log(`Pacote gerado: ${saida}`);
