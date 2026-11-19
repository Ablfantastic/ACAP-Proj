locals {
  # acap-<entorno>-<recurso> (README 2.4)
  name_prefix = "${var.project}-${var.env}"
}

# Tablas DynamoDB del núcleo (README §5). Fuente de verdad.
module "data" {
  source      = "./modules/data"
  name_prefix = local.name_prefix
}

# Cola de compras + dead-letter queue (RF-07, RF-13).
module "queue" {
  source                 = "./modules/queue"
  name_prefix            = local.name_prefix
  max_receive_count      = var.purchase_max_receive_count
  worker_timeout_seconds = var.worker_timeout_seconds
}

# API Gateway REST (README 4.1). De momento solo /health; las rutas las añaden P2/P3/P4.
module "api" {
  source      = "./modules/api"
  name_prefix = local.name_prefix
  stage_name  = var.env
}

# Web estática: S3 privado + CloudFront, sube frontend/ y genera config.js (README 8.2).
module "web" {
  source       = "./modules/web"
  name_prefix  = local.name_prefix
  account_id   = data.aws_caller_identity.current.account_id
  frontend_dir = "${path.root}/../frontend"
  app_config = {
    API_BASE_URL     = module.api.invoke_url
    USE_MOCKS        = var.frontend_use_mocks
    POLL_INTERVAL_MS = 2500
  }
}
