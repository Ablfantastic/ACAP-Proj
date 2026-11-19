// Utilidades de presentación.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Escapar SIEMPRE los datos que vienen de la API antes de meterlos en HTML.
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Importes en céntimos (README 4.8).
const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const formatPrice = (cents) => money.format(cents / 100);

const dateFmt = new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeStyle: "short" });
export const formatDate = (iso) => dateFmt.format(new Date(iso));

export function formatCountdown(ms) {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const d = Math.floor(s / 86400);
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return d > 0 ? `${d} d ${hms}` : hms;
}

export function errorBox(err) {
  return `<div class="alert alert-error">${esc(err.message || "Error inesperado")}</div>`;
}

export function navigate(path) {
  location.hash = "#" + path;
}
