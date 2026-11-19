# ACAP — Plataforma de venta de entradas de alta concurrencia

Web de venta de entradas en AWS que aguanta avalanchas al abrir la venta sin vender nunca dos veces el mismo asiento. Equipo: Adrià, Emma, Marc, Abel, Albert.

- Especificación completa: [`docs/especificacio.md`](docs/especificacio.md)
- Resumen operativo, reparto y tareas: [`CLAUDE.md`](CLAUDE.md)

---

## Decisiones a acordar antes de trabajar en paralelo

Hay que cerrar esto **antes de que cada uno abra su rama**. Si no, cada parte se inventa sus propios nombres, formatos y endpoints, y juntarlo después costará mucho. Cada punto lleva una **propuesta** para no partir de cero: se puede aceptar tal cual o cambiar. Cuando algo se decida, se marca `[x]` y se apunta aquí la decisión final.

Prioridad: 🔴 bloquea a varios hoy · 🟡 bloquea a una o dos personas · 🟢 puede esperar.

### 1. Cuenta y entorno AWS 🔴

| # | Decisión | Propuesta | Afecta a |
|---|---|---|---|
| [ ] 1.1 | ¿Una cuenta compartida o una por persona? | **Cada uno desarrolla en su propia cuenta AWS** y despliega allí el stack completo con Terraform (no solo su parte: así puede probar de punta a punta). Además hay **una cuenta común de integración/demo** (la de una persona, p. ej. P5), donde se despliega `main` | Todos |
| [ ] 1.2 | ¿Qué cuenta es la de la demo? | La de P5 (infra y pruebas). Las pruebas de carga y los experimentos de caos se hacen **solo** ahí | P5 |
| [ ] 1.3 | Acceso a la cuenta de demo | Un usuario IAM (o IAM Identity Center) por persona, con MFA y permisos `PowerUserAccess` + creación de roles `acap-*`. Nunca usar root ni compartir claves. En la cuenta propia, cada uno trabaja también con un usuario IAM, no con root | P5 |
| [ ] 1.4 | Solicitudes a AWS con antelación | Se piden **en cada cuenta que lo necesite**. **Bedrock:** activar el acceso a los modelos (cuenta de P1 y la de demo). **SES:** en sandbox solo envía a correos verificados; en la cuenta de P4 y la de demo, verificar los correos del equipo (o pedir salir del sandbox en la de demo, tarda ~1 día) | P1, P4, P5 |
| [ ] 1.5 | Región | `eu-west-1` (Irlanda), **la misma en todas las cuentas**: tiene todos los servicios, Bedrock incluido | Todos |
| [ ] 1.6 | Control de coste (**obligatorio, cuentas reales**) | **En cada cuenta**: alarma de AWS Budgets (p. ej. 10 € en las personales, 20–30 € en la de demo, avisos al 50/80/100 %), tag `Project=acap` en todo, `terraform destroy` al acabar cada sesión. Cuidado con lo que cobra por hora aunque no se use: **ElastiCache, WAF, Kinesis (por shard), NAT Gateway** (evitarlo: las Lambdas no necesitan VPC salvo para Redis). Para no pagar de más, se pueden activar con un flag de Terraform (`enable_redis`, `enable_waf`, `enable_kinesis`...) solo quien los esté desarrollando. ¿Cómo repartimos el gasto de la cuenta de demo? | Todos |

> **Aviso:** este modelo tiene un coste: un fallo de integración, como que la API y el flujo de compra no encajen, no aparece hasta que el código llega a la cuenta de demo. Por eso conviene hacer merge a `main` pequeño y a menudo.

### 2. Infraestructura como código 🔴

