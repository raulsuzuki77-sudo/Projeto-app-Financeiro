import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { DeviceEventEmitter } from "react-native";
import { cifrar, decifrar, exportarDados, lerCsv, MENSAGEM_NAO_RECONHECIDO, nomeDoBackupMensal, normalizar, restaurarDados, TAMANHO_MIN_SENHA, type DumpDados } from "../../../core/src/index";
import PastaNativa, { type ArquivoDaPasta } from "../../modules/pasta-nativa/src/PastaNativaModule";
import { obterBanco } from "../data/banco";
import { EVENTO_DADOS_MUDARAM } from "../hooks/useDados";
import { api } from "./api";
import { lerTexto } from "./arquivos";
import { hashDoArquivo, importarArquivo } from "./importar";
import { lerArquivoDeExtrato, ErroPdfProtegido } from "./investimentos";
import { lerSenhaPdf } from "./senha-pdf";

/** Nome da pasta que o usuário escolhe em Arquivos; o aplicativo guarda a permissão e a lê sempre que abre. */
export const NOME_DA_PASTA = "00. Documentos financeiros";
/** Subpasta, dentro dela, onde ficam os backups mensais. */
export const SUBPASTA_BACKUPS = "Backups mensais";
const EXTENSOES = new Set(["csv", "ofx", "pdf"]);
const CHAVE_SENHA_BACKUP = "backup_automatico_senha";

export interface EstadoPasta {
  /** O módulo nativo existe (aplicativo instalado pelo Xcode); falso no Expo Go e na versão web. */
  disponivel: boolean;
  configurada: boolean;
  /** A permissão guardada ainda vale. */
  valida: boolean;
  nome: string;
}

export function estadoDaPasta(): EstadoPasta {
  if (!PastaNativa) return { disponivel: false, configurada: false, valida: false, nome: "" };
  const e = PastaNativa.estadoDaPasta();
  return { disponivel: true, ...e };
}

/** Abre o seletor de pastas do iOS. Devolve o nome da pasta, ou null se o usuário cancelar. */
export async function escolherPasta(): Promise<string | null> {
  if (!PastaNativa) throw new Error("A pasta de documentos só funciona no aplicativo instalado no iPhone (build com o Xcode).");
  try {
    return await PastaNativa.escolherPasta();
  } catch (e) {
    if (e instanceof Error && e.message.includes("PASTA_CANCELADA")) return null;
    throw e;
  }
}

export function esquecerPasta(): void {
  PastaNativa?.esquecerPasta();
}

export interface ResultadoSincronizacao {
  status: "ok" | "nao_configurada" | "sem_acesso" | "indisponivel";
  vistos: number;
  importados: number;
  repetidos: number;
  /** Arquivos que o aplicativo não decide sozinho (PDF com senha, fatura sem cartão, soma que não confere). */
  pendentes: number;
  erros: number;
  /** No iCloud Drive e ainda não baixados para o aparelho. */
  aguardando_download: number;
  mensagens: string[];
}

const vazio = (status: ResultadoSincronizacao["status"]): ResultadoSincronizacao => ({ status, vistos: 0, importados: 0, repetidos: 0, pendentes: 0, erros: 0, aguardando_download: 0, mensagens: [] });
const extensao = (nome: string) => (nome.split(".").pop() ?? "").toLowerCase();

/** O cartão Nubank é o dono dos CSV de fatura do Nubank: usa o cadastrado ou cria o apelido "nubank". */
async function cartaoNubank(): Promise<number> {
  const achado = (await api.cartoes()).find((c) => normalizar(c.apelido).includes("nubank"));
  return achado ? achado.id : await api.criarCartao({ apelido: "nubank" });
}

