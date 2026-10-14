// Copia o binario WebAssembly do sql.js para public/, de onde a previa web o carrega.
const fs = require("fs");
const path = require("path");
const origem = path.join(__dirname, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const destino = path.join(__dirname, "..", "public", "sql-wasm.wasm");
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.copyFileSync(origem, destino);
console.log("sql-wasm.wasm copiado para public/");