| # | Decisión | Propuesta |
|---|---|---|
| [ ] 2.1 | Herramienta | Terraform (el `.gitignore` ya está preparado para él). Alternativas: SAM o CDK |
| [ ] 2.2 | Dónde se guarda el estado | **Cuenta propia:** estado local (ya está en `.gitignore`) o un bucket propio; solo lo toca uno. **Cuenta de demo:** bucket S3 + bloqueo, creado una vez por P5, porque ahí sí despliega más de una persona |
| [ ] 2.3 | Estructura | `infra/` con un módulo por pieza (`web`, `api`, `data`, `queue`, `workflow`, `streaming`, `waf`...) y un `main.tf` raíz que los une. **El mismo código despliega en cualquier cuenta**: lo único que cambia es un `<nombre>.tfvars` local (perfil AWS, entorno, flags) |
| [ ] 2.4 | Nombres y tags | `acap-<entorno>-<recurso>` (p. ej. `acap-dev-seats`, `acap-demo-seats`); tags `Project=acap`, `Env=<entorno>`. Nada de IDs de cuenta ni ARN escritos a mano en el código, o solo funcionará en una cuenta |
| [ ] 2.5 | Credenciales locales | Un perfil de AWS CLI por cuenta (`acap-dev` para la propia, `acap-demo` para la común), elegido en el `tfvars`. Las claves nunca van al repo |
| [ ] 2.6 | Cómo se pasan datos entre módulos | Por `outputs` de Terraform (ARN de la cola, nombre de las tablas, URL de la API...) y variables de entorno en las Lambdas. Nunca valores escritos a mano en el código |

### 3. Código backend 🔴

| # | Decisión | Propuesta |
|---|---|---|
| [ ] 3.1 | Lenguaje de las Lambdas | Python 3.12 + boto3, que ya viene incluido en el runtime |
| [ ] 3.2 | Organización | `backend/<función>/handler.py` y una carpeta `backend/common/` compartida (cliente de DynamoDB, respuestas HTTP, logging) |
| [ ] 3.3 | Empaquetado | Terraform `archive_file` (un zip por función); una capa (layer) si hacen falta dependencias |
| [ ] 3.4 | Tests | `pytest` + `moto` para simular DynamoDB/SQS en local. Test obligatorio: dos reservas simultáneas del mismo asiento → una falla |
| [ ] 3.5 | Logs | JSON estructurado con `orderId`, `eventId`, `seatId` en cada línea; X-Ray activado desde el principio (lo necesita el módulo 7) |

### 4. Contrato de API 🔴

Es lo que más bloquea: frontend, API, sala de espera y compra dependen de él.

| # | Decisión | Propuesta |
|---|---|---|
| [ ] 4.1 | Tipo de API Gateway | REST API (v1): es compatible con WAF, X-Ray y validación de peticiones. La HTTP API es más barata pero no admite WAF directamente |
| [ ] 4.2 | Rutas | Las de la tabla de abajo |
| [ ] 4.3 | Identidad del usuario de demo | Cabecera `X-Session-Id` (UUID generado en el navegador y guardado en `localStorage`) |
| [ ] 4.4 | Prueba de que el usuario ha sido admitido | Al ser admitido, la sala de espera devuelve un `admissionToken`; `GET /seats` y `POST /reserve` lo exigen en la cabecera `X-Admission-Token` |
| [ ] 4.5 | Formato de error | `{ "error": { "code": "SEAT_TAKEN", "message": "..." } }` |
| [ ] 4.6 | Códigos HTTP | `200/201` OK · `202` aceptado (comanda en cola) · `400` validación · `403` no admitido o turno expirado · `404` no existe · `409` asiento ocupado o ya reservado · `429` rate limit (WAF) |
| [ ] 4.7 | CORS | Permitir el dominio de CloudFront (y `localhost` mientras se desarrolla) |
| [ ] 4.8 | Fechas e importes | Fechas en ISO 8601 UTC en la API; importes en **céntimos (entero)**, para evitar errores de redondeo con decimales |

Rutas propuestas:

| Método | Ruta | Respuesta principal | Responsable |
|---|---|---|---|
| GET | `/events` | `[{ eventId, name, artist, venue, date, saleStatus, saleOpensAt }]` | P2 |
| GET | `/events/{eventId}` | evento + `zones: [{ zoneId, name, basePrice, currentPrice, capacity, available }]` | P2 |
| POST | `/events/{eventId}/queue` | `{ turnId, turnNumber, position, status }` | P3 |
| GET | `/events/{eventId}/queue/{turnId}` | `{ position, status, admissionToken? }` | P3 |
| GET | `/events/{eventId}/seats` | `[{ seatId, zoneId, row, number, status }]` | P2 / P3 |
| POST | `/events/{eventId}/seats/{seatId}/reserve` | `202 { orderId, status: "en_cola", expiresAt }` o `409` | P2 |
| GET | `/orders/{orderId}` | `{ orderId, status, seatId, ticket? }` | P2 |
| GET | `/tickets/{ticketId}/verify` | `{ valid: true/false }` (módulo 4c) | P4 |
| WS | `wss://...` | mensajes `position`, `seat_update`, `price_update` (módulo 2) | P3 / P1 |

