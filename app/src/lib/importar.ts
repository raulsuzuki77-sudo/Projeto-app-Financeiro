import * as Crypto from "expo-crypto";
import { concluirDocumento, descartarDocumento, documentoPorHash, formatarBRL, importarComprovante, importarFatura, importarTexto, lerCsv, reaplicarRegrasAosPendentes, registrarDocumento, versaoAnterior, type FormatoTexto, type RelatorioImportacao, type TipoDocumento } from "../../../core/src/index";
import { obterBanco } from "../data/banco";
import { lerBytes, lerTexto } from "./arquivos";
import { USUARIO } from "./api";
import { dataBR } from "./format";
import { reconhecerTexto } from "./ocr";

export type TipoImportacao = "extrato" | "fatura" | "comprovante";

const extensao = (nome: string) => (nome.split(".").pop() ?? "").toLowerCase();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** SHA-256 do conteudo do arquivo (hex completo): dois arquivos com o mesmo conteudo sao o mesmo documento. */
export async function hashDoArquivo(uri: string): Promise<string> {
  return hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await lerBytes(uri)));
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
  /** O arquivo já havia sido importado (mesmo conteúdo): nada foi alterado. */
  repetido?: boolean;
  documento_id?: number;
  /** Primeira e última data dos lançamentos lidos; a tela usa para perguntar se houve viagem no período. */
  periodo: { de: string; ate: string } | null;
}

