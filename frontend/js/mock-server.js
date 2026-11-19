// Simulador en memoria del backend, para desarrollar el frontend sin AWS.
// Responde exactamente con el contrato del README §4 (rutas, códigos HTTP y formato de error).
// Se reinicia al recargar la página. No forma parte del despliegue real.

import { SALE_STATUS, SEAT_STATUS, TURN_STATUS, ORDER_STATUS } from "./constants.js";

const RESERVATION_SECONDS = 5 * 60; // README 7.1
const LATENCY_MS = [80, 250];

let state = null;

async function loadState() {
  if (state) return state;
  const res = await fetch("mocks/events.json");
  const { events } = await res.json();
  const now = Date.now();

  state = { events: new Map(), seats: new Map(), turns: new Map(), orders: new Map(), counters: new Map() };

  for (const ev of events) {
    const { saleOpensInSeconds, ...event } = ev;
    if (saleOpensInSeconds !== undefined) {
      event.saleOpensAt = new Date(now + saleOpensInSeconds * 1000).toISOString();
    }
    state.events.set(event.eventId, event);

    const seats = [];
    for (const zone of event.zones) {
      const { rows, seatsPerRow } = zone.layout;
      for (let r = 0; r < rows; r++) {
        const row = String.fromCharCode(65 + r);
        for (let n = 1; n <= seatsPerRow; n++) {
          const soldOut = event.saleStatus === SALE_STATUS.SOLD_OUT;
          seats.push({
            seatId: `${zone.zoneId}#${row}#${n}`,
            zoneId: zone.zoneId,
            row,
            number: n,
            status: soldOut || Math.random() < 0.2 ? SEAT_STATUS.SOLD : SEAT_STATUS.FREE,
            orderId: null,
            expiresAt: null,
          });
        }
      }
    }
    state.seats.set(event.eventId, seats);
    state.counters.set(event.eventId, 0);
  }
  return state;
}

// --- utilidades -------------------------------------------------------------

