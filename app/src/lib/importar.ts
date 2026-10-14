import * as Crypto from "expo-crypto";
import { formatarBRL, importarComprovante, importarFatura, importarTexto, reaplicarRegrasAosPendentes, type FormatoTexto, type RelatorioImportacao } from "../../../core/src/index";
import { obterBanco } from "../data/banco";
import { lerBytes, lerTexto } from "./arquivos";
import { USUARIO } from "./api";
import { reconhecerTexto } from "./ocr";

export type TipoImportacao = "extrato" | "fatura" | "comprovante";

const extensao = (nome: string) => (nome.split(".").pop() ?? "").toLowerCase();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

async function identificadorDoArquivo(uri: string): Promise<string> {
  const bytes = await lerBytes(uri);
  return hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)).slice(0, 32);
}

function resumo(r: RelatorioImportacao): string {
  const partes = [`${r.lidos} itens lidos`, `${r.criados} novos`];
  if (r.mesclados) partes.push(`${r.mesclados} unidos a lançamentos existentes`);
  if (r.ja_processados) partes.push(`${r.ja_processados} já importados antes`);
  partes.push(`${r.pendentes} aguardando revisão`);
  return partes.join(", ") + ".";
}

/** Le o arquivo escolhido e importa. Devolve texto pronto para exibir. Erros de leitura viram excecao com mensagem clara. */
export interface ResultadoImportacaoApp {
  texto: string;
  /** Primeira e última data dos lançamentos lidos; a tela usa para perguntar se houve viagem no período. */
  periodo: { de: string; ate: string } | null;
}

export async function importarArquivo(arq: { uri: string; nome: string }, tipo: TipoImportacao, cartaoId: number | null, senhaPdf?: string | null): Promise<ResultadoImportacaoApp> {
  const db = obterBanco();
  const ext = extensao(arq.nome);
  const ctx = { usuario_id: USUARIO, cartao_id: cartaoId };

  if (tipo === "extrato" || ext === "ofx" || ext === "csv" || ext === "txt") {
    const formato: FormatoTexto | null = ext === "ofx" ? "ofx" : ext === "csv" ? "csv" : ext === "txt" ? "fatura-texto" : null;
    if (!formato) throw new Error("Para extrato, escolha um arquivo OFX ou CSV.");
    const r = importarTexto(db, formato, await lerTexto(arq.uri), ctx);
    if (!r.ok) throw new Error(r.erro);
    // Importar fora de ordem (setembro antes de agosto) nao pode custar classificacao: reaplica o que ja foi aprendido.
    reaplicarRegrasAosPendentes(db, USUARIO);
    const extras: string[] = [];
    if (r.formato_csv === "nubank_conta") extras.push("Formato reconhecido: extrato da conta Nubank.");
    if (r.formato_csv === "nubank_cartao") extras.push("Formato reconhecido: fatura do cartão Nubank.");
    if (r.rejeitadas?.length) extras.push(`${r.rejeitadas.length} linha(s) recusada(s): ${r.rejeitadas.slice(0, 3).map((x) => `linha ${x.linha} (${x.motivo})`).join("; ")}.`);
    if (r.conciliacao) extras.push(r.conciliacao.fecha ? `Soma confere com o total da fatura (${formatarBRL(r.conciliacao.total_declarado_centavos)}).` : `ATENÇÃO: soma dos itens (${formatarBRL(r.conciliacao.soma_itens_centavos)}) difere do total (${formatarBRL(r.conciliacao.total_declarado_centavos)}); tudo foi para revisão.`);
    return { texto: [resumo(r.relatorio), ...extras].join(" "), periodo: r.relatorio.periodo };
  }

  const linhas = await reconhecerTexto(arq.uri, senhaPdf);
  const id = await identificadorDoArquivo(arq.uri);
  if (tipo === "fatura") {
    const r = importarFatura(db, linhas, id, ctx);
    if (!r.ok) throw new Error(`${r.erro}${r.nao_lidas.length ? ` (${r.nao_lidas.length} linha(s) não lidas)` : ""}`);
    const c = r.conciliacao;
    const conc = c ? (c.fecha ? `Soma confere com o total da fatura (${formatarBRL(c.total_declarado_centavos)}).` : `ATENÇÃO: a soma dos itens (${formatarBRL(c.soma_itens_centavos)}) difere do total declarado (${formatarBRL(c.total_declarado_centavos)}); todos os itens foram para revisão.`) : "Total da fatura não localizado para conferência.";
    return { texto: `${resumo(r.relatorio)} ${conc}`, periodo: r.relatorio.periodo };
  }
  const c = importarComprovante(db, linhas.map((l) => l.texto), id, ctx);
  if (!c.ok) throw new Error(c.erro);
  const d = c.dados_lidos;
  return { texto: `Comprovante lido (${c.resultado}): ${d.estabelecimento}, ${formatarBRL(d.valor_centavos)}${d.data_local ? ` em ${d.data_local}` : ""}. Confira no botão de revisão do Início.`, periodo: d.data_local ? { de: d.data_local, ate: d.data_local } : null };
}
