export interface Fatia {
  id: string;
  rotulo: string;
  valor: number;
}

export interface FatiaGeometria extends Fatia {
  /** Fração do total, de 0 a 1. */
  fracao: number;
  /** Caminho SVG da fatia (anel). Para uma única fatia de 100%, um anel completo. */
  caminho: string;
  cor: string;
}

export const PALETA = ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#B8A100", "#7A5195", "#8C8C8C"];

/** Mantém as `max` maiores fatias e agrupa o resto em "Outras" (sempre por último). */
export function agruparFatias(dados: Fatia[], max = 7): Fatia[] {
  const positivos = dados.filter((d) => d.valor > 0).sort((a, b) => b.valor - a.valor);
  if (positivos.length <= max) return positivos;
  const topo = positivos.slice(0, max);
  const resto = positivos.slice(max).reduce((s, d) => s + d.valor, 0);
  return [...topo, { id: "__outras", rotulo: "Outras", valor: resto }];
}

const ponto = (cx: number, cy: number, r: number, ang: number) => `${(cx + r * Math.cos(ang)).toFixed(3)} ${(cy + r * Math.sin(ang)).toFixed(3)}`;

/** Anel (donut) de `ang0` a `ang1` (radianos, começando no topo e seguindo no sentido horário). */
export function caminhoAnel(cx: number, cy: number, rExt: number, rInt: number, ang0: number, ang1: number): string {
  const completo = ang1 - ang0 >= Math.PI * 2 - 1e-6;
  if (completo) {
    // dois semicírculos: um arco de 360 graus é degenerado em SVG
    return `M ${cx - rExt} ${cy} A ${rExt} ${rExt} 0 1 1 ${cx + rExt} ${cy} A ${rExt} ${rExt} 0 1 1 ${cx - rExt} ${cy} Z M ${cx - rInt} ${cy} A ${rInt} ${rInt} 0 1 0 ${cx + rInt} ${cy} A ${rInt} ${rInt} 0 1 0 ${cx - rInt} ${cy} Z`;
  }
  const grande = ang1 - ang0 > Math.PI ? 1 : 0;
  return `M ${ponto(cx, cy, rExt, ang0)} A ${rExt} ${rExt} 0 ${grande} 1 ${ponto(cx, cy, rExt, ang1)} L ${ponto(cx, cy, rInt, ang1)} A ${rInt} ${rInt} 0 ${grande} 0 ${ponto(cx, cy, rInt, ang0)} Z`;
}

export function geometriaPizza(dados: Fatia[], tamanho: number, espessura = 0.34): FatiaGeometria[] {
  const total = dados.reduce((s, d) => s + d.valor, 0);
  if (total <= 0) return [];
  const c = tamanho / 2;
  const rExt = c - 2;
  const rInt = rExt * (1 - espessura);
  let ang = -Math.PI / 2;
  return dados.map((d, i) => {
    const fracao = d.valor / total;
    const fim = ang + fracao * Math.PI * 2;
    const g: FatiaGeometria = { ...d, fracao, caminho: caminhoAnel(c, c, rExt, rInt, ang, fim), cor: d.id === "__outras" ? PALETA[PALETA.length - 1]! : PALETA[i % (PALETA.length - 1)]! };
    ang = fim;
    return g;
  });
}