const ok = (data, status = 200) => ({ status, data });
const fail = (status, code, message) => ({ status, data: { error: { code, message } } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function currentSaleStatus(event) {
  if (event.saleStatus === SALE_STATUS.SCHEDULED && event.saleOpensAt && Date.now() >= Date.parse(event.saleOpensAt)) {
    event.saleStatus = SALE_STATUS.OPEN;
  }
  return event.saleStatus;
}

function zonesWithAvailability(event) {
  const seats = state.seats.get(event.eventId);
  return event.zones.map(({ layout, ...z }) => {
    const zs = seats.filter((s) => s.zoneId === z.zoneId);
    return { ...z, capacity: zs.length, available: zs.filter((s) => s.status === SEAT_STATUS.FREE).length };
  });
}

// Simula a otros compradores y caducidad de reservas (RF-05).
function tickSeats(eventId) {
  const now = Date.now();
  for (const s of state.seats.get(eventId)) {
    if (s.status === SEAT_STATUS.RESERVED && s.expiresAt && now > s.expiresAt * 1000) {
      s.status = SEAT_STATUS.FREE;
      s.orderId = null;
      s.expiresAt = null;
    }
    if (s.status === SEAT_STATUS.FREE && !s.orderId && Math.random() < 0.005) {
      if (Math.random() < 0.5) {
        s.status = SEAT_STATUS.SOLD;
      } else {
        // Reserva de otro usuario que no paga: caduca en 30 s y el asiento vuelve a estar libre.
        s.status = SEAT_STATUS.RESERVED;
        s.expiresAt = Math.floor(now / 1000) + 30;
      }
    }
  }
}

// Avanza la comanda por los estados de Step Functions según el tiempo transcurrido (RF-08, RF-10).
function advanceOrder(order) {
  const elapsed = (Date.now() - order._createdMs) / 1000;
  const seat = state.seats.get(order.eventId).find((s) => s.seatId === order.seatId);
  if (order.status === ORDER_STATUS.CONFIRMED || order.status === ORDER_STATUS.FAILED) return;

  if (elapsed < 2) order.status = ORDER_STATUS.QUEUED;
  else if (elapsed < 4) order.status = ORDER_STATUS.RESERVING;
  else if (elapsed < 6) order.status = ORDER_STATUS.PAYING;
  else if (order.cardId === "card_fail") {
    order.status = ORDER_STATUS.FAILED;
    seat.status = SEAT_STATUS.FREE;
    seat.orderId = null;
    seat.expiresAt = null;
  } else {
    order.status = ORDER_STATUS.CONFIRMED;
    seat.status = SEAT_STATUS.SOLD;
    seat.expiresAt = null;
    order.ticket = {
      ticketId: `tkt-${order.orderId.slice(4)}`,
      code: `ACAP-${order.eventId}-${order.seatId}-${order.orderId.slice(4, 12)}`.toUpperCase(),
    };
  }
}

// --- rutas ------------------------------------------------------------------

const routes = [
  ["GET", /^\/events$/, () => {
    const list = [...state.events.values()].map((e) => ({
      eventId: e.eventId, name: e.name, artist: e.artist, venue: e.venue, date: e.date,
      saleStatus: currentSaleStatus(e), saleOpensAt: e.saleOpensAt ?? null,
    }));
    return ok(list);
  }],

  ["GET", /^\/events\/([^/]+)$/, ([eventId]) => {
    const e = state.events.get(eventId);
    if (!e) return fail(404, "EVENT_NOT_FOUND", "El evento no existe");
    tickSeats(eventId);
    const { zones, ...rest } = e;
    return ok({ ...rest, saleStatus: currentSaleStatus(e), saleOpensAt: e.saleOpensAt ?? null, zones: zonesWithAvailability(e) });
  }],

  ["POST", /^\/events\/([^/]+)\/queue$/, ([eventId], { headers }) => {
    const e = state.events.get(eventId);
    if (!e) return fail(404, "EVENT_NOT_FOUND", "El evento no existe");
    const status = currentSaleStatus(e);
    if (status !== SALE_STATUS.OPEN && status !== SALE_STATUS.WAITING_ROOM) {
      return fail(403, "SALE_NOT_OPEN", "La venta no está abierta");
    }
    const turnNumber = state.counters.get(eventId) + 1;
    state.counters.set(eventId, turnNumber);
    const turn = {
      turnId: `turn-${crypto.randomUUID()}`, eventId, turnNumber,
      sessionId: headers["X-Session-Id"], position: rand(5, 15), status: TURN_STATUS.WAITING,
    };
    state.turns.set(turn.turnId, turn);
    return ok({ turnId: turn.turnId, turnNumber, position: turn.position, status: turn.status }, 201);
  }],

  ["GET", /^\/events\/([^/]+)\/queue\/([^/]+)$/, ([eventId, turnId]) => {
    const t = state.turns.get(turnId);
    if (!t || t.eventId !== eventId) return fail(404, "TURN_NOT_FOUND", "Turno no encontrado");
    if (t.status === TURN_STATUS.WAITING) {
      t.position = Math.max(0, t.position - rand(1, 3));
      if (t.position === 0) {
        t.status = TURN_STATUS.ADMITTED;
        t.admissionToken = `adm-${crypto.randomUUID()}`;
      }
    }
    return ok({ position: t.position, status: t.status, admissionToken: t.admissionToken ?? null });
  }],

  ["GET", /^\/events\/([^/]+)\/seats$/, ([eventId], { headers }) => {
    if (!state.events.has(eventId)) return fail(404, "EVENT_NOT_FOUND", "El evento no existe");
    if (!isAdmitted(eventId, headers)) return fail(403, "NOT_ADMITTED", "Todavía no es tu turno");
    tickSeats(eventId);
    return ok(state.seats.get(eventId).map(({ orderId, expiresAt, ...s }) => s));
  }],

  ["POST", /^\/events\/([^/]+)\/seats\/([^/]+)\/reserve$/, ([eventId, seatId], { headers, body }) => {
    const e = state.events.get(eventId);
    if (!e) return fail(404, "EVENT_NOT_FOUND", "El evento no existe");
    if (!isAdmitted(eventId, headers)) return fail(403, "NOT_ADMITTED", "Todavía no es tu turno");
    const seat = state.seats.get(eventId).find((s) => s.seatId === seatId);
    if (!seat) return fail(404, "SEAT_NOT_FOUND", "El asiento no existe");
    // Equivalente a la escritura condicional de DynamoDB: solo si sigue libre (RNF-01).
    if (seat.status !== SEAT_STATUS.FREE) return fail(409, "SEAT_TAKEN", "El asiento ya no está disponible");

    const orderId = `ord-${crypto.randomUUID()}`;
    const expiresAt = Math.floor(Date.now() / 1000) + RESERVATION_SECONDS;
    Object.assign(seat, { status: SEAT_STATUS.RESERVED, orderId, expiresAt });
    const price = e.zones.find((z) => z.zoneId === seat.zoneId).currentPrice;
    state.orders.set(orderId, {
      orderId, eventId, seatId, price, cardId: body?.cardId ?? null,
      status: ORDER_STATUS.QUEUED, _createdMs: Date.now(),
    });
    return ok({ orderId, status: ORDER_STATUS.QUEUED, expiresAt: new Date(expiresAt * 1000).toISOString() }, 202);
  }],

  ["GET", /^\/orders\/([^/]+)$/, ([orderId]) => {
    const o = state.orders.get(orderId);
    if (!o) return fail(404, "ORDER_NOT_FOUND", "La comanda no existe");
    advanceOrder(o);
    return ok({ orderId: o.orderId, eventId: o.eventId, seatId: o.seatId, price: o.price, status: o.status, ticket: o.ticket ?? null });
  }],
];

function isAdmitted(eventId, headers) {
  const token = headers["X-Admission-Token"];
  if (!token) return false;
  for (const t of state.turns.values()) {
    if (t.eventId === eventId && t.admissionToken === token) return true;
  }
  return false;
}

export async function handleMockRequest(method, path, ctx) {
  await loadState();
  await sleep(rand(...LATENCY_MS));
  for (const [m, re, handler] of routes) {
    const match = m === method && path.match(re);
    if (match) return handler(match.slice(1).map(decodeURIComponent), ctx);
  }
  return fail(404, "ROUTE_NOT_FOUND", `${method} ${path}`);
}
