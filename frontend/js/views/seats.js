// RF-04/RF-05/RF-06: mapa de asientos y reserva.
// El mapa se refresca por polling; con el módulo 2 llegarán mensajes WebSocket "seat_update".

import { api } from "../api.js";
import { navigate } from "../util.js";
import { SEAT_STATUS } from "../constants.js";
import { admissionStore, turnStore, getCardId, setCardId } from "../session.js";
import { esc, formatPrice, errorBox } from "../util.js";

export async function renderSeats(root, [eventId]) {
  let timer = null;
  let stopped = false;
  let busy = false;
  let event = null;

  if (!admissionStore.get(eventId)) {
    navigate(`/events/${eventId}/queue`);
    return;
  }

  root.innerHTML = `
    <p><a href="#/events/${encodeURIComponent(eventId)}">← Volver al evento</a></p>
    <h1 id="title">Elige tu asiento</h1>
    <div id="message"></div>
    <div class="legend">
      <span><i class="seat seat-${SEAT_STATUS.FREE}"></i> Libre</span>
      <span><i class="seat seat-${SEAT_STATUS.RESERVED}"></i> Reservado</span>
      <span><i class="seat seat-${SEAT_STATUS.SOLD}"></i> Vendido</span>
    </div>
    <div id="map"></div>
    <details class="demo-tools">
      <summary>Opciones de demo</summary>
      <label>Tarjeta ficticia
        <input id="card" value="${esc(getCardId())}">
      </label>
      <p class="muted">Usa <code>card_fail</code> para simular un pago fallido.</p>
    </details>`;

  document.getElementById("card").addEventListener("change", (ev) => setCardId(ev.target.value.trim()));

  const message = (html) => { document.getElementById("message").innerHTML = html; };

  function renderMap(seats) {
    const byZone = new Map();
    for (const s of seats) {
      if (!byZone.has(s.zoneId)) byZone.set(s.zoneId, new Map());
      const rows = byZone.get(s.zoneId);
      if (!rows.has(s.row)) rows.set(s.row, []);
      rows.get(s.row).push(s);
    }

    document.getElementById("map").innerHTML = [...byZone].map(([zoneId, rows]) => {
      const zone = event.zones.find((z) => z.zoneId === zoneId);
      return `
        <section class="zone">
          <h2>${esc(zone?.name ?? zoneId)} <span class="muted">${zone ? esc(formatPrice(zone.currentPrice)) : ""}</span></h2>
          ${[...rows].map(([row, list]) => `
            <div class="seat-row">
              <span class="row-label">${esc(row)}</span>
              ${list.sort((a, b) => a.number - b.number).map((s) => `
                <button class="seat seat-${esc(s.status)}" data-seat="${esc(s.seatId)}"
                  title="${esc(`${zone?.name ?? zoneId} · fila ${row} · asiento ${s.number}`)}"
                  ${s.status !== SEAT_STATUS.FREE ? "disabled" : ""}>${esc(s.number)}</button>`).join("")}
            </div>`).join("")}
        </section>`;
    }).join("");
  }

  async function refresh() {
    if (stopped || busy) return;
    try {
      renderMap(await api.getSeats(eventId));
    } catch (err) {
      if (err.status === 403) return backToQueue();
      message(errorBox(err));
    }
  }

  function backToQueue() {
    admissionStore.set(eventId, null);
    turnStore.set(eventId, null);
    navigate(`/events/${eventId}/queue`);
  }

  async function reserve(seatId) {
    busy = true;
    message('<div class="alert">Reservando…</div>');
    try {
      const res = await api.reserveSeat(eventId, seatId, { cardId: getCardId() });
      navigate(`/orders/${res.orderId}`);
    } catch (err) {
      if (err.status === 403) return backToQueue();
      // 409: otro usuario se nos ha adelantado (RF-06). Mensaje explícito y refrescar el mapa.
      message(err.status === 409
        ? '<div class="alert alert-error">Ese asiento acaba de ocuparse. Elige otro.</div>'
        : errorBox(err));
      busy = false;
      refresh();
    }
  }

  document.getElementById("map").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-seat]");
    if (btn && !btn.disabled && !busy) reserve(btn.dataset.seat);
  });

  try {
    event = await api.getEvent(eventId);
    document.getElementById("title").textContent = `Elige tu asiento · ${event.name}`;
  } catch (err) {
    root.innerHTML = errorBox(err);
    return;
  }
  await refresh();
  timer = setInterval(refresh, window.APP_CONFIG.POLL_INTERVAL_MS);
  return () => { stopped = true; clearInterval(timer); };
}
