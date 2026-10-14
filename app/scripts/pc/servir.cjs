// Servidor local minimo para a versao web (computador). Sem dependencias: so o Node.js.
// Atende apenas o proprio computador (127.0.0.1); nada e enviado a servidores externos.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const raiz = path.join(__dirname, "app");
const tipos = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".png": "image/png",
  ".ico": "image/x-icon", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".map": "application/json",
};

const servidor = http.createServer((req, res) => {
  let rel;
  try {
    rel = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let arquivo = path.normalize(path.join(raiz, rel));
  if (!arquivo.startsWith(raiz)) {
    res.writeHead(403).end();
    return;
  }
  // rotas do aplicativo (ex.: /importar) caem no index.html
  if (!fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) arquivo = path.join(raiz, "index.html");
  const cab = { "content-type": tipos[path.extname(arquivo)] || "application/octet-stream", "cache-control": "no-cache" };
  if (arquivo.endsWith(".gz")) cab["content-type"] = "application/octet-stream";
  res.writeHead(200, cab);
  fs.createReadStream(arquivo).pipe(res);
});

function abrir(url) {
  const cmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => undefined);
}

function ouvir(porta, tentativas) {
  servidor.once("error", (e) => {
    if (e.code === "EADDRINUSE" && tentativas > 0) return ouvir(porta + 1, tentativas - 1);
    console.error("Nao foi possivel iniciar o servidor:", e.message);
    process.exit(1);
  });
  servidor.listen(porta, "127.0.0.1", () => {
    // O endereco (inclusive a porta) define onde os dados ficam gravados no navegador: se a porta mudar, os dados "somem" da vista.
    const url = `http://localhost:${porta}`;
    console.log(`Controle Financeiro aberto em ${url}`);
    if (porta !== 8123) console.log(`Aviso: a porta 8123 estava ocupada; os dados deste endereco sao separados dos da porta 8123.`);
    console.log("Deixe esta janela aberta enquanto usa o aplicativo. Feche-a (ou tecle Ctrl+C) para encerrar.");
    abrir(url);
  });
}

ouvir(8123, 5);
