import type { Db } from "../db/tipos";

/**
 * Situação de um arquivo da pasta "00. Documentos financeiros":
 *  - importado: lido e gravado (não é lido de novo);
 *  - repetido: o conteúdo já havia sido importado por outro caminho (não é lido de novo);
 *  - ignorado: tipo de arquivo que o aplicativo não importa sozinho;
 *  - precisa_decisao: o aplicativo não pôde decidir sozinho (PDF com senha, fatura sem cartão, soma que não confere);
 *  - erro: a leitura falhou (tenta de novo na próxima abertura).
 */
export type StatusArquivoPasta = "importado" | "repetido" | "ignorado" | "precisa_decisao" | "erro";

export interface ArquivoDaPastaRegistro {
  caminho: string;
  tamanho: number;
  modificado: number;
  hash_arquivo: string | null;
  status: StatusArquivoPasta;
  mensagem: string | null;
  documento_id: number | null;
  processado_em: string;
}

/** Status que encerram o assunto: o arquivo, nessa versão, não é processado de novo. */
const DEFINITIVOS: StatusArquivoPasta[] = ["importado", "repetido", "ignorado"];

/** Esta versão do arquivo (caminho, tamanho e data de modificação) já foi tratada em definitivo? */
export function arquivoDaPastaResolvido(db: Db, usuarioId: string, caminho: string, tamanho: number, modificado: number): boolean {
  const r = db.prepare("SELECT status FROM arquivo_pasta WHERE usuario_id = ? AND caminho = ? AND tamanho = ? AND modificado = ?").get(usuarioId, caminho, tamanho, modificado) as { status: StatusArquivoPasta } | undefined;
  return !!r && DEFINITIVOS.includes(r.status);
}

export function registrarArquivoDaPasta(db: Db, usuarioId: string, a: { caminho: string; tamanho: number; modificado: number; hash_arquivo?: string | null; status: StatusArquivoPasta; mensagem?: string | null; documento_id?: number | null }): void {
  db.prepare(
    `INSERT INTO arquivo_pasta (usuario_id, caminho, tamanho, modificado, hash_arquivo, status, mensagem, documento_id, processado_em) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT (usuario_id, caminho, tamanho, modificado) DO UPDATE SET hash_arquivo = excluded.hash_arquivo, status = excluded.status, mensagem = excluded.mensagem, documento_id = excluded.documento_id, processado_em = excluded.processado_em`,
  ).run(usuarioId, a.caminho, Math.round(a.tamanho), Math.round(a.modificado), a.hash_arquivo ?? null, a.status, a.mensagem ?? null, a.documento_id ?? null, new Date().toISOString());
}

/** O que o aplicativo já fez com cada arquivo da pasta, do mais recente ao mais antigo. */
export function listarArquivosDaPasta(db: Db, usuarioId: string, limite = 200): ArquivoDaPastaRegistro[] {
  return db.prepare("SELECT caminho, tamanho, modificado, hash_arquivo, status, mensagem, documento_id, processado_em FROM arquivo_pasta WHERE usuario_id = ? ORDER BY processado_em DESC LIMIT ?").all(usuarioId, limite) as ArquivoDaPastaRegistro[];
}

/** Esquece o que foi feito com os arquivos da pasta (a próxima abertura os lê de novo; o conteúdo já importado continua sem duplicar). */
export function reiniciarRegistroDaPasta(db: Db, usuarioId: string): number {
  return db.prepare("DELETE FROM arquivo_pasta WHERE usuario_id = ?").run(usuarioId).changes;
}

/** Nome do arquivo de backup do mês: um por mês, atualizado enquanto o mês durar. */
export function nomeDoBackupMensal(mes: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error("Mês inválido (use AAAA-MM).");
  return `controle-financeiro-${mes}.cfbackup`;
}
