import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { deBase64, paraBase64 } from "../util/base64";
import { deUtf8, utf8 } from "../util/sha256";

/**
 * Cifragem de backup: AES-256-GCM (autenticada) com chave derivada da senha por PBKDF2-HMAC-SHA256.
 * Bibliotecas auditadas @noble/*, em JavaScript puro, portanto identicas em Node e no iPhone.
 * O cabecalho (parametros) e autenticado como dado associado: adulterar qualquer campo invalida o arquivo.
 * `aleatorio` e injetado (Node: crypto.randomBytes; iPhone: expo-crypto), pois nao ha RNG universal.
 */
export const ITERACOES_PADRAO = 210_000;
const ITER_MIN = 100_000;
const ITER_MAX = 2_000_000;
export const TAMANHO_MIN_SENHA = 10;

export interface Cabecalho {
  formato: "cf-backup";
  versao: 1;
  kdf: "pbkdf2-sha256";
  iteracoes: number;
  sal: string;
  nonce: string;
}

const aad = (c: Cabecalho) => utf8(`${c.formato}|${c.versao}|${c.kdf}|${c.iteracoes}|${c.sal}|${c.nonce}`);
/** Versao assincrona com cessao periodica ao laco de eventos: a tela nao congela durante o calculo no iPhone. */
const chave = (senha: string, sal: Uint8Array, iter: number) => pbkdf2Async(sha256, utf8(senha.normalize("NFKC")), sal, { c: iter, dkLen: 32, asyncTick: 10 });

export async function cifrar(texto: string, senha: string, aleatorio: (n: number) => Uint8Array, iteracoes = ITERACOES_PADRAO): Promise<string> {
  if (senha.length < TAMANHO_MIN_SENHA) throw new Error(`a senha deve ter ao menos ${TAMANHO_MIN_SENHA} caracteres`);
  const sal = aleatorio(16);
  const nonce = aleatorio(12);
  const cab: Cabecalho = { formato: "cf-backup", versao: 1, kdf: "pbkdf2-sha256", iteracoes, sal: paraBase64(sal), nonce: paraBase64(nonce) };
  const dados = gcm(await chave(senha, sal, iteracoes), nonce, aad(cab)).encrypt(utf8(texto));
  return JSON.stringify({ ...cab, dados: paraBase64(dados) });
}

export async function decifrar(arquivo: string, senha: string): Promise<string> {
  let o: Cabecalho & { dados: string };
  try {
    o = JSON.parse(arquivo);
  } catch {
    throw new Error("arquivo de backup invalido");
  }
  if (o?.formato !== "cf-backup" || o.versao !== 1 || o.kdf !== "pbkdf2-sha256" || typeof o.iteracoes !== "number" || typeof o.sal !== "string" || typeof o.nonce !== "string" || typeof o.dados !== "string") throw new Error("arquivo de backup invalido");
  if (!Number.isInteger(o.iteracoes) || o.iteracoes < ITER_MIN || o.iteracoes > ITER_MAX) throw new Error("parametros de cifragem fora do aceitavel");
  try {
    const sal = deBase64(o.sal);
    const nonce = deBase64(o.nonce);
    const claro = gcm(await chave(senha, sal, o.iteracoes), nonce, aad(o)).decrypt(deBase64(o.dados));
    return deUtf8(claro);
  } catch {
    // Senha errada e arquivo adulterado sao indistinguiveis por desenho (GCM); nao revelar qual.
    throw new Error("senha incorreta ou arquivo corrompido");
  }
}
