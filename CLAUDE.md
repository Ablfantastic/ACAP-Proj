# CLAUDE.md — Plataforma de venta de entradas de alta concurrencia (ACAP)

Proyecto de grupo de ACAP (Adrià, Emma, Marc, Abel, Albert). Web tipo Ticketmaster en **AWS** que aguanta avalanchas al abrir la venta. La especificación completa (en catalán) está en `docs/especificacio.md`; este fichero es el resumen operativo: qué hay que construir, quién lo hace y qué reglas no se pueden romper.

> Lo que pone "(propuesta)" no está decidido todavía en la especificación. La lista completa de decisiones pendientes está en `README.md`; cuando el equipo cierre una, se actualiza allí y aquí.

## 1. Invariantes que no se pueden romper

1. **Un asiento nunca se vende dos veces** (RNF-01). Toda transición de estado de un asiento es una **escritura condicional en DynamoDB** (`ConditionExpression`): `libre → reservado` solo si sigue `libre`; `reservado → vendido` solo si `orderId` coincide y la reserva no ha caducado. Nunca "leer y luego escribir".
2. **DynamoDB es la fuente de verdad.** Redis (módulo 2) solo acelera lecturas y la sala de espera; la escritura que cierra la venta sigue siendo atómica en DynamoDB.
3. **Idempotencia** (RNF-04). Reprocesar el mismo mensaje de SQS no genera dos ventas ni dos entradas. Claves: `orderId` + `seatId` (y clave de idempotencia en la comanda).
4. **Respuesta rápida al usuario** (RNF-03). Entrar en la sala y enviar la compra responden enseguida; pago, generación de entrada y correo son asíncronos (SQS + Step Functions). El cliente recibe un `orderId` y consulta el estado.
5. **Caducidad** (RNF-05). Una reserva no pagada se libera sola (p. ej. 5 min), y solo si sigue perteneciendo a esa comanda.
6. **Pago simulado** (RNF-08) con éxito y error inyectables. La "tarjeta" es un identificador ficticio.
7. **Coste de demo** (RNF-07). Se usa una **cuenta AWS normal (de pago real, no AWS Academy)**: hay que evitar recursos que cobran por hora sin usarse (ElastiCache, WAF, shards de Kinesis, NAT Gateway). Todo se puede destruir (`terraform destroy`). Nunca dejar una prueba de carga corriendo sin control. Nada de secretos en el repo (`*.tfvars` ya está en `.gitignore`).

## 2. Núcleo (entrega obligatoria, de punta a punta)

| Pieza | Servicio | Papel |
|---|---|---|
| Web estática (catálogo, sala de espera, compra) | S3 + CloudFront | Servir la interfaz |
| API | API Gateway (REST/HTTP) + Lambda | Recibir y validar peticiones |
| Eventos, asientos, turnos, comandas | DynamoDB | Fuente de verdad |
| Cola de compras | SQS (estándar) | Absorber picos |
| Reservar → pagar → generar entrada | Step Functions | Orquestar la compra |

Requisitos del núcleo: RF-01 a RF-10 (ver `docs/especificacio.md` §4.1).

### Estados

- **Evento:** `programada`, `sala_espera`, `abierta`, `agotada`, `finalizada`
- **Asiento:** `libre`, `reservado`, `vendido`, `ofrece_lista_espera` (módulo 6)
- **Turno:** `esperando`, `admitido`, `expirado`
- **Comanda:** `en_cola`, `reservando`, `pagando`, `confirmada`, `fallida`, `en_dead_letter`

### Flujo de compra

1. Usuario abre evento → si la venta no está abierta, ve cuenta atrás.
2. Entra en la sala de espera → recibe turno. Pasan N usuarios a la vez; el resto consulta su posición (polling en el núcleo, WebSocket con el módulo 2).
3. Admitido → ve el mapa de asientos (cuadrícula por zona).
4. Reserva un asiento: escritura condicional `libre → reservado` con `orderId` y `expiresAt`. Si falla → "asiento no disponible" (error explícito, HTTP 409).
5. Si tiene éxito → la API publica la compra en SQS y devuelve `orderId` + estado `en_cola`.
6. Lambda trabajadora consume SQS → arranca Step Functions: confirmar reserva vigente → pago simulado → asiento `vendido` + entrada generada.
7. Si falla el pago o caducó la reserva → comanda `fallida` y el asiento se libera (condicionalmente).
8. Proceso periódico (EventBridge + Lambda, o TTL + lógica) libera reservas vencidas solo si aún son de esa comanda.

