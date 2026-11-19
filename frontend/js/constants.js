// Valores de estado del contrato (CLAUDE.md §2, README 5.4).
// Si el equipo decide otro idioma para los estados, solo hay que cambiarlos aquí.

export const SALE_STATUS = {
  SCHEDULED: "programada",
  WAITING_ROOM: "sala_espera",
  OPEN: "abierta",
  SOLD_OUT: "agotada",
  FINISHED: "finalizada",
};

export const SEAT_STATUS = {
  FREE: "libre",
  RESERVED: "reservado",
  SOLD: "vendido",
  WAITLIST_OFFER: "ofrece_lista_espera",
};

export const TURN_STATUS = {
  WAITING: "esperando",
  ADMITTED: "admitido",
  EXPIRED: "expirado",
};

export const ORDER_STATUS = {
  QUEUED: "en_cola",
  RESERVING: "reservando",
  PAYING: "pagando",
  CONFIRMED: "confirmada",
  FAILED: "fallida",
  DEAD_LETTER: "en_dead_letter",
};

export const FINAL_ORDER_STATUSES = [
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.FAILED,
  ORDER_STATUS.DEAD_LETTER,
];

export const LABELS = {
  [SALE_STATUS.SCHEDULED]: "Próximamente",
  [SALE_STATUS.WAITING_ROOM]: "Sala de espera abierta",
  [SALE_STATUS.OPEN]: "A la venta",
  [SALE_STATUS.SOLD_OUT]: "Agotado",
  [SALE_STATUS.FINISHED]: "Finalizado",
  [ORDER_STATUS.QUEUED]: "En cola",
  [ORDER_STATUS.RESERVING]: "Confirmando reserva",
  [ORDER_STATUS.PAYING]: "Procesando pago",
  [ORDER_STATUS.CONFIRMED]: "Confirmada",
  [ORDER_STATUS.FAILED]: "Fallida",
  [ORDER_STATUS.DEAD_LETTER]: "En revisión",
};
