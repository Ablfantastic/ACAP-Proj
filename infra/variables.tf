variable "aws_profile" {
  description = "Perfil de la AWS CLI (README 2.5): acap-dev en la cuenta propia, acap-demo en la común."
  type        = string
  default     = "acap-dev"
}

variable "region" {
  description = "Región AWS, la misma en todas las cuentas (README 1.5)."
  type        = string
  default     = "eu-west-1"
}

variable "project" {
  description = "Prefijo del proyecto en nombres y tags."
  type        = string
  default     = "acap"
}

variable "env" {
  description = "Entorno: dev (cuenta propia) o demo (cuenta común)."
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z0-9-]{2,12}$", var.env))
    error_message = "env: minúsculas, números o guiones, 2-12 caracteres."
  }
}

# --- Coste (README 1.6) -------------------------------------------------------

variable "budget_email" {
  description = "Correo para los avisos de presupuesto. Vacío = no se crea la alarma (no recomendado)."
  type        = string
  default     = ""
}

variable "budget_limit_usd" {
  description = "Límite mensual de la alarma de presupuesto, en USD."
  type        = number
  default     = 10
}

# --- Parámetros del núcleo (README §7) ----------------------------------------

variable "purchase_max_receive_count" {
  description = "Intentos de un mensaje de compra antes de ir a la DLQ (README 7.6)."
  type        = number
  default     = 3
}

variable "worker_timeout_seconds" {
  description = "Timeout previsto de la Lambda trabajadora; la visibilidad de la cola es 6 veces este valor (README 7.6)."
  type        = number
  default     = 30
}

# --- Frontend -----------------------------------------------------------------

variable "frontend_use_mocks" {
  description = "Escribe USE_MOCKS en config.js. true hasta que existan los endpoints reales."
  type        = bool
  default     = true
}