### Contrato de API (propuesta — cerrarlo hoy para poder trabajar en paralelo)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/events` | Lista eventos publicados |
| GET | `/events/{eventId}` | Detalle: fecha, recinto, zonas, precio (dinámico si módulo 3), aforo |
| POST | `/events/{eventId}/queue` | Entra en la sala de espera → `{ turnId, position }` |
| GET | `/events/{eventId}/queue/{turnId}` | Posición y estado del turno (`esperando`/`admitido`/`expirado`) |
| GET | `/events/{eventId}/seats` | Mapa de asientos (solo con turno `admitido`) |
| POST | `/events/{eventId}/seats/{seatId}/reserve` | Reserva condicional → `{ orderId, status: "en_cola", expiresAt }` o 409 |
| GET | `/orders/{orderId}` | Estado de la comanda y, si está confirmada, la entrada |
| GET | `/tickets/{ticketId}/verify` | (módulo 4c) Verifica la firma KMS del QR |

Identidad: sesión de demo simple (`userId`/`sessionId` en cabecera), sin autenticación real.

### Modelo de datos DynamoDB (propuesta)

| Tabla | PK | SK | Notas |
|---|---|---|---|
| `Events` | `eventId` | `ZONE#{zoneId}` o `META` | Zonas con precio base, aforo, precio actual (módulo 3), mín/máx |
| `Seats` | `eventId` | `seatId` (`{zona}#{fila}#{num}`) | `status`, `orderId`, `expiresAt` |
| `Queue` | `eventId` | `turnNumber` | `sessionId`, `enteredAt`, `status` (contador atómico para el número de turno) |
| `Orders` | `orderId` | — | `eventId`, `seatId`, `status`, `idempotencyKey`, `cardId`, `ip` (para 4b), `flagged` |
| `Tickets` | `ticketId` | — | `orderId`, `seatId`, `code` (firmado con KMS en 4c) |

## 3. Módulos de ampliación

| Mód. | Tema | Servicios | RF |
|---|---|---|---|
| 1 | Notificaciones, correo y colas | SES (plantillas), SNS (rebotes), SQS FIFO + DLQ, EventBridge Scheduler | RF-11..14 |
| 2 | Sala de espera en tiempo real con caché | ElastiCache Redis, API Gateway WebSocket; experimento con/sin caché | RF-15 |
| 3 | Precio dinámico y analítica | Kinesis, Lambda, Firehose, S3, Glue, Athena | RF-16, RF-17 |
| 4 | Antifraude y antibots | WAF, KMS (SageMaker no hace falta) | RF-18..20 |
| 5 | Asistente IA | Bedrock (respuestas con datos reales del catálogo) | RF-21 |
| 6 | Reventa oficial y lista de espera | Step Functions, SNS o SES | RF-22 |
| 7 | Robustez y carga | Fault Injection Service, CloudWatch, X-Ray, generador de carga | RF-23 |

Módulos 3 y 4 partidos en trozos:

- **3a. Kinesis** (2–3 h): crear el stream; la API publica cada visita, reserva y compra.
- **3b. Precio dinámico** (3–4 h): Lambda consumidora del stream ajusta el precio de cada zona según la demanda reciente, con precio mínimo y máximo. El precio nuevo se muestra en la web.
- **3c. Analítica** (4–5 h): Firehose → S3, Glue crea la tabla, Athena con consultas de ventas por minuto y orden en que se agotan las zonas.
- **4a. WAF** (2–3 h): rate limit + reglas gestionadas anti-bots delante de CloudFront o de la API.
- **4b. Reglas antifraude** (2–3 h): marcar para revisión compras con muchas entradas en la misma tarjeta ficticia o desde la misma IP.
- **4c. QR firmado con KMS** (2–3 h): firmar la entrada al generarla + endpoint que verifica la firma.

## 4. Reparto

Cada persona hace su parte del núcleo + sus módulos. Reparto del núcleo por rol (propuesta, coherente con los módulos de cada uno):

| # | Rol | Parte del núcleo | Módulos | Horas aprox. |
|---|---|---|---|---|
| 1 | Frontend | Web estática S3 + CloudFront: catálogo, detalle, cuenta atrás, sala de espera (polling), mapa de asientos, estado de comanda | 5 (Bedrock) + parte web del WebSocket (mód. 2) + **3b** precio dinámico y mostrarlo en la web | 16–25 h |
| 2 | API y reservas | API Gateway + Lambdas de catálogo y reserva, escritura condicional, publicación en SQS, `GET /orders` | 6 (reventa) + **3a** Kinesis (la API publica los eventos) + **4b** antifraude (la API ve IP y tarjeta) | 18–28 h |
| 3 | Sala de espera | Tabla de turnos, ventana de admisión, endpoints de la cola, puerta cerrada al mapa | 2 (Redis + WebSocket backend) + **3c** Firehose → Glue → Athena | 20–28 h |
| 4 | Compra | Lambda trabajadora SQS, Step Functions (confirmar → pagar simulado → vender + entrada), liberación de reservas caducadas | 1 (SES, SNS, FIFO, DLQ, Scheduler) + **4c** KMS (la entrada se genera en su flujo) | 20–29 h |
| 5 | Infra y pruebas | Esqueleto Terraform, tablas DynamoDB, IAM, despliegue, datos semilla, CI | 7 (carga, FIS, CloudWatch, X-Ray) + **4a** WAF | 18–26 h |