> Duda que hay que resolver: ¿la reserva y el envío de la compra son una sola llamada (reservar = enviar a SQS, como en la especificación §7.2) o dos (`reserve` y luego `checkout`)? La propuesta es una sola, como dice la especificación.

### 5. Modelo de datos (DynamoDB) 🔴

| # | Decisión | Propuesta |
|---|---|---|
| [ ] 5.1 | Una tabla única (single-table) o varias | **Varias tablas**: es más fácil de entender, de repartir y de explicar en la demo |
| [ ] 5.2 | Claves | Tabla de abajo |
| [ ] 5.3 | Formato de `seatId` | `{zoneId}#{fila}#{numero}`, p. ej. `PISTA#A#12` |
| [ ] 5.4 | Valores de los estados | Los de la especificación, en minúsculas y con `_`: `libre`, `reservado`, `vendido`... (lista en `CLAUDE.md`). ¿Catalán, castellano o inglés en el código? Elegir uno y no mezclar |
| [ ] 5.5 | Caducidad de reservas | Atributo `expiresAt` en epoch (segundos). La liberación la hace una Lambda programada con escritura condicional. **No** sirve el TTL de DynamoDB, porque borra el ítem en lugar de devolverlo a `libre` y puede tardar horas |
| [ ] 5.6 | Número de turno | Contador atómico (`UpdateItem ADD`) en un ítem `COUNTER` por evento |
| [ ] 5.7 | Índices secundarios | GSI en `Orders` por `cardId` y por `ip` (para el antifraude 4b); GSI en `Seats` por `status` (para buscar las reservas caducadas) |
| [ ] 5.8 | Capacidad | On-demand (`PAY_PER_REQUEST`): no hay que calcular capacidad y se paga solo lo que se usa |

| Tabla | PK | SK | Atributos |
|---|---|---|---|
| `Events` | `eventId` | `META` \| `ZONE#{zoneId}` \| `COUNTER` | nombre, recinto, fecha, `saleStatus`, `saleOpensAt`, `admitWindow`; zonas: `basePrice`, `currentPrice`, `minPrice`, `maxPrice`, `capacity` |
| `Seats` | `eventId` | `seatId` | `zoneId`, `row`, `number`, `status`, `orderId`, `expiresAt` |
| `Queue` | `eventId` | `turnNumber` | `turnId`, `sessionId`, `enteredAt`, `status` |
| `Orders` | `orderId` | — | `eventId`, `seatId`, `sessionId`, `status`, `idempotencyKey`, `cardId`, `ip`, `price`, `flagged`, `createdAt` |
| `Tickets` | `ticketId` | — | `orderId`, `seatId`, `code`, `signature` (módulo 4c) |

### 6. Mensajes entre piezas 🟡

| # | Decisión | Propuesta | Entre |
|---|---|---|---|
| [ ] 6.1 | Mensaje SQS de compra | `{ orderId, eventId, seatId, sessionId, price, cardId, ip, idempotencyKey }` | P2 → P4 |
| [ ] 6.2 | Entrada/salida de Step Functions | La entrada es el mismo mensaje de SQS; cada paso añade `status` y, al final, `ticketId` | P4 |
| [ ] 6.3 | ¿Quién actualiza el estado de la comanda? | Solo Step Functions (y la API al crearla como `en_cola`) | P2 / P4 |
| [ ] 6.4 | Evento Kinesis | `{ type: "visit"\|"reserve"\|"purchase", eventId, zoneId, seatId?, orderId?, price?, ts }`, partition key `eventId` | P2 → P1 (3b), P3 (3c) |
| [ ] 6.5 | Mensajes WebSocket | `{ type: "position", position }`, `{ type: "seat_update", seatId, status }`, `{ type: "price_update", zoneId, price }` | P3 → P1 |

### 7. Parámetros de negocio 🟡

