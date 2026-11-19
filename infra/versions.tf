terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0, < 7.0"
    }
  }

  # Cuenta propia: estado local (README 2.2). Para la cuenta de demo, P5 crea el bucket
  # y se descomenta esto (con `terraform init -migrate-state`):
  #
  # backend "s3" {
  #   bucket       = "acap-demo-tfstate-<account_id>"
  #   key          = "core/terraform.tfstate"
  #   region       = "eu-west-1"
  #   use_lockfile = true
  # }
}
