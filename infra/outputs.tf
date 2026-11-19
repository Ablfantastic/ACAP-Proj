# Lo que necesitan las demás piezas (README 2.6): se pasan como variables de entorno a las Lambdas.

output "web_url" {
  description = "URL pública de la web (CloudFront)."
  value       = module.web.url
}

output "api_url" {
  description = "URL base de la API (API Gateway, con el stage)."
  value       = module.api.invoke_url
}

output "api_id" {
  description = "ID de la REST API, para añadirle rutas."
  value       = module.api.rest_api_id
}

output "tables" {
  description = "Nombres de las tablas DynamoDB."
  value       = module.data.table_names
}

output "table_arns" {
  description = "ARN de las tablas, para las políticas IAM de las Lambdas."
  value       = module.data.table_arns
}

output "purchase_queue_url" {
  value = module.queue.queue_url
}

output "purchase_queue_arn" {
  value = module.queue.queue_arn
}

output "purchase_dlq_url" {
  value = module.queue.dlq_url
}

output "web_bucket" {
  value = module.web.bucket
}
