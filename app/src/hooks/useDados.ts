import { useFocusEffect, useNavigation } from "expo-router";
import { createElement, useCallback, useLayoutEffect, useRef, useState } from "react";
import { BotaoIcone } from "../components/ui";

/**
 * Carrega dados ao abrir a tela, ao voltar a ela e quando o usuário puxa para atualizar ou toca no botão do cabeçalho.
 * Erros viram mensagem em `erro`, nunca exceção solta.
 */
export function useDados<T>(carregar: () => Promise<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const versao = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recarregar = useCallback(async () => {
    const minha = ++versao.current;
    setCarregando(true);
    try {
      const r = await carregar();
      if (minha === versao.current) {
        setDados(r);
        setErro(null);
      }
    } catch (e) {
      if (minha === versao.current) setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      if (minha === versao.current) setCarregando(false);
    }
  }, deps);

  useFocusEffect(
    useCallback(() => {
      void recarregar();
    }, [recarregar]),
  );
  return { dados, erro, carregando, recarregar, setDados };
}

/** Coloca o botão "Atualizar" no canto direito do cabeçalho da tela. */
export function useBotaoAtualizar(aoTocar: () => void | Promise<void>) {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => createElement(BotaoIcone, { icone: "atualizar", rotulo: "Atualizar", onPress: () => void aoTocar() }),
    });
  }, [navigation, aoTocar]);
}
