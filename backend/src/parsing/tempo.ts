export const FUSO = "America/Sao_Paulo";

export interface DataHoraLocal {
  data_local: string; // YYYY-MM-DD
  hora_local: number;
  minuto_local: number;
}

/** Data e hora de um instante no fuso do usuário. */
export function paraLocal(instante: Date, fuso: string = FUSO): DataHoraLocal {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instante);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return {
    data_local: `${g("year")}-${g("month")}-${g("day")}`,
    hora_local: Number(g("hour")),
    minuto_local: Number(g("minute")),
  };
}

export function somarDias(dataLocal: string, dias: number): string {
  const d = new Date(`${dataLocal}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function dataValida(ano: number, mes: number, dia: number): boolean {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Instante UTC aproximado a partir de data e hora locais (Brasil sem horário de verão desde 2019: UTC-3). */
export function paraInstanteUTC(dataLocal: string, hora: number | null): string {
  const h = hora ?? 12;
  return new Date(`${dataLocal}T${String(h).padStart(2, "0")}:00:00-03:00`).toISOString();
}
