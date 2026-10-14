// Prepara os arquivos estaticos da previa web em public/ (nao versionados, ver .gitignore):
//  - sql-wasm.wasm: binario WebAssembly do sql.js (banco no navegador);
//  - ocr/: worker, nucleo (wasm) e idioma portugues do tesseract.js, servidos do mesmo endereco do app (offline, sem CDN).
const fs = require("fs");
const path = require("path");

const raiz = path.join(__dirname, "..");
const modulos = path.join(raiz, "node_modules");
const publico = path.join(raiz, "public");

function copiar(origem, destino) {
  if (!fs.existsSync(origem)) throw new Error("Arquivo nao encontrado: " + path.relative(raiz, origem) + " (rode npm install)");
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origem, destino);
  return fs.statSync(destino).size;
}

copiar(path.join(modulos, "sql.js", "dist", "sql-wasm.wasm"), path.join(publico, "sql-wasm.wasm"));
console.log("sql-wasm.wasm copiado para public/");

// O createWorker('por', 1) usa o nucleo "lstm" (com SIMD quando o navegador suporta); cada .wasm.js ja embute o wasm.
const ocr = path.join(publico, "ocr");
fs.rmSync(ocr, { recursive: true, force: true });
const arquivos = [
  [["tesseract.js", "dist", "worker.min.js"], "worker.min.js"],
  [["tesseract.js-core", "tesseract-core-simd-lstm.wasm.js"], "tesseract-core-simd-lstm.wasm.js"],
  [["tesseract.js-core", "tesseract-core-lstm.wasm.js"], "tesseract-core-lstm.wasm.js"],
  [["@tesseract.js-data", "por", "4.0.0_best_int", "por.traineddata.gz"], "por.traineddata.gz"],
];
let total = 0;
for (const [origem, nome] of arquivos) total += copiar(path.join(modulos, ...origem), path.join(ocr, nome));
console.log("ocr/ copiado para public/ (" + (total / 1048576).toFixed(1) + " MB)");
