provider "aws" {
  region  = var.region
  profile = var.aws_profile

  # Tags en todos los recursos (README 1.6 y 2.4): permiten ver el coste y limpiar.
  default_tags {
    tags = {
      Project   = var.project
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