/** Fatura em PDF: o cartão vem do nome do arquivo, do texto ou, se houver um só cartão cadastrado, dele. */
async function cartaoDaFatura(nome: string, linhas: string[]): Promise<number | null> {
  const cartoes = await api.cartoes();
  const alvo = normalizar(`${nome} ${linhas.slice(0, 40).join(" ")}`);
  const pelosNomes = cartoes.filter((c) => alvo.includes(normalizar(c.apelido)));
  if (pelosNomes.length === 1) return pelosNomes[0]!.id;
  return cartoes.length === 1 ? cartoes[0]!.id : null;
}

type Desfecho = { status: "importado" | "repetido" | "precisa_decisao" | "erro"; mensagem: string; documento_id?: number; hash?: string };

async function processar(caminho: string, nome: string, uri: string): Promise<Desfecho> {
  const ext = extensao(nome);
  const hash = await hashDoArquivo(uri);
  const anterior = await api.documentoPorHash(hash);
  if (anterior) return { status: "repetido", mensagem: `Já importado antes («${anterior.nome}»).`, hash };

  if (ext === "csv" || ext === "ofx") {
    // O CSV de fatura do Nubank não traz o cartão: vai para o cartão Nubank.
    const cartaoId = ext === "csv" && lerCsv(await lerTexto(uri)).formato === "nubank_cartao" ? await cartaoNubank() : null;
    const r = await importarArquivo({ uri, nome }, "extrato", cartaoId, null, "pasta");
    return { status: r.repetido ? "repetido" : "importado", mensagem: r.texto, documento_id: r.documento_id, hash };
  }

  // PDF: primeiro vê se é extrato de investimento; senão, fatura de cartão.
  let senha: string | null = null;
  const tentar = async (s: string | null) => lerArquivoDeExtrato(uri, s);
  let leitura;
  try {
    leitura = await tentar(null);
  } catch (e) {
    if (!(e instanceof ErroPdfProtegido)) throw e;
    // PDF com senha: tenta as senhas já guardadas dos cartões (Chaveiro do iPhone).
    for (const c of await api.cartoes()) {
      const s = await lerSenhaPdf(c.id);
      if (!s) continue;
      try {
        leitura = await tentar(s);
        senha = s;
        break;
      } catch (e2) {
        if (!(e2 instanceof ErroPdfProtegido)) throw e2;
      }
    }
    if (!leitura) return { status: "precisa_decisao", mensagem: "PDF protegido por senha que o aplicativo não conhece. Abra Importar ou ajustar documentos e informe a senha.", hash };
  }
  const r = leitura.resultado;
  if (r.ok) {
    const c = r.extrato.conferencia;
    // Extrato de investimento so entra sozinho quando a soma das posicoes confere com o total que o proprio extrato declara.
    if (c.confere === false) return { status: "precisa_decisao", mensagem: "Extrato de investimentos cuja soma não confere com o total declarado. Abra a aba Liberdade, importe o extrato e confira antes de gravar.", hash };
    const g = await api.salvarExtratoInvestimento(r.extrato, leitura.hash);
    return { status: g.status === "ja_importado" ? "repetido" : "importado", mensagem: `Extrato de investimentos ${r.extrato.instituicao} (${r.extrato.periodo_fim.slice(0, 7)}) importado.`, hash };
  }
  if (r.erro !== MENSAGEM_NAO_RECONHECIDO) return { status: "erro", mensagem: r.erro, hash };

  const { reconhecerTexto } = await import("./ocr");
  const linhas = (await reconhecerTexto(uri, senha)).map((l) => l.texto);
  const cartaoId = await cartaoDaFatura(nome, linhas);
  if (cartaoId === null) return { status: "precisa_decisao", mensagem: "Fatura em PDF sem cartão identificado. Abra Importar ou ajustar documentos e escolha o cartão.", hash };
  const f = await importarArquivo({ uri, nome }, "fatura", cartaoId, senha, "pasta");
  return { status: f.repetido ? "repetido" : "importado", mensagem: f.texto, documento_id: f.documento_id, hash };
}

let emAndamento: Promise<ResultadoSincronizacao> | null = null;

