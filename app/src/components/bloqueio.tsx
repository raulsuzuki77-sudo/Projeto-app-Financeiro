import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import { autenticar, bloqueioAtivo } from "../lib/seguranca";
import { useTema } from "./tema";
import { Botao, Texto } from "./ui";

const SEGUNDOS_PARA_TRAVAR = 30;

/** Protege o conteudo com Face ID/Touch ID (quando ativado em Ajustes) ao abrir e ao voltar do segundo plano apos 30 s. */
export function Bloqueio({ children }: { children: ReactNode }) {
  const t = useTema();
  const [estado, setEstado] = useState<"verificando" | "travado" | "livre">("verificando");
  const saiuEm = useRef<number | null>(null);
  const emAutenticacao = useRef(false);

  const tentar = useCallback(async () => {
    if (emAutenticacao.current) return;
    emAutenticacao.current = true;
    try {
      setEstado((await autenticar()) ? "livre" : "travado");
    } finally {
      emAutenticacao.current = false;
    }
  }, []);

  useEffect(() => {
    bloqueioAtivo().then((ativo) => (ativo ? tentar() : setEstado("livre")));
  }, [tentar]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", async (s) => {
      if (s === "background") saiuEm.current = Date.now();
      if (s === "active" && saiuEm.current !== null) {
        const fora = (Date.now() - saiuEm.current) / 1000;
        saiuEm.current = null;
        if (fora >= SEGUNDOS_PARA_TRAVAR && (await bloqueioAtivo())) {
          setEstado("travado");
          tentar();
        }
      }
    });
    return () => sub.remove();
  }, [tentar]);

  if (estado === "livre") return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: t.fundo, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }}>
      <Texto forte>Controle Financeiro</Texto>
      {estado === "travado" ? <Botao rotulo="Desbloquear" onPress={tentar} /> : null}
    </View>
  );
}
