const ALFA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function paraBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += ALFA[(n >> 18) & 63]! + ALFA[(n >> 12) & 63]! + (i + 1 < b.length ? ALFA[(n >> 6) & 63]! : "=") + (i + 2 < b.length ? ALFA[n & 63]! : "=");
  }
  return s;
}

export function deBase64(s: string): Uint8Array {
  const limpo = s.replace(/[\s]/g, "");
  if (limpo.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(limpo)) throw new Error("base64 invalido");
  const pad = limpo.endsWith("==") ? 2 : limpo.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((limpo.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < limpo.length; i += 4) {
    const n = (ALFA.indexOf(limpo[i]!) << 18) | (ALFA.indexOf(limpo[i + 1]!) << 12) | ((limpo[i + 2] === "=" ? 0 : ALFA.indexOf(limpo[i + 2]!)) << 6) | (limpo[i + 3] === "=" ? 0 : ALFA.indexOf(limpo[i + 3]!));
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
