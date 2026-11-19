// Configuración del frontend. En el despliegue, Terraform genera este fichero
// con la URL real de la API (README, decisión 8.2).
window.APP_CONFIG = {
  // URL base de API Gateway, sin barra final. Ejemplo:
  // "https://abc123.execute-api.eu-west-1.amazonaws.com/prod"
  API_BASE_URL: "",

  // true: usa el simulador de js/mock-server.js (no hace falta backend).
  USE_MOCKS: true,

  // Cada cuánto se consulta la posición en la sala y el estado de la comanda (ms).
  POLL_INTERVAL_MS: 2500,
};
