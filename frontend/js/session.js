// Identidad de demo (README 4.3) y datos de turno/admisión por evento.
// El almacenamiento del navegador puede fallar (modo privado, etc.): siempre con try/catch.

function read(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}
function write(storage, key, value) {
  try {
    if (value === null || value === undefined) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch { /* sin almacenamiento: la sesión dura lo que la pestaña */ }
}

let memorySessionId = null;

export function getSessionId() {
  let id = read(localStorage, "acap.sessionId") || memorySessionId;
  if (!id) {
    id = crypto.randomUUID();
    memorySessionId = id;
    write(localStorage, "acap.sessionId", id);
  }
  return id;
}

// Turno y token de admisión se guardan por pestaña (sessionStorage),
// para poder simular varios usuarios con varias pestañas.
export const turnStore = {
  get: (eventId) => read(sessionStorage, `acap.turn.${eventId}`),
  set: (eventId, turnId) => write(sessionStorage, `acap.turn.${eventId}`, turnId),
};

export const admissionStore = {
  get: (eventId) => read(sessionStorage, `acap.admission.${eventId}`),
  set: (eventId, token) => write(sessionStorage, `acap.admission.${eventId}`, token),
};

// "Tarjeta" ficticia para el antifraude (4b). card_fail fuerza un pago fallido (README 7.5).
export function getCardId() {
  return read(sessionStorage, "acap.cardId") || "card_demo_0001";
}
export function setCardId(cardId) {
  write(sessionStorage, "acap.cardId", cardId);
}
