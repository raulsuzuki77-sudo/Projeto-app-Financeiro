import { paraCentavos } from "../parsing/text.js";
import { dataValida } from "../parsing/tempo.js";
import type { ItemImportado } from "./comum.js";

function dividir(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]!;
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas;
    } else if (c === sep && !aspas) { out.push(atual); atual = ""; } else atual += c;
  }
  out.push(atual);
  return out.map((s) => s.trim());
}

function paraData(s: string): string | null {
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return dataValida(+m[1]!, +m[2]!, +m[3]!) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return dataValida(+m[3]!, +m[2]!, +m[1]!) ? `${m[3]}-${m[2]}-${m[1]}` : null;
  return null;
}

/** Valor com sinal: aceita "-1.234,56", "(50,00)", "R$ 10,00", "-12.50". */
function valorComSinal(s: string): number | null {
  const neg = /^-|^\(.*\)$/.test(s.trim());
  const limpo = s.replace(/[()\-+\s]/g, "");
  const c = paraCentavos(limpo);
  return c === null ? null : neg ? -c : c;
}

const COL_DATA = ["data", "date", "data lancamento", "data da compra"];
const COL_DESC = ["descricao", "descrição", "description", "historico", "histórico", "estabelecimento", "memo", "lancamento"];
const COL_VALOR = ["valor", "amount", "value", "valor (r$)"];

export interface ResultadoCsv {
  itens: ItemImportado[];
  rejeitadas: { linha: number; motivo: string }[];
}

/** CSV genérico com cabeçalho. Linhas inválidas são reportadas, nunca descartadas em silêncio. */
export function lerCsv(conteudo: string): ResultadoCsv {
  const linhas = conteudo.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) return { itens: [], rejeitadas: [{ linha: 1, motivo: "Arquivo sem dados" }] };
  const sep = (linhas[0]!.match(/;/g)?.length ?? 0) >= (linhas[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const cab = dividir(linhas[0]!, sep).map((c) => c.toLowerCase());
  const idx = (nomes: string[]) => cab.findIndex((c) => nomes.includes(c));
  const iD = idx(COL_DATA), iDesc = idx(COL_DESC), iV = idx(COL_VALOR);
  if (iD < 0 || iDesc < 0 || iV < 0) {
    return { itens: [], rejeitadas: [{ linha: 1, motivo: "Cabecalho deve conter colunas de data, descricao e valor" }] };
  }
  const itens: ItemImportado[] = [];
  const rejeitadas: ResultadoCsv["rejeitadas"] = [];
  linhas.slice(1).forEach((l, i) => {
    const c = dividir(l, sep);
    const data = paraData(c[iD] ?? "");
    const valor = valorComSinal(c[iV] ?? "");
    const desc = c[iDesc] ?? "";
    if (!data) return rejeitadas.push({ linha: i + 2, motivo: `Data invalida: "${c[iD] ?? ""}"` });
    if (valor === null) return rejeitadas.push({ linha: i + 2, motivo: `Valor invalido: "${c[iV] ?? ""}"` });
    if (!desc) return rejeitadas.push({ linha: i + 2, motivo: "Descricao vazia" });
    itens.push({ data_local: data, descricao: desc, valor_centavos: valor });
  });
  return { itens, rejeitadas };
}
