import Svg, { Path } from "react-native-svg";

const CAMINHOS = {
  menu: "M4 7h16 M4 12h16 M4 17h16",
  atualizar: "M21 12a9 9 0 1 1-2.64-6.36 M21 4v5h-5",
  mais: "M12 5v14 M5 12h14",
  fechar: "M6 6l12 12 M18 6L6 18",
  inicio: "M3 11l9-8 9 8 M5 10v10h14V10",
  extrato: "M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01",
  revisar: "M9 12l2 2 4-4 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
  painel: "M5 20V10 M12 20V4 M19 20v-7",
  lixeira: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  editar: "M4 20h4L19 9l-4-4L4 16v4z",
  seta: "M9 6l6 6-6 6",
  esquerda: "M15 6l-6 6 6 6",
  meta: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  recorrente: "M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3",
  cartao: "M3 6h18v12H3z M3 10h18",
  importar: "M12 3v12 M7 10l5 5 5-5 M4 20h16",
  seguranca: "M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3",
  buscar: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5",
  calendario: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
  orcamento: "M3 8h18v11H3z M3 8l3-4h12l3 4 M16 13.5h2",
  liberdade: "M3 17l6-6 4 4 8-8 M14 7h7v7",
  camera: "M4 8h3l2-3h6l2 3h3v11H4z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
} as const;

export type NomeIcone = keyof typeof CAMINHOS;

export function Icone({ nome, cor, tamanho = 22 }: { nome: NomeIcone; cor: string; tamanho?: number }) {
  return (
    <Svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {CAMINHOS[nome].split(" M").map((d, i) => (
        <Path key={i} d={i === 0 ? d : `M${d}`} />
      ))}
    </Svg>
  );
}
