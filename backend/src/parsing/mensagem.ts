import type { FormaPagamento, PrecisaoHorario, Tipo } from "../domain/types.js";
import { normalizar, paraCentavos } from "./text.js";
import { dataValida, paraLocal, somarDias } from "./tempo.js";

export interface MensagemInterpretada {
  tipo: Tipo;
  valor_centavos: number;
  descricao: string;
  forma_pagamento: FormaPagamento | null;
  cartao_apelido_norm: string | null;
  parcela_total: number | null;
  data_local: string;
  hora_local: number | null;
  precisao_horario: PrecisaoHorario;
}

export type ResultadoInterpretacao =
  | { ok: true; lancamento: MensagemInterpretada }
  | { ok: false; motivo: string };

const PAGAMENTO: [RegExp, FormaPagamento][] = [
  [/\bpix\b/, "pix"],
  [/\bdebito\b/, "debito"],
  [/\bcredito\b/, "credito"],
  [/\b(dinheiro|especie)\b/, "dinheiro"],
  [/\bboleto\b/, "boleto"],
];

const PALAVRAS_RECEITA = /\b(recebi|salario|recebimento|rendimento|reembolso|estorno)\b/;
const PALAVRAS_INVEST = /\b(investi|aporte|aportei|apliquei|aplicacao|tesouro|cdb)\b/;
const PALAVRAS_TRANSF = /\b(transferi|transferencia)\b/;

/**
 * Interpreta uma mensagem livre ("mercado 187,40 credito nubank ontem 19h").
 * Determinístico por desenho: o que não puder ser lido com segurança é recusado
 * (ou fica para o extrator por modelo de linguagem, plugado na Fase 2), nunca inventado.
 */
export function interpretarMensagem(
  texto: string,
  recebidoEm: Date,
  cartoesNorm: string[] = [],
): ResultadoInterpretacao {
  let resto = texto.trim();
  const agora = paraLocal(recebidoEm);

  // Data
  let data_local = agora.data_local;
  let dataInformada = false;
  const normOriginal = normalizar(resto);
  if (/\banteontem\b/.test(normOriginal)) {
    data_local = somarDias(agora.data_local, -2);
    dataInformada = true;
    resto = resto.replace(/anteontem/i, " ");
  } else if (/\bontem\b/.test(normOriginal)) {
    data_local = somarDias(agora.data_local, -1);
    dataInformada = true;
    resto = resto.replace(/ontem/i, " ");
  } else if (/\bhoje\b/.test(normOriginal)) {
    resto = resto.replace(/hoje/i, " ");
  }
  const mData = resto.match(/(?<![\d,.])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d,])/);
  if (mData) {
    const dia = Number(mData[1]);
    const mes = Number(mData[2]);
    let ano = mData[3] ? Number(mData[3]) : Number(agora.data_local.slice(0, 4));
    if (ano < 100) ano += 2000;
    if (!dataValida(ano, mes, dia)) return { ok: false, motivo: `Data invalida: ${mData[0]}` };
    data_local = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    if (!mData[3] && data_local > agora.data_local) {
      data_local = `${ano - 1}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    }
    dataInformada = true;
    resto = resto.replace(mData[0], " ");
  }

  // Hora
  let hora: number | null = null;
  let horaInformada = false;
  const mHora = resto.match(/(?:\bas\s+|\bàs\s+)?(?<!\d)(\d{1,2})(?:[:h](\d{2})?)(?:\s*(?:h|hs|horas))?(?![\d,.])/i);
  if (mHora && (mHora[0].includes(":") || /h/i.test(mHora[0]))) {
    const h = Number(mHora[1]);
    const mi = mHora[2] ? Number(mHora[2]) : 0;
    if (h > 23 || mi > 59) return { ok: false, motivo: `Horario invalido: ${mHora[0].trim()}` };
    hora = h;
    horaInformada = true;
    resto = resto.replace(mHora[0], " ");
  }

  // Parcelas ("3x", "em 3x")
  let parcela_total: number | null = null;
  const mParc = resto.match(/(?:\bem\s+)?(?<!\d)(\d{1,2})\s*x\b/i);
  if (mParc) {
    parcela_total = Number(mParc[1]);
    if (parcela_total < 2 || parcela_total > 48) return { ok: false, motivo: `Numero de parcelas invalido: ${mParc[0].trim()}` };
    resto = resto.replace(mParc[0], " ");
  }

  // Valor: aceita "R$ 1.234,56", "42,90", "42.90", "50 reais", "50"
  const candidatos = [...resto.matchAll(/(?:R\$\s*)?(?<![\d,.])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)(?![\d,.]|\s*(?:h\b|:))/gi)];
  const comMarca = candidatos.filter((m) => /R\$/i.test(m[0]) || /^\s*reais/i.test(resto.slice((m.index ?? 0) + m[0].length)));
  const escolhidos = comMarca.length ? comMarca : candidatos;
  if (escolhidos.length === 0) return { ok: false, motivo: "Nao encontrei o valor." };
  if (escolhidos.length > 1) {
    const distintos = new Set(escolhidos.map((m) => paraCentavos(m[1]!)));
    if (distintos.size > 1) return { ok: false, motivo: "Encontrei mais de um valor; informe apenas um." };
  }
  const escolhido = escolhidos[0]!;
  const valor_centavos = paraCentavos(escolhido[1]!);
  if (valor_centavos === null) return { ok: false, motivo: `Valor invalido: ${escolhido[1]}` };
  resto = resto.replace(escolhido[0], " ").replace(/\breais?\b/i, " ");

  // Forma de pagamento e cartão
  let normResto = normalizar(resto);
  let forma_pagamento: FormaPagamento | null = null;
  for (const [re, f] of PAGAMENTO) {
    if (re.test(normResto)) {
      forma_pagamento = f;
      normResto = normResto.replace(re, " ");
      break;
    }
  }
  let cartao_apelido_norm: string | null = null;
  for (const c of cartoesNorm) {
    const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(normResto)) {
      cartao_apelido_norm = c;
      normResto = normResto.replace(re, " ");
      if (!forma_pagamento) forma_pagamento = "credito";
      break;
    }
  }
  if (parcela_total && !forma_pagamento) forma_pagamento = "credito";

  // Tipo
  let tipo: Tipo = "despesa";
  const n = normalizar(texto);
  if (PALAVRAS_INVEST.test(n)) tipo = "investimento";
  else if (PALAVRAS_TRANSF.test(n)) tipo = "transferencia";
  else if (PALAVRAS_RECEITA.test(n)) tipo = "receita";

  const descricao = normResto.replace(/\b(de|da|do|em|no|na|as|a|o|e)\b(?=\s*$)/g, "").replace(/\s+/g, " ").trim();
  if (!descricao) return { ok: false, motivo: "Nao encontrei a descricao do gasto." };

  // Horário: informado = exato; só a data informada = desconhecido; nada informado = horário da mensagem.
  let precisao_horario: PrecisaoHorario;
  if (horaInformada) precisao_horario = "exato";
  else if (dataInformada && data_local !== agora.data_local) {
    hora = null;
    precisao_horario = "desconhecido";
  } else {
    hora = agora.hora_local;
    precisao_horario = "aproximado"; // o horario da mensagem pode diferir do horario da compra
  }

  return {
    ok: true,
    lancamento: { tipo, valor_centavos, descricao, forma_pagamento, cartao_apelido_norm, parcela_total, data_local, hora_local: hora, precisao_horario },
  };
}
