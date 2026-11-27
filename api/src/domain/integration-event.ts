import { randomUUID } from "node:crypto";

export abstract class IntegrationEvent {
  abstract readonly eventType: string;

  readonly eventId = randomUUID();
  readonly occurredAt = new Date().toISOString();
  readonly version = 1;

  constructor(
    readonly aggregateId: string,
    readonly correlationId: string,
    readonly data: Readonly<Record<string, unknown>>,
    readonly causationId?: string,
  ) {}

  toJSON() {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt,
      version: this.version,
      data: this.data,
    };
  }
}

export class WagerTransactionProcessed extends IntegrationEvent {
  readonly eventType = "WagerTransactionProcessed";
}

export class WagerTransactionRejected extends IntegrationEvent {
  readonly eventType = "WagerTransactionRejected";
}

export class WagerTransactionPendingReference extends IntegrationEvent {
  readonly eventType = "WagerTransactionPendingReference";
}

export class WalletBalanceChanged extends IntegrationEvent {
  readonly eventType = "WalletBalanceChanged";
}