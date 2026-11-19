# Infraestructura (Terraform)

Esqueleto del núcleo. El mismo código despliega en la cuenta de cada uno y en la de demo; solo cambia `terraform.tfvars` (README principal, 2.3).

## Qué crea

| Módulo | Recursos | Para |
|---|---|---|
| `data` | 5 tablas DynamoDB on-demand: `events`, `seats`, `queue`, `orders`, `tickets` (con los GSI de README 5.7) | Todos |
| `queue` | Cola SQS `purchases` + DLQ `purchases-dlq` (`maxReceiveCount = 3`, visibilidad = 6 × timeout de la trabajadora) | P2 publica, P4 consume |
| `api` | REST API Gateway con stage `dev`, X-Ray activado y solo `GET /health` (mock) | P2, P3, P4 añaden rutas |
| `web` | Bucket S3 privado + CloudFront (OAC), sube `frontend/` y genera `config.js` con la URL de la API | P1 |
| raíz | Alarma de AWS Budgets (si hay `budget_email`) | Todos |

Nada de esto cobra por hora: sin tráfico, el coste es prácticamente 0. Aun así, `terraform destroy` al acabar.

## Uso

Requisitos: Terraform ≥ 1.10 y un perfil de AWS CLI (README principal, 2.5).

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # y pon tu correo en budget_email
terraform init
terraform plan        # revisa qué se va a crear
terraform apply
terraform output      # URLs, nombres de tablas y colas
```

Comprobar que funciona:

```bash
curl "$(terraform output -raw api_url)/health"   # {"status":"ok"}
```

y abrir `terraform output -raw web_url` en el navegador (la primera vez, CloudFront tarda unos minutos).

Para apagarlo todo:

```bash
terraform destroy
```

## Cómo añadir piezas

- **Lambdas** (P2, P3, P4): crear un módulo nuevo en `modules/` (o recursos en uno existente) y pasarle por variables los outputs que necesite: `module.data.table_names`, `module.data.table_arns`, `module.queue.queue_arn`... Nunca nombres ni ARN escritos a mano (README 2.6).
- **Rutas de la API**: en `modules/api/main.tf`, con integración `AWS_PROXY` a la Lambda. Hay que añadir sus IDs a `triggers` del `aws_api_gateway_deployment`, o el stage no se redespliega.
- **CORS**: cuando haya rutas reales, la API tiene que permitir el dominio de CloudFront (`module.web.url`) y `http://localhost:5173` (README 4.7).
- **Módulos que cobran por hora** (ElastiCache, WAF, Kinesis): detrás de una variable `enable_<algo>` con `count`, a `false` por defecto (README 1.6).

## Estado

En la cuenta propia el estado es local (`terraform.tfstate`, en `.gitignore`). Para la cuenta de demo, ver el bloque `backend "s3"` comentado en `versions.tf`.

El fichero `.terraform.lock.hcl` **sí** se sube al repo: fija la versión del provider para todo el equipo.
