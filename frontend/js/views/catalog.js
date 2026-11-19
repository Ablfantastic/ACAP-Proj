// RF-01: listado de eventos publicados.

import { api } from "../api.js";
import { LABELS } from "../constants.js";
import { esc, formatDate, errorBox } from "../util.js";

export async function renderCatalog(root) {
  try {
    const events = await api.listEvents();
    root.innerHTML = `
      <h1>Próximos eventos</h1>
      <div class="grid">
        ${events.map((e) => `
          <a class="card" href="#/events/${encodeURIComponent(e.eventId)}">
            <span class="pill pill-${esc(e.saleStatus)}">${esc(LABELS[e.saleStatus] || e.saleStatus)}</span>
            <h2>${esc(e.name)}</h2>
            <p class="artist">${esc(e.artist)}</p>
            <p class="muted">${esc(e.venue)}</p>
            <p class="muted">${esc(formatDate(e.date))}</p>
          </a>`).join("")}
      </div>`;
  } catch (err) {
    root.innerHTML = errorBox(err);
  }
}
