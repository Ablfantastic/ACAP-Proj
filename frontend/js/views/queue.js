// RF-02/RF-03: sala de espera. En el núcleo, la posición se consulta por polling (README 8.4).
// Con el módulo 2 esto se sustituye por mensajes WebSocket de tipo "position".

import { api } from "../api.js";
import { navigate } from "../util.js";
import { TURN_STATUS } from "../constants.js";
import { turnStore, admissionStore } from "../session.js";
import { errorBox } from "../util.js";

export async function renderQueue(root, [eventId]) {
  let timer = null;
  let stopped = false;

  if (admissionStore.get(eventId)) {
    navigate(`/events/${eventId}/seats`);
    return;
  }

  root.innerHTML = `
    <p><a href="#/events/${encodeURIComponent(eventId)}">← Volver al evento</a></p>
    <h1>Sala de espera</h1>
    <div class="queue-box">
      <p>Tu posición en la cola</p>
      <p id="position" class="position">…</p>
      <p class="muted">No cierres esta pestaña. Te llevaremos al mapa de asientos cuando sea tu turno.</p>
    </div>`;

  const setPosition = (p) => {
    const el = document.getElementById("position");
    if (el) el.textContent = p;
  };

  async function ensureTurn() {
    let turnId = turnStore.get(eventId);
    if (!turnId) {
      const t = await api.joinQueue(eventId);
      turnId = t.turnId;
      turnStore.set(eventId, turnId);
      setPosition(t.position);
    }
    return turnId;
  }

  async function poll() {
    if (stopped) return;
    try {
      const turnId = await ensureTurn();
      const t = await api.getTurn(eventId, turnId);
      if (stopped) return;
      if (t.status === TURN_STATUS.ADMITTED) {
        admissionStore.set(eventId, t.admissionToken);
        navigate(`/events/${eventId}/seats`);
        return;
      }
      if (t.status === TURN_STATUS.EXPIRED) {
        turnStore.set(eventId, null);
        root.querySelector(".queue-box").innerHTML = `
          <p>Tu turno ha caducado.</p>
          <a class="btn btn-primary" href="#/events/${encodeURIComponent(eventId)}">Volver a intentarlo</a>`;
        return;
      }
      setPosition(t.position);
    } catch (err) {
      if (err.code === "TURN_NOT_FOUND") turnStore.set(eventId, null); // se volverá a pedir turno
      else { root.innerHTML = errorBox(err); return; }
    }
    timer = setTimeout(poll, window.APP_CONFIG.POLL_INTERVAL_MS);
  }

  poll();
  return () => { stopped = true; clearTimeout(timer); };
}
