import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTema } from "./tema";

interface Aviso {
  texto: string;
  acao?: { rotulo: string; fazer: () => void | Promise<void> };
}

const Ctx = createContext<(a: Aviso) => void>(() => undefined);

/** Aviso temporário na base da tela, com ação opcional (ex.: "Desfazer"). */
export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTema();
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mostrar = useCallback((a: Aviso) => {
    if (timer.current) clearTimeout(timer.current);
    setAviso(a);
    timer.current = setTimeout(() => setAviso(null), a.acao ? 8000 : 4000);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <Ctx.Provider value={mostrar}>
      {children}
      {aviso ? (
        <View pointerEvents="box-none" style={estilos.camada}>
          <View accessibilityLiveRegion="polite" style={[estilos.caixa, { backgroundColor: t.texto }]}>
            <Text style={{ color: t.fundo, flex: 1, fontSize: 14 }}>{aviso.texto}</Text>
            {aviso.acao ? (
              <Pressable
                accessibilityRole="button"
                onPress={async () => {
                  const f = aviso.acao!.fazer;
                  setAviso(null);
                  await f();
                }}
                hitSlop={8}
              >
                <Text style={{ color: t.primaria === "#1F5FBF" ? "#9CC2FF" : "#1F5FBF", fontWeight: "700", fontSize: 14 }}>{aviso.acao.rotulo}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

const estilos = StyleSheet.create({
  camada: { position: "absolute", left: 0, right: 0, bottom: 96, alignItems: "center", paddingHorizontal: 16 },
  caixa: { flexDirection: "row", alignItems: "center", gap: 16, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, minWidth: 260, maxWidth: 560 },
});
