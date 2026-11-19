# Frontend

Web estática (HTML + JS vanilla con módulos ES, sin build) que se sirve desde S3 + CloudFront. Sigue el contrato de API del [README principal](../README.md) (§4).

## Arrancar en local

Los módulos ES no funcionan abriendo `index.html` con doble clic (`file://`): hace falta un servidor local.

```bash
cd frontend
python -m http.server 5173
# o bien: npx serve -l 5173 .
```

Abrir <http://localhost:5173>. Con `USE_MOCKS: true` (por defecto) todo funciona sin backend.

## Configuración (`config.js`)

| Clave | Para qué |
|---|---|
| `API_BASE_URL` | URL de API Gateway. En el despliegue la escribe Terraform |
| `USE_MOCKS` | `true` → responde `js/mock-server.js`; `false` → llama a la API real |
| `POLL_INTERVAL_MS` | Cada cuánto se consulta la sala de espera, el mapa y la comanda |

## Estructura

```
index.html          Página única; el router usa #/ (no hace falta configurar CloudFront para rutas)
config.js           Configuración (ver arriba)
css/styles.css      Estilos (modo claro y oscuro)
mocks/events.json   Datos semilla del simulador
js/
  app.js            Router por hash
  api.js            Cliente de la API (cabeceras X-Session-Id y X-Admission-Token)
  mock-server.js    Simulador en memoria del backend con el mismo contrato
  constants.js      Valores de estados (si cambia el idioma de los estados, solo se toca aquí)
  session.js        Sesión de demo, turno y token de admisión
  util.js           Escapado de HTML, formato de precios y fechas, navigate()
  views/            catalog · event · queue · seats · order
```

## Páginas

| Ruta | Vista | Requisitos |
|---|---|---|
| `#/` | Catálogo | RF-01 |
| `#/events/{id}` | Detalle, zonas y precios, cuenta atrás | RF-01, flujo 7.1 |
| `#/events/{id}/queue` | Sala de espera (polling de la posición) | RF-02, RF-03 |
| `#/events/{id}/seats` | Mapa de asientos y reserva (409 → aviso de asiento ocupado) | RF-04..06 |
| `#/orders/{id}` | Estado de la comanda y entrada | RF-07..10 |

## Qué simula el mock

- 3 eventos: uno **a la venta**, uno **programado** (abre a los 90 s, con cuenta atrás) y uno **agotado**.
- La posición en la sala baja 1–3 puestos por consulta; al llegar a 0 te admite y te da un `admissionToken`.
- Otros "compradores" ocupan asientos al azar mientras miras el mapa, así se puede ver el 409.
- La comanda pasa por `en_cola → reservando → pagando → confirmada` en unos 6 s.
- La tarjeta `card_fail` (en "Opciones de demo") hace fallar el pago y libera el asiento.
- Abre varias pestañas para simular varios usuarios (turno y token se guardan por pestaña).
- El estado se reinicia al recargar la página.

## Pendiente

- [ ] Despliegue: bucket S3 + CloudFront y `config.js` generado por Terraform (con P5).
- [ ] Conectar con la API real cuando existan los endpoints (`USE_MOCKS: false`).
- [ ] 3b: mostrar el precio dinámico (`currentPrice` ya se pinta; añadir el aviso de cambio de precio y `price_update` por WebSocket).
- [ ] Módulo 2: sustituir el polling por WebSocket (`position`, `seat_update`).
- [ ] Módulo 4c: mostrar la entrada como QR.
- [ ] Módulo 5: chat del asistente con Bedrock.
