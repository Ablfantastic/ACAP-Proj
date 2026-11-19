# Tablas del núcleo (README §5). On-demand (5.8) y sin protección de borrado,
# para poder hacer terraform destroy al acabar (RNF-07).

variable "name_prefix" {
  type = string
}

# Events: PK eventId, SK META | ZONE#{zoneId} | COUNTER (contador de turnos, README 5.6)
resource "aws_dynamodb_table" "events" {
  name         = "${var.name_prefix}-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "eventId"
  range_key    = "sk"

  attribute {
    name = "eventId"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
}

# Seats: PK eventId, SK seatId ({zoneId}#{fila}#{numero}, README 5.3).
# La unicidad del asiento (RNF-01) se cierra aquí con ConditionExpression.
resource "aws_dynamodb_table" "seats" {
  name         = "${var.name_prefix}-seats"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "eventId"
  range_key    = "seatId"

  attribute {
    name = "eventId"
    type = "S"
  }
  attribute {
    name = "seatId"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }
  attribute {
    name = "expiresAt"
    type = "N"
  }

  # Para buscar reservas caducadas (README 5.7). Índice disperso: solo entran
  # los asientos con expiresAt, es decir, los reservados.
  global_secondary_index {
    name = "by-status-expires"
    key_schema {
      attribute_name = "status"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "expiresAt"
      key_type       = "RANGE"
    }
    projection_type = "KEYS_ONLY"
  }
}

# Queue: PK eventId, SK turnNumber. GSI por turnId para GET /events/{id}/queue/{turnId}.
resource "aws_dynamodb_table" "queue" {
  name         = "${var.name_prefix}-queue"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "eventId"
  range_key    = "turnNumber"

  attribute {
    name = "eventId"
    type = "S"
  }
  attribute {
    name = "turnNumber"
    type = "N"
  }
  attribute {
    name = "turnId"
    type = "S"
  }

  global_secondary_index {
    name = "by-turnId"
    key_schema {
      attribute_name = "turnId"
      key_type       = "HASH"
    }
    projection_type = "ALL"
  }
}

# Orders: PK orderId. GSI por cardId e ip para el antifraude 4b (README 5.7).
resource "aws_dynamodb_table" "orders" {
  name         = "${var.name_prefix}-orders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "orderId"

  attribute {
    name = "orderId"
    type = "S"
  }
  attribute {
    name = "cardId"
    type = "S"
  }
  attribute {
    name = "ip"
    type = "S"
  }
  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name = "by-card"
    key_schema {
      attribute_name = "cardId"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "createdAt"
      key_type       = "RANGE"
    }
    projection_type = "KEYS_ONLY"
  }

  global_secondary_index {
    name = "by-ip"
    key_schema {
      attribute_name = "ip"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "createdAt"
      key_type       = "RANGE"
    }
    projection_type = "KEYS_ONLY"
  }
}

# Tickets: PK ticketId. La comanda guarda su ticketId para devolverlo en GET /orders.
resource "aws_dynamodb_table" "tickets" {
  name         = "${var.name_prefix}-tickets"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "ticketId"

  attribute {
    name = "ticketId"
    type = "S"
  }
}

locals {
  tables = {
    events  = aws_dynamodb_table.events
    seats   = aws_dynamodb_table.seats
    queue   = aws_dynamodb_table.queue
    orders  = aws_dynamodb_table.orders
    tickets = aws_dynamodb_table.tickets
  }
}

output "table_names" {
  value = { for k, t in local.tables : k => t.name }
}

output "table_arns" {
  value = { for k, t in local.tables : k => t.arn }
}
