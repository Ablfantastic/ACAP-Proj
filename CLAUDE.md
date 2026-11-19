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
| API | API Gateway (REST) + Lambda | Recibir y validar peticiones |
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
8. Proceso periódico (EventBridge + Lambda) libera reservas vencidas solo si aún son de esa comanda. El TTL de DynamoDB no sirve: borra el ítem en vez de devolverlo a `libre` y puede tardar horas.

### Contrato de API y modelo de datos

**La fuente es `README.md`**: §4 (rutas, cabeceras `X-Session-Id` / `X-Admission-Token`, formato de error, códigos HTTP, importes en céntimos), §5 (tablas y claves) y §6 (mensajes SQS, Kinesis y WebSocket). No se duplican aquí para que no se desincronicen. Si cambia el contrato, se actualiza el README **y** `frontend/js/mock-server.js`, que lo implementa.

Tablas tal como están en Terraform (`infra/modules/data`), con nombre `acap-<env>-<tabla>`:

| Tabla | PK | SK | GSI |
|---|---|---|---|
| `events` | `eventId` | `sk` (`META` \| `ZONE#{zoneId}` \| `COUNTER`) | — |
| `seats` | `eventId` | `seatId` (`{zoneId}#{fila}#{num}`) | `by-status-expires` (`status`, `expiresAt`): reservas caducadas |
| `queue` | `eventId` | `turnNumber` (N) | `by-turnId` (`turnId`) |
| `orders` | `orderId` | — | `by-card` y `by-ip` (+ `createdAt`): antifraude 4b |
| `tickets` | `ticketId` | — | — |

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
- Todos dependen del esqueleto de infra (ya en `infra/`) y del contrato de API + modelo de datos (README §4–5).

El formato del evento Kinesis (3a → 3b, 3c) está en README 6.4.

## 5. Estructura del repo y convenciones

```
README.md         Decisiones a acordar (contrato de API, modelo de datos, parámetros...)
CLAUDE.md         Este fichero
docs/             Especificación (catalán), informe y gráficas
frontend/         ✅ Web estática, HTML + JS vanilla con módulos ES, sin build (ver frontend/README.md)
infra/            ✅ Terraform del núcleo (ver infra/README.md)
  modules/        data · queue · api · web  (añadir aquí los nuevos: lambdas, workflow, streaming, waf...)
backend/          ⏳ Lambdas, una carpeta por función + backend/common/ (propuesta: Python 3.12)
stepfunctions/    ⏳ Definición ASL de la máquina de estados
load-tests/       ⏳ Scripts de carga y caos (módulo 7)
```

- **Cuentas AWS:** cada persona desarrolla en **su propia cuenta** y despliega el stack completo; una **cuenta común de demo** (propuesta: la de P5) despliega `main`. Pruebas de carga y caos solo en la de demo. Perfil de AWS CLI `acap-dev` para la propia. Detalle en README §1.
- **IaC:** Terraform ≥ 1.10, provider AWS 6.x, región `eu-west-1`. Estado local en la cuenta propia; bucket S3 en la de demo (bloque comentado en `infra/versions.tf`). `.terraform.lock.hcl` sí se sube; `terraform.tfvars` no (está en `.gitignore`).
- **Nombres:** `acap-<env>-<recurso>` (p. ej. `acap-dev-seats`), tags `Project`, `Env`, `ManagedBy` por `default_tags`. Nada de ARN ni IDs de cuenta escritos a mano: se pasan por `outputs` de los módulos.
- **Recursos que cobran por hora** (ElastiCache, WAF, Kinesis): detrás de una variable `enable_<algo>`, a `false` por defecto.
- **Rutas de la API:** al añadir una ruta en `infra/modules/api`, incluirla en `triggers` del `aws_api_gateway_deployment` o no se redespliega. Falta configurar CORS (README 4.7).
- **Frontend:** `config.js` lo genera Terraform (`API_BASE_URL`, `USE_MOCKS`). Con `frontend_use_mocks = true` usa `js/mock-server.js`, que implementa el contrato: es la referencia de comportamiento para el backend real. Los valores de estados solo están en `frontend/js/constants.js`. Escapar siempre con `esc()` los datos de la API antes de meterlos en HTML.
- **Git:** `main` siempre desplegable; ramas cortas `feat/<tema>`; PR a `main` con revisión de otra persona; Conventional Commits (`feat:`, `fix:`, `docs:`, `build:`, `test:`).
- **Finales de línea:** el equipo mezcla Windows y WSL. Usar siempre el mismo git para el repo; en WSL, `git config --global core.autocrlf input`. Pendiente: añadir `.gitattributes` con `* text=auto eol=lf` y `*.pdf binary`.

### Comandos

```bash
# Frontend en local (con mocks)
cd frontend && python -m http.server 5173

# Desplegar en la cuenta propia
cd infra && cp terraform.tfvars.example terraform.tfvars   # poner budget_email
terraform init && terraform apply
terraform output                                            # web_url, api_url, tablas, colas
terraform destroy                                           # al acabar
```

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

## 8. Estado y siguientes pasos

Hecho (en `main`, 2026-11-19):

- [x] `README.md` con las decisiones a acordar y `CLAUDE.md`.
- [x] **Frontend del núcleo** contra mocks: catálogo, detalle con cuenta atrás, sala de espera (polling), mapa de asientos con 409, estado de comanda y entrada. Simulador con pago fallido (`card_fail`).
- [x] **Esqueleto Terraform**: 5 tablas DynamoDB con GSI, SQS de compras + DLQ, API Gateway REST con X-Ray (solo `GET /health`), S3 + CloudFront con `config.js` generado, alarma de AWS Budgets. Validado con `terraform plan` (36 recursos); todavía no desplegado.

Pendiente del núcleo para dejar de usar mocks:

- [ ] **Todos:** cerrar las decisiones 🔴 del README (sobre todo 3.1 lenguaje, 4.4 token de admisión, 5.4 idioma de estados, 6.1 mensaje SQS).
- [ ] **P5 Infra:** revisar `infra/`, script de datos semilla (mismo evento que `frontend/mocks/events.json`), CORS en la API, cuenta de demo.
- [ ] **P2 API:** Lambdas `GET /events`, `GET /events/{id}`, `GET /seats`, `POST .../reserve` (escritura condicional + SQS) y `GET /orders/{id}`, con test de doble reserva. La primera ruta completa (Lambda + IAM + ruta + CORS) sirve de patrón para los demás.
- [ ] **P3 Sala de espera:** contador atómico de turnos, ventana de admisión, `admissionToken`, `POST /queue` y `GET /queue/{turnId}`.
- [ ] **P4 Compra:** Lambda trabajadora SQS, Step Functions con pago simulado (éxito/fallo inyectable), liberación periódica de reservas caducadas.
- [ ] **P1 Frontend:** desplegar en la cuenta propia, poner `frontend_use_mocks = false` cuando existan los endpoints; después módulo 5 (Bedrock), 3b y la parte web del WebSocket.
