import { useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { backupMensalNaPasta, estadoDaPasta, sincronizarPasta } from "../lib/pasta-documentos";
import { useToast } from "./toast";

const INTERVALO_MINIMO_MS = 15 * 60 * 1000;
const ESPERA_DO_BACKUP_MS = 6000;
let ultimaExecucao = 0;

/**
 * Sem tela: ao abrir o aplicativo (e ao voltar a ele depois de um tempo), lê a pasta "00. Documentos financeiros", importa o que
 * ainda não foi importado e, uma vez por dia, grava o backup mensal cifrado na subpasta de backups. Avisa só quando algo aconteceu.
 */
export function SincronizadorDaPasta() {
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelado = false;
    let espera: ReturnType<typeof setTimeout> | null = null;

    async function rodar() {
      if (Date.now() - ultimaExecucao < INTERVALO_MINIMO_MS) return;
      const estado = estadoDaPasta();
      if (!estado.disponivel || !estado.configurada) return;
      ultimaExecucao = Date.now();
      const r = await sincronizarPasta();
      if (cancelado) return;
      if (r.status === "sem_acesso") {
        toast({ texto: r.mensagens[0] ?? "Sem acesso à pasta de documentos.", acao: { rotulo: "Abrir", fazer: () => router.push("/pasta") } });
      } else if (r.importados > 0 || r.pendentes > 0 || r.erros > 0) {
        const partes: string[] = [];
        if (r.importados > 0) partes.push(`${r.importados} arquivo(s) importado(s) da pasta de documentos`);
        if (r.pendentes > 0) partes.push(`${r.pendentes} aguardando decisão sua`);
        if (r.erros > 0) partes.push(`${r.erros} com erro`);
        toast({ texto: partes.join("; ") + ".", acao: { rotulo: r.importados > 0 ? "Revisar" : "Ver", fazer: () => router.push(r.importados > 0 ? "/revisar" : "/pasta") } });
      }
      // O backup cifrado leva alguns segundos de calculo: espera a tela inicial aparecer.
      espera = setTimeout(async () => {
        const b = await backupMensalNaPasta(false);
        if (!cancelado && b.status === "erro") toast({ texto: `Backup mensal não gravado: ${b.mensagem}`, acao: { rotulo: "Abrir", fazer: () => router.push("/pasta") } });
      }, ESPERA_DO_BACKUP_MS);
    }

    void rodar();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void rodar();
    });
    return () => {
      cancelado = true;
      if (espera) clearTimeout(espera);
      sub.remove();
    };
  }, [toast, router]);

  return null;
}
