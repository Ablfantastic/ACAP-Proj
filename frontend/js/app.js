// Router por hash (#/...). Con hash no hace falta configurar CloudFront para rutas de SPA.
// Cada vista exporta render(root, params) y puede devolver una función de limpieza
// (para parar timers de polling al cambiar de página).

import { renderCatalog } from "./views/catalog.js";
import { renderEvent } from "./views/event.js";
import { renderQueue } from "./views/queue.js";
import { renderSeats } from "./views/seats.js";
import { renderOrder } from "./views/order.js";

const routes = [
  [/^\/$/, renderCatalog],
  [/^\/events\/([^/]+)$/, renderEvent],
  [/^\/events\/([^/]+)\/queue$/, renderQueue],
  [/^\/events\/([^/]+)\/seats$/, renderSeats],
  [/^\/orders\/([^/]+)$/, renderOrder],
];

const root = document.getElementById("app");
let cleanup = null;
let navId = 0;

async function route() {
  if (typeof cleanup === "function") cleanup();
  cleanup = null;

  const path = location.hash.slice(1) || "/";
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) {
      root.innerHTML = '<p class="muted">Cargando…</p>';
      const myNav = ++navId;
      const done = await view(root, m.slice(1).map(decodeURIComponent));
      // Si el usuario ya ha cambiado de página mientras esta cargaba, se para enseguida.
      if (myNav !== navId) { if (typeof done === "function") done(); }
      else cleanup = done;
      return;
    }
  }
  root.innerHTML = '<h1>Página no encontrada</h1><p><a href="#/">Volver al catálogo</a></p>';
}

document.getElementById("mock-badge").hidden = !window.APP_CONFIG.USE_MOCKS;
window.addEventListener("hashchange", route);
route();