export async function importarArquivo(arq: { uri: string; nome: string }, tipo: TipoImportacao, cartaoId: number | null, senhaPdf?: string | null, origem: "manual" | "pasta" = "manual"): Promise<ResultadoImportacaoApp> {
  const db = obterBanco();
  const ext = extensao(arq.nome);
  const hash = await hashDoArquivo(arq.uri);
  // Mesmo conteudo ja importado: nao processa de novo (e, se foi excluido do registro, volta a poder ser importado).
  const anterior = await Promise.resolve(documentoPorHash(db, USUARIO, hash));
  if (anterior) return { texto: `Este arquivo já foi importado em ${dataBR(anterior.importado_em.slice(0, 10))} («${anterior.nome}»). Nada foi alterado.`, periodo: null, repetido: true };
  const ctx = { usuario_id: USUARIO, cartao_id: cartaoId };

  const registrar = (t: TipoDocumento, formato: string) => registrarDocumento(db, { usuario_id: USUARIO, tipo: t, formato, nome: arq.nome, hash_arquivo: hash, cartao_id: cartaoId, origem });
  /** Fecha o documento e, se for nova versao de outro, avisa que os itens repetidos nao foram contados de novo. */
  const concluir = (doc: number, rel: RelatorioImportacao): string => {
    concluirDocumento(db, doc, { lidos: rel.lidos, criados: rel.criados, mesclados: rel.mesclados, ja_processados: rel.ja_processados, periodo: rel.periodo });
    const v = versaoAnterior(db, doc);
    return v ? ` Este arquivo parece uma nova versão de «${v.nome}» (importado em ${dataBR(v.importado_em.slice(0, 10))}): ${v.compartilhados} item(ns) já existiam e não foram contados de novo.` : "";
  };

  if (tipo === "extrato" || ext === "ofx" || ext === "csv" || ext === "txt") {
    const formato: FormatoTexto | null = ext === "ofx" ? "ofx" : ext === "csv" ? "csv" : ext === "txt" ? "fatura-texto" : null;
    if (!formato) throw new Error("Para extrato, escolha um arquivo OFX ou CSV.");
    const conteudo = await lerTexto(arq.uri);
    const tipoDoc: TipoDocumento = formato === "csv" ? (lerCsv(conteudo).formato === "nubank_cartao" || cartaoId !== null ? "fatura_cartao" : "extrato_conta") : formato === "ofx" ? "extrato_conta" : "fatura_cartao";
    const doc = registrar(tipoDoc, formato);
    let r;
    try {
      r = importarTexto(db, formato, conteudo, { ...ctx, documento_id: doc });
    } catch (e) {
      descartarDocumento(db, doc);
      throw e;
    }
    if (!r.ok) {
      descartarDocumento(db, doc);
      throw new Error(r.erro);
    }
    const versao = concluir(doc, r.relatorio);
    // Importar fora de ordem (setembro antes de agosto) nao pode custar classificacao: reaplica o que ja foi aprendido.
    reaplicarRegrasAosPendentes(db, USUARIO);
    const extras: string[] = [];
    if (r.formato_csv === "nubank_conta") extras.push("Formato reconhecido: extrato da conta Nubank.");
    if (r.formato_csv === "nubank_cartao") extras.push("Formato reconhecido: fatura do cartão Nubank.");
    if (r.rejeitadas?.length) extras.push(`${r.rejeitadas.length} linha(s) recusada(s): ${r.rejeitadas.slice(0, 3).map((x) => `linha ${x.linha} (${x.motivo})`).join("; ")}.`);
    if (r.conciliacao) extras.push(r.conciliacao.fecha ? `Soma confere com o total da fatura (${formatarBRL(r.conciliacao.total_declarado_centavos)}).` : `ATENÇÃO: soma dos itens (${formatarBRL(r.conciliacao.soma_itens_centavos)}) difere do total (${formatarBRL(r.conciliacao.total_declarado_centavos)}); tudo foi para revisão.`);
    return { texto: [resumo(r.relatorio), ...extras].join(" ") + versao, periodo: r.relatorio.periodo, documento_id: doc };
  }

  const linhas = await reconhecerTexto(arq.uri, senhaPdf);
  const id = hash.slice(0, 32);
  if (tipo === "fatura") {
    const doc = registrar("fatura_cartao", "pdf");
    let r;
    try {
      r = importarFatura(db, linhas, id, { ...ctx, documento_id: doc });
    } catch (e) {
      descartarDocumento(db, doc);
      throw e;
    }
    if (!r.ok) {
      descartarDocumento(db, doc);
      throw new Error(`${r.erro}${r.nao_lidas.length ? ` (${r.nao_lidas.length} linha(s) não lidas)` : ""}`);
    }
    const versao = concluir(doc, r.relatorio);
    const c = r.conciliacao;
    const conc = c ? (c.fecha ? `Soma confere com o total da fatura (${formatarBRL(c.total_declarado_centavos)}).` : `ATENÇÃO: a soma dos itens (${formatarBRL(c.soma_itens_centavos)}) difere do total declarado (${formatarBRL(c.total_declarado_centavos)}); todos os itens foram para revisão.`) : "Total da fatura não localizado para conferência.";
    return { texto: `${resumo(r.relatorio)} ${conc}${versao}`, periodo: r.relatorio.periodo, documento_id: doc };
  }
  const doc = registrar("comprovante", ext === "pdf" ? "pdf" : "foto");
  const c = importarComprovante(db, linhas.map((l) => l.texto), id, { ...ctx, documento_id: doc });
  if (!c.ok) {
    descartarDocumento(db, doc);
    throw new Error(c.erro);
  }
  const d = c.dados_lidos;
  const data = d.data_local ?? null;
  concluirDocumento(db, doc, { lidos: 1, criados: c.resultado === "criado" ? 1 : 0, mesclados: c.resultado === "mesclado" ? 1 : 0, ja_processados: c.resultado === "ja_processado" ? 1 : 0, periodo: data ? { de: data, ate: data } : null });
  return { texto: `Comprovante lido (${c.resultado}): ${d.estabelecimento}, ${formatarBRL(d.valor_centavos)}${d.data_local ? ` em ${d.data_local}` : ""}. Confira no botão de revisão do Início.`, periodo: data ? { de: data, ate: data } : null, documento_id: doc };
}
