# Cola de compras estándar + dead-letter queue (RF-07, RF-13, especificación §7.5).
# Un mensaje solo va a la DLQ tras max_receive_count intentos: nunca se descarta en silencio.

variable "name_prefix" {
  type = string
}

variable "max_receive_count" {
  type = number
}

variable "worker_timeout_seconds" {
  type = number
}

resource "aws_sqs_queue" "purchases_dlq" {
  name                      = "${var.name_prefix}-purchases-dlq"
  message_retention_seconds = 1209600 # 14 días, para poder inspeccionarlos
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "purchases" {
  name                       = "${var.name_prefix}-purchases"
  visibility_timeout_seconds = 6 * var.worker_timeout_seconds # README 7.6
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 20 # long polling
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.purchases_dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# Solo la cola de compras puede usar esta DLQ.
resource "aws_sqs_queue_redrive_allow_policy" "purchases_dlq" {
  queue_url = aws_sqs_queue.purchases_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.purchases.arn]
  })
}

output "queue_url" {
  value = aws_sqs_queue.purchases.url
}

output "queue_arn" {
  value = aws_sqs_queue.purchases.arn
}

output "dlq_url" {
  value = aws_sqs_queue.purchases_dlq.url
}

output "dlq_arn" {
  value = aws_sqs_queue.purchases_dlq.arn
}
