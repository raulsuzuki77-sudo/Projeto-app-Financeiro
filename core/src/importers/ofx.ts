import type { ItemImportado } from "./comum";

function campo(bloco: string, tag: string): string | undefined {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  return m?.[1]?.trim();
}

/** Lê OFX (SGML 1.x ou XML 2.x) de conta corrente ou cartão. Valor com sinal: negativo = saída. */
export function lerOfx(conteudo: string): ItemImportado[] {
  const itens: ItemImportado[] = [];
  for (const m of conteudo.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi)) {
    const b = m[1]!;
    const dt = campo(b, "DTPOSTED");
    const amt = campo(b, "TRNAMT");
    if (!dt || !amt) continue;
    const d = dt.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!d) continue;
    const valor = Number(amt.replace(",", "."));
    if (!Number.isFinite(valor)) continue;
    itens.push({
      data_local: `${d[1]}-${d[2]}-${d[3]}`,
      descricao: (campo(b, "MEMO") ?? campo(b, "NAME") ?? "sem descricao").replace(/\s+/g, " "),
      valor_centavos: Math.round(valor * 100),
      referencia: campo(b, "FITID"),
    });
  }
  return itens;
}
