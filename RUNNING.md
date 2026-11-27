# Execução local

## Pré-requisitos

- Bun 1.x
- Docker com Compose

## Dependências

Na raiz:

    docker compose up -d

## Configuração

Dentro de api:

    bun install --frozen-lockfile

Copie .env.example para .env e confira as credenciais do PostgreSQL
conforme compose.yaml.

A aplicação é executada no host:
DB_HOST aponta para localhost e DB_PORT para a porta publicada
do PostgreSQL.

SQS_ENDPOINT deve apontar para http://localhost:4566.
MESSAGING_ENABLED=true habilita consumidor e publisher.

## Banco e filas

Dentro de api:

    bun --env-file=.env ./node_modules/@mikro-orm/cli/cli.js migration:up --config ./src/mikro-orm.config.ts
    bun --env-file=.env ./scripts/setup-queues.ts

Execute setup-queues novamente caso o emulador seja recriado.

## Aplicação

    bun run build
    bun --env-file=.env dist/main.js

Porta padrão: 3000.

## Testes financeiros

    bun --env-file=.env test ./test/bet.integration.spec.ts ./test/reconciliation.integration.spec.ts ./test/ledger-safety.integration.spec.ts ./test/operations.integration.spec.ts

Use um banco dedicado aos testes.
A suíte de segurança instala temporariamente triggers e a suíte de
reconciliação provoca uma divergência controlada.

## Smoke SQS

Com a aplicação rodando, em outro terminal dentro de api:

    bun --env-file=.env ./scripts/sqs-smoke.ts

Resultado esperado: SQS_SMOKE_OK, saldo 80.00, versão 2,
duas mensagens de inbox e quatro eventos publicados.

## Endpoints

- POST /wallets
- GET /wallets/:walletId
- GET /wallets/:walletId/ledger?limit=50&cursor=...
- POST /wallets/:walletId/reconciliation
- POST /wagering/transactions
- GET /wagering/transactions/:transactionId
- GET /wagering/transactions?providerId=...&externalTransactionId=...
- GET /health/live
- GET /health/ready

POST /wagering/transactions exige Idempotency-Key.

Valores monetários são objetos com amount em string decimal
e currency, por exemplo:

    {"amount":"20.00","currency":"BRL"}

Para REFUND e ROLLBACK, referenceExternalTransactionId pertence
ao corpo principal, ao lado de kind e money.

## Limitações

Consulte ARCHITECTURE.md.