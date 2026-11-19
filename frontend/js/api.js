// Cliente de la API. Las rutas y respuestas siguen el contrato del README (§4).
// Con USE_MOCKS=true las peticiones las responde js/mock-server.js en lugar de la red.

import { getSessionId, admissionStore } from "./session.js";
import { handleMockRequest } from "./mock-server.js";

const CONFIG = window.APP_CONFIG;

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, { body, eventId } = {}) {
  const headers = { "X-Session-Id": getSessionId() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = eventId && admissionStore.get(eventId);
  if (token) headers["X-Admission-Token"] = token;

  let status, data;
  if (CONFIG.USE_MOCKS) {
    ({ status, data } = await handleMockRequest(method, path, { headers, body }));
  } else {
    const res = await fetch(CONFIG.API_BASE_URL + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    data = res.status === 204 ? null : await res.json().catch(() => null);
  }

  if (status >= 400) {
    const err = data?.error || {};
    throw new ApiError(status, err.code || `HTTP_${status}`, err.message);
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  listEvents: () => request("GET", "/events"),
  getEvent: (eventId) => request("GET", `/events/${enc(eventId)}`),

  joinQueue: (eventId) => request("POST", `/events/${enc(eventId)}/queue`, { body: {} }),
  getTurn: (eventId, turnId) =>
    request("GET", `/events/${enc(eventId)}/queue/${enc(turnId)}`),

  getSeats: (eventId) => request("GET", `/events/${enc(eventId)}/seats`, { eventId }),
  reserveSeat: (eventId, seatId, { cardId }) =>
    request("POST", `/events/${enc(eventId)}/seats/${enc(seatId)}/reserve`, {
      eventId,
      body: { cardId },
    }),

  getOrder: (orderId) => request("GET", `/orders/${enc(orderId)}`),
};
