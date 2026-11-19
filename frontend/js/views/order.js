// RF-07/RF-09/RF-10: estado de la comanda (polling) y entrada al confirmarse.

import { api } from "../api.js";
import { ORDER_STATUS, FINAL_ORDER_STATUSES, LABELS } from "../constants.js";
import { esc, formatPrice, errorBox } from "../util.js";

const STEPS = [ORDER_STATUS.QUEUED, ORDER_STATUS.RESERVING, ORDER_STATUS.PAYING, ORDER_STATUS.CONFIRMED];

export async function renderOrder(root, [orderId]) {
  let timer = null;
  let stopped = false;

  function render(o) {
    const reached = STEPS.indexOf(o.status);
    const failed = o.status === ORDER_STATUS.FAILED || o.status === ORDER_STATUS.DEAD_LETTER;
    root.innerHTML = `
      <p><a href="#/">← Catálogo</a></p>
      <h1>Tu comanda</h1>
      <p class="muted">Comanda <code>${esc(o.orderId)}</code> · Asiento ${esc(o.seatId)}
        ${o.price != null ? `· ${esc(formatPrice(o.price))}` : ""}</p>

      <ol class="steps">
        ${STEPS.map((s, i) => `
          <li class="${i < reached || o.status === ORDER_STATUS.CONFIRMED ? "done" : i === reached ? "current" : ""}">
            ${esc(LABELS[s])}</li>`).join("")}
      </ol>

      ${failed ? `
        <div class="alert alert-error">
          La compra no se ha completado (${esc(LABELS[o.status])}). El asiento se ha liberado.
          <p><a href="#/events/${encodeURIComponent(o.eventId ?? "")}">Volver al evento</a></p>
        </div>` : ""}

      ${o.ticket ? `
        <div class="ticket">
          <h2>Tu entrada</h2>
          <p>Código: <code>${esc(o.ticket.code)}</code></p>
          <p class="muted">Con el módulo 4c este código irá firmado con KMS y se mostrará como QR.</p>
        </div>` : ""}`;
  }

  async function poll() {
    if (stopped) return;
    try {
      const o = await api.getOrder(orderId);
      if (stopped) return;
      render(o);
      if (FINAL_ORDER_STATUSES.includes(o.status)) return;
    } catch (err) {
      root.innerHTML = errorBox(err);
      return;
    }
    timer = setTimeout(poll, window.APP_CONFIG.POLL_INTERVAL_MS);
  }

  await poll();
  return () => { stopped = true; clearTimeout(timer); };
}
