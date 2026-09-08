// Presentación de horas para el usuario. Convierte "HH:MM" (24h, como se
// guarda en Supabase) a "h:mm AM" / "h:mm PM".
//
// SOLO presentación: no cambia ningún valor almacenado ni se usa para
// lógica de scheduler. Espejo de backend/bot/utils/formatHora.js.
export function formatHora12(hora: string | null | undefined): string {

  if (hora == null) return "";

  const texto = String(hora).trim();

  const m = texto.match(/^(\d{1,2}):(\d{2})/);

  if (!m) return texto;

  const h24 = parseInt(m[1], 10);
  const minutos = m[2];

  if (!Number.isInteger(h24) || h24 < 0 || h24 > 23) {
    return texto;
  }

  const periodo = h24 < 12 ? "AM" : "PM";

  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;

  return `${h12}:${minutos} ${periodo}`;
}