Dependencias a tener en cuenta:
- 3b (persona 1) depende de 3a (persona 2): acordar pronto el formato del evento Kinesis.
- 3c (persona 3) también consume el stream de 3a.
- 4c (persona 4) expone el endpoint `/verify` en la API de la persona 2.
- 4a (persona 5) se coloca delante del CloudFront de la persona 1 o de la API de la persona 2.
- Todos dependen del esqueleto de infra (persona 5) y del contrato de API + modelo de datos.

### Formato de evento Kinesis (propuesta)

```json
{ "type": "visit|reserve|purchase", "eventId": "...", "zoneId": "...", "seatId": "...", "orderId": "...", "ts": "2026-11-19T10:00:00Z" }
```
Partition key: `eventId`.

## 5. Estructura del repo y convenciones (propuesta)

```
infra/            Terraform (un módulo por pieza: web, api, data, queue, workflow, ...)
backend/          Lambdas (una carpeta por función)
  api/  queue/  worker/  pricing/  ...
stepfunctions/    Definición ASL de la máquina de estados
frontend/         Web estática (HTML/JS, sin framework pesado salvo acuerdo)
load-tests/       Scripts de carga y escenarios de caos (módulo 7)
docs/             Especificación, informe y gráficas
```

- **IaC:** Terraform (el `.gitignore` ya está preparado). Región y runtime de Lambda por decidir (propuesta: `eu-west-1`/`eu-south-2` y Python 3.12).
- **Nombres de recursos** con prefijo del proyecto (p. ej. `acap-tickets-<recurso>`) y tags `Project=acap` para poder limpiar y controlar coste.
- **Git:** `main` siempre desplegable. Ramas cortas por persona/tarea (`feat/frontend`, `feat/api-reservas`, `feat/sala-espera`, `feat/compra`, `feat/infra`), merge por PR con revisión de al menos otra persona. Commits estilo Conventional Commits (`feat:`, `fix:`, `docs:`, `build:`...).
- **Frontend sin backend:** trabajar contra mocks que respeten el contrato de API de §2 hasta que existan los endpoints; la URL de la API se inyecta por configuración (`config.js`).

## 6. Demo (qué tiene que enseñar)

1. Evento con mapa de asientos pequeño y visible.
2. Apertura de venta con muchos usuarios simulados entrando en la sala de espera.
3. Algunos usuarios reales (pestañas) comprando mientras corre la simulación.
4. Dos clientes intentando el mismo asiento → el segundo rechazado.
5. Gráficas: peticiones, profundidad de cola, comandas confirmadas, errores, tiempo de punta a punta.
6. (Módulo 7) Inyección de fallo y recuperación, incluida la DLQ.

El informe indica cuántos usuarios virtuales, cuánto duró la prueba y qué se midió.

## 7. Fuera de alcance

Pasarela de pago real, app móvil, mapa dibujado del recinto (basta cuadrícula por zona), autenticación federada, reventa entre particulares.

## 8. Para hoy (primer avance)

- [ ] **Todos:** cerrar contrato de API (§2), modelo de datos y formato del evento Kinesis; subir este `CLAUDE.md` a `main`.
- [ ] **P5 Infra:** esqueleto Terraform (provider, backend de estado, tags), tablas DynamoDB y bucket S3 + CloudFront vacíos; script de datos semilla (1 evento, 2–3 zonas, cuadrícula pequeña).
- [ ] **P1 Frontend:** rama `feat/frontend`; páginas de catálogo, detalle, sala de espera y mapa de asientos contra mocks.
- [ ] **P2 API:** Lambdas `GET /events`, `GET /events/{id}` y `POST .../reserve` con escritura condicional (+ test de doble reserva).
- [ ] **P3 Sala de espera:** contador atómico de turnos, ventana de admisión y `GET .../queue/{turnId}`.
- [ ] **P4 Compra:** máquina de estados Step Functions con pago simulado (éxito/fallo inyectable) y Lambda trabajadora SQS.
