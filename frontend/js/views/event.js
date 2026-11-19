// RF-01 detalle + flujo 7.1: cuenta atrás si la venta no está abierta, y entrada a la sala de espera.

import { api } from "../api.js";
import { navigate } from "../util.js";
import { SALE_STATUS, LABELS } from "../constants.js";
import { esc, formatDate, formatPrice, formatCountdown, errorBox } from "../util.js";

export async function renderEvent(root, [eventId]) {
  let timer = null;

  async function load() {
    const e = await api.getEvent(eventId);
    const canJoin = e.saleStatus === SALE_STATUS.OPEN || e.saleStatus === SALE_STATUS.WAITING_ROOM;
    const scheduled = e.saleStatus === SALE_STATUS.SCHEDULED && e.saleOpensAt;

    root.innerHTML = `
      <p><a href="#/">← Catálogo</a></p>
      <h1>${esc(e.name)}</h1>
      <p class="artist">${esc(e.artist)}</p>
      <p class="muted">${esc(e.venue)} · ${esc(formatDate(e.date))}</p>
      <span class="pill pill-${esc(e.saleStatus)}">${esc(LABELS[e.saleStatus] || e.saleStatus)}</span>

      <h2>Zonas</h2>
      <table class="table">
        <thead><tr><th>Zona</th><th>Precio</th><th>Disponibles</th></tr></thead>
        <tbody>
          ${e.zones.map((z) => `
            <tr>
              <td>${esc(z.name)}</td>
              <td>${esc(formatPrice(z.currentPrice))}
                ${z.currentPrice !== z.basePrice ? `<span class="muted strike">${esc(formatPrice(z.basePrice))}</span>` : ""}</td>
              <td>${esc(z.available)} / ${esc(z.capacity)}</td>
            </tr>`).join("")}
        </tbody>
      </table>

      <div class="actions">
        ${scheduled ? `<p>La venta abre en <strong id="countdown" class="countdown">--:--:--</strong></p>` : ""}
        ${canJoin ? `<button id="join" class="btn btn-primary">Entrar en la sala de espera</button>` : ""}
      </div>`;

    if (scheduled) {
      const opensAt = Date.parse(e.saleOpensAt);
      const tick = () => {
        const left = opensAt - Date.now();
        const el = document.getElementById("countdown");
        if (el) el.textContent = formatCountdown(left);
        if (left <= 0) { clearInterval(timer); timer = null; load().catch(show); }
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    document.getElementById("join")?.addEventListener("click", () => navigate(`/events/${eventId}/queue`));
  }

  const show = (err) => { root.innerHTML = errorBox(err); };
  await load().catch(show);
  return () => timer && clearInterval(timer);
}