| # | Parámetro | Propuesta |
|---|---|---|
| [ ] 7.1 | Duración de una reserva | 5 minutos |
| [ ] 7.2 | Usuarios admitidos a la vez | 50 (configurable por evento: `admitWindow`) |
| [ ] 7.3 | Tamaño del mapa de la demo | 2–3 zonas, ~100 asientos en total (visible en pantalla) |
| [ ] 7.4 | Asientos por compra | 1 por comanda (simplifica la idempotencia). ¿Permitimos varios? |
| [ ] 7.5 | Pago simulado | Probabilidad de fallo configurable por variable de entorno (`PAYMENT_FAILURE_RATE=0.1`) y una "tarjeta" mágica que siempre falla (`card_fail`) |
| [ ] 7.6 | Reintentos SQS antes de la DLQ | `maxReceiveCount = 3`; `visibilityTimeout` ≥ 6 × timeout de la Lambda trabajadora |
| [ ] 7.7 | Precio dinámico (3b) | Ventana de 1 min; si las reservas de una zona superan un umbral, +10 % hasta `maxPrice`; si no hay demanda, −5 % hasta `minPrice` |
| [ ] 7.8 | Antifraude (4b) | Marcar si una misma `cardId` o `ip` acumula > 4 entradas por evento |
| [ ] 7.9 | WAF (4a) | Rate limit de 100 peticiones / 5 min por IP + `AWSManagedRulesBotControlRuleSet` (cuidado: no bloquear nuestras propias pruebas de carga) |

### 8. Frontend 🟡

| # | Decisión | Propuesta |
|---|---|---|
| [ ] 8.1 | Tecnología | HTML + JS vanilla (o Vite sin framework). Fácil de servir desde S3, sin build complicado |
| [ ] 8.2 | URL de la API | Fichero `config.js` generado por Terraform al desplegar |
| [ ] 8.3 | Mocks | Datos JSON en `frontend/mocks/` que siguen exactamente el contrato de §4, para trabajar sin backend |
| [ ] 8.4 | Polling | Consultar la posición cada 2–3 s en el núcleo; con el módulo 2, pasar a WebSocket |

### 9. Forma de trabajar 🔴

| # | Decisión | Propuesta |
|---|---|---|
| [ ] 9.1 | Ramas | `main` siempre desplegable; ramas cortas `feat/<tema>` (`feat/frontend`, `feat/api-reservas`, `feat/sala-espera`, `feat/compra`, `feat/infra`) |
| [ ] 9.2 | Integración | Pull request a `main` con revisión de al menos una persona; PR pequeños y frecuentes |
| [ ] 9.3 | Commits | Conventional Commits (`feat:`, `fix:`, `docs:`, `build:`, `test:`) |
| [ ] 9.4 | Idioma | Código e identificadores en inglés; documentación en catalán o castellano. ¿Y los valores de los estados? (ver 5.4) |
| [ ] 9.5 | Comunicación | Cambios en el contrato (§4–6) → se avisa al grupo y se actualiza este README **antes** de hacer el merge |
| [ ] 9.6 | Despliegue | Cada uno despliega su rama en su cuenta. Lo que entra en `main` se despliega en la cuenta de demo (lo hace P5, o un GitHub Action más adelante), y ahí se prueba la integración de todas las piezas antes de la entrega |
| [ ] 9.7 | Datos de prueba | Un script común de datos semilla (`scripts/seed`) para que todas las cuentas tengan el mismo evento, las mismas zonas y los mismos asientos |

### 10. Demo e informe 🟢

| # | Decisión | Propuesta |
|---|---|---|
| [ ] 10.1 | Herramienta de carga | k6 o Locust (scripts que llaman a la API) |
| [ ] 10.2 | Escenario de carga | 1 000–5 000 usuarios virtuales durante 5 min, **solo en la cuenta de demo**; fijar la cifra según el coste y los límites de la cuenta (en cuentas nuevas, la concurrencia de Lambda puede estar limitada a menos de 1 000: revisarlo en Service Quotas y pedir un aumento si hace falta) |
| [ ] 10.3 | Métricas y gráficas | Dashboard de CloudWatch: peticiones, latencia p50/p95, profundidad de SQS, comandas confirmadas/fallidas, mensajes en la DLQ |
| [ ] 10.4 | Experimentos de caos (FIS) | Lambda trabajadora que falla + cola que no se consume → mostrar los reintentos, la DLQ y que la venta sigue siendo coherente |

---

## Decisiones tomadas


