# Web estática: bucket S3 privado servido solo a través de CloudFront (Origin Access Control).
# Sube el contenido de frontend/ y genera config.js con la URL de la API (README 8.2).

variable "name_prefix" {
  type = string
}

variable "account_id" {
  type = string
}

variable "frontend_dir" {
  description = "Carpeta con la web. Si no existe, se crea la infraestructura sin subir ficheros."
  type        = string
}

variable "app_config" {
  description = "Contenido de window.APP_CONFIG en config.js."
  type        = any
}

locals {
  content_types = {
    html = "text/html; charset=utf-8"
    js   = "text/javascript; charset=utf-8"
    css  = "text/css; charset=utf-8"
    json = "application/json"
    svg  = "image/svg+xml"
    png  = "image/png"
    jpg  = "image/jpeg"
    ico  = "image/x-icon"
    txt  = "text/plain; charset=utf-8"
  }

  # config.js lo genera Terraform; el README no se publica.
  site_files = [
    for f in fileset(var.frontend_dir, "**") : f
    if f != "config.js" && !endswith(f, ".md")
  ]
}

resource "aws_s3_bucket" "web" {
  # Los nombres de bucket son globales: el ID de cuenta evita choques entre cuentas.
  bucket        = "${var.name_prefix}-web-${var.account_id}"
  force_destroy = true # deja hacer terraform destroy con ficheros dentro
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name_prefix}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "${var.name_prefix} web"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # solo Europa y Norteamérica: más barato

  origin {
    origin_id                = "s3-web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Solo esta distribución de CloudFront puede leer el bucket.
resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web.arn } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.web]
}

# Ficheros de la web. "no-cache": el navegador y CloudFront revalidan, así un
# terraform apply se ve enseguida sin tener que invalidar la caché.
resource "aws_s3_object" "site" {
  for_each = toset(local.site_files)

  bucket        = aws_s3_bucket.web.id
  key           = each.value
  source        = "${var.frontend_dir}/${each.value}"
  etag          = filemd5("${var.frontend_dir}/${each.value}")
  content_type  = lookup(local.content_types, lower(element(split(".", each.value), length(split(".", each.value)) - 1)), "application/octet-stream")
  cache_control = "no-cache"
}

resource "aws_s3_object" "config" {
  bucket        = aws_s3_bucket.web.id
  key           = "config.js"
  content       = "// Generado por Terraform. No editar a mano.\nwindow.APP_CONFIG = ${jsonencode(var.app_config)};\n"
  content_type  = local.content_types.js
  cache_control = "no-cache"
}

output "url" {
  value = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "bucket" {
  value = aws_s3_bucket.web.id
}

output "distribution_id" {
  value = aws_cloudfront_distribution.web.id
}