/**
 * Lê a pasta "00. Documentos financeiros" e importa o que ainda não foi importado. Cada versão de arquivo (caminho, tamanho e data)
 * é tratada uma vez; o mesmo conteúdo em outro nome ou lugar não é contado de novo. Nunca lança: devolve o resumo.
 */
export function sincronizarPasta(): Promise<ResultadoSincronizacao> {
  if (!emAndamento) emAndamento = executar().finally(() => (emAndamento = null));
  return emAndamento;
}

async function executar(): Promise<ResultadoSincronizacao> {
  if (!PastaNativa) return vazio("indisponivel");
  const estado = PastaNativa.estadoDaPasta();
  if (!estado.configurada) return vazio("nao_configurada");
  if (!estado.valida) return { ...vazio("sem_acesso"), mensagens: ["A permissão da pasta deixou de valer. Escolha a pasta de novo em Mais opções, Pasta de documentos e backup."] };
  const res = vazio("ok");
  let lista: ArquivoDaPasta[];
  try {
    lista = await PastaNativa.listarArquivos();
  } catch (e) {
    return { ...vazio("sem_acesso"), mensagens: [e instanceof Error ? e.message : "Não foi possível ler a pasta."] };
  }
  const prefixoBackups = `${SUBPASTA_BACKUPS.toLowerCase()}/`;
  const candidatos = lista.filter((a) => !a.caminho.toLowerCase().startsWith(prefixoBackups)).sort((a, b) => a.caminho.localeCompare(b.caminho));
  for (const a of candidatos) {
    if (!EXTENSOES.has(extensao(a.nome))) continue; // outros tipos (imagens, planilhas) nao sao importados sozinhos
    res.vistos++;
    if (await api.arquivoDaPastaResolvido(a.caminho, a.tamanho, a.modificado)) continue;
    if (!a.disponivel) {
      res.aguardando_download++;
      continue;
    }
    let uri: string | null = null;
    try {
      uri = await PastaNativa.copiarParaCache(a.caminho);
      const d = await processar(a.caminho, a.nome, uri);
      await api.registrarArquivoDaPasta({ caminho: a.caminho, tamanho: a.tamanho, modificado: a.modificado, hash_arquivo: d.hash ?? null, status: d.status, mensagem: d.mensagem, documento_id: d.documento_id ?? null });
      if (d.status === "importado") res.importados++;
      else if (d.status === "repetido") res.repetidos++;
      else if (d.status === "precisa_decisao") res.pendentes++;
      else res.erros++;
      if (d.status === "importado" || d.status === "precisa_decisao" || d.status === "erro") res.mensagens.push(`${a.nome}: ${d.mensagem}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Falha ao importar.";
      await api.registrarArquivoDaPasta({ caminho: a.caminho, tamanho: a.tamanho, modificado: a.modificado, status: "erro", mensagem: m });
      res.erros++;
      res.mensagens.push(`${a.nome}: ${m}`);
    } finally {
      if (uri) PastaNativa.liberarCopia(uri);
    }
  }
  if (res.importados > 0) DeviceEventEmitter.emit(EVENTO_DADOS_MUDARAM);
  return res;
}

// ---------- backup mensal ----------

export async function senhaDoBackupAutomatico(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(CHAVE_SENHA_BACKUP);
  } catch {
    return null;
  }
}

/** Guarda a senha no Chaveiro do iPhone (só neste aparelho, sem sincronizar com o iCloud). Ela cifra os backups automáticos. */
export async function definirSenhaDoBackupAutomatico(senha: string | null): Promise<void> {
  if (senha === null) {
    await SecureStore.deleteItemAsync(CHAVE_SENHA_BACKUP);
    return;
  }
  if (senha.length < TAMANHO_MIN_SENHA) throw new Error(`A senha deve ter pelo menos ${TAMANHO_MIN_SENHA} caracteres.`);
  await SecureStore.setItemAsync(CHAVE_SENHA_BACKUP, senha, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export interface ResultadoBackupMensal {
  status: "feito" | "em_dia" | "sem_senha" | "sem_pasta" | "erro";
  mensagem: string;
  arquivo?: string;
}

const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dataLocalDe = (segundos: number) => {
  const d = new Date(segundos * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Backup cifrado dos dados na subpasta "Backups mensais" da pasta de documentos: um arquivo por mês (AAAA-MM), atualizado no máximo
 * uma vez por dia enquanto o mês durar; os dos meses anteriores ficam como estão. Por estar fora do aplicativo, sobrevive a
 * desinstalar o app ou a um banco corrompido. `forcar` ignora o "já feito hoje".
 */
export async function backupMensalNaPasta(forcar = false): Promise<ResultadoBackupMensal> {
  if (!PastaNativa) return { status: "sem_pasta", mensagem: "O backup na pasta só funciona no aplicativo instalado no iPhone." };
  const estado = PastaNativa.estadoDaPasta();
  if (!estado.configurada || !estado.valida) return { status: "sem_pasta", mensagem: "Escolha a pasta de documentos para guardar os backups mensais." };
  const senha = await senhaDoBackupAutomatico();
  if (!senha) return { status: "sem_senha", mensagem: "Defina a senha dos backups automáticos." };
  const mes = hojeLocal().slice(0, 7);
  const nome = nomeDoBackupMensal(mes);
  const caminho = `${SUBPASTA_BACKUPS}/${nome}`;
  try {
    if (!forcar) {
      const existente = (await PastaNativa.listarArquivos()).find((a) => a.caminho === caminho);
      if (existente && dataLocalDe(existente.modificado) === hojeLocal()) return { status: "em_dia", mensagem: `Backup de hoje já está na pasta (${nome}).`, arquivo: caminho };
    }
    const conteudo = await cifrar(JSON.stringify(exportarDados(obterBanco())), senha, (n) => Crypto.getRandomBytes(n));
    const temp = new File(Paths.cache, nome);
    temp.create({ overwrite: true });
    temp.write(conteudo);
    try {
      await PastaNativa.gravarNaPasta(SUBPASTA_BACKUPS, nome, temp.uri);
    } finally {
      try {
        temp.delete();
      } catch {
        /* limpeza best-effort */
      }
    }
    return { status: "feito", mensagem: `Backup de ${mes} gravado em «${SUBPASTA_BACKUPS}».`, arquivo: caminho };
  } catch (e) {
    return { status: "erro", mensagem: e instanceof Error ? e.message : "Não foi possível gravar o backup na pasta." };
  }
}

/** Backups encontrados na subpasta, do mais recente ao mais antigo. */
export async function listarBackupsDaPasta(): Promise<{ caminho: string; nome: string; modificado: number; tamanho: number }[]> {
  if (!PastaNativa || !PastaNativa.estadoDaPasta().valida) return [];
  const prefixo = `${SUBPASTA_BACKUPS.toLowerCase()}/`;
  return (await PastaNativa.listarArquivos()).filter((a) => a.caminho.toLowerCase().startsWith(prefixo) && a.nome.endsWith(".cfbackup")).sort((a, b) => b.nome.localeCompare(a.nome));
}

/** Restaura um backup da pasta, SUBSTITUINDO todos os dados atuais. Devolve o número de linhas restauradas. */
export async function restaurarBackupDaPasta(caminho: string, senha: string): Promise<number> {
  if (!PastaNativa) throw new Error("Disponível apenas no aplicativo instalado no iPhone.");
  const uri = await PastaNativa.copiarParaCache(caminho);
  try {
    const dump = JSON.parse(await decifrar(await new File(uri).text(), senha)) as DumpDados;
    const n = restaurarDados(obterBanco(), dump).linhas;
    DeviceEventEmitter.emit(EVENTO_DADOS_MUDARAM);
    return n;
  } finally {
    PastaNativa.liberarCopia(uri);
  }
}
