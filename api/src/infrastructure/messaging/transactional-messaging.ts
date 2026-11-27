/* eslint-disable prettier/prettier */
import { EntityManager } from "@mikro-orm/postgresql";
import type { BetResult } from "../database/transaction.entity";
import {
  IntegrationEvent,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
  WalletBalanceChanged,
} from "../../domain/integration-event";

export interface Delivery {
  consumerName: string;
  messageId: string;
}

interface InboxRow {
  payload_hash: string;
  response: BetResult;
}

export class InboxSession {
  private constructor(
    private readonly em: EntityManager,
    private readonly delivery: Delivery | undefined,
    private readonly hash: string,
    readonly previous?: BetResult,
  ) {}

  static async open(
    em: EntityManager,
    delivery: Delivery | undefined,
    hash: string,
  ): Promise<InboxSession> {
    if (!delivery) {
      return new InboxSession(em, undefined, hash);
    }

    // Serializa somente entregas com a mesma identidade.
    // O lock desaparece automaticamente no commit/rollback.
    await em.execute(
      "select pg_advisory_xact_lock(hashtextextended(?, 0))",
      [JSON.stringify([delivery.consumerName, delivery.messageId])],
    );

    const rows: InboxRow[] = await em.execute(
      `select payload_hash, response
       from inbox_messages
       where consumer_name = ? and message_id = ?`,
      [delivery.consumerName, delivery.messageId],
    );

    const existing = rows[0];

    if (existing && existing.payload_hash !== hash) {
      throw new Error("INBOX_PAYLOAD_CONFLICT");
    }

    return new InboxSession(
      em,
      delivery,
      hash,
      existing?.response,
    );
  }

  async complete(response: BetResult): Promise<BetResult> {
    if (!this.delivery || this.previous) {
      return response;
    }

    await this.em.execute(
      `insert into inbox_messages
         (consumer_name, message_id, payload_hash, response)
       values (?, ?, ?, ?::jsonb)`,
      [
        this.delivery.consumerName,
        this.delivery.messageId,
        this.hash,
        JSON.stringify(response),
      ],
    );

    return response;
  }
}

export async function enqueueEvent(
  em: EntityManager,
  event: IntegrationEvent,
): Promise<void> {
  await em.execute(
    `insert into outbox_events
      (id, aggregate_id, event_type, payload, occurred_at)
     values (?, ?, ?, ?::jsonb, ?)`,
    [
      event.eventId,
      event.aggregateId,
      event.eventType,
      JSON.stringify(event.toJSON()),
      new Date(event.occurredAt),
    ],
  );
}

interface Outcome {
  transactionId: string;
  walletId: string;
  kind: string;
  status: string;
  previousStatus: string;
  rejectionCode: string | null;
  before: { amount: string; currency: string };
  after: { amount: string; currency: string };
  walletVersion: number;
  correlationId: string;
  causationId?: string;
}

export async function enqueueOutcome(
  em: EntityManager,
  outcome: Outcome,
): Promise<void> {
  const {
    walletId,
    correlationId,
    causationId,
    status,
    previousStatus,
  } = outcome;

  const data = {
    transactionId: outcome.transactionId,
    walletId,
    kind: outcome.kind,
    status,
    rejectionCode: outcome.rejectionCode,
    balance: outcome.after,
    walletVersion: outcome.walletVersion,
  };

  // Uma tentativa ainda pendente não repete o evento da mesma transição.
  if (status !== previousStatus) {
    let event: IntegrationEvent;

    if (status === "PROCESSED") {
      event = new WagerTransactionProcessed(
        walletId, correlationId, data, causationId,
      );
    } else if (status === "REJECTED") {
      event = new WagerTransactionRejected(
        walletId, correlationId, data, causationId,
      );
    } else if (status === "PENDING_REFERENCE") {
      event = new WagerTransactionPendingReference(
        walletId, correlationId, data, causationId,
      );
    } else {
      throw new Error("UNSUPPORTED_OUTBOX_STATUS");
    }

    await enqueueEvent(em, event);
  }

  if (
    status === "PROCESSED" &&
    outcome.before.amount !== outcome.after.amount
  ) {
    await enqueueEvent(em, new WalletBalanceChanged(
      walletId,
      correlationId,
      {
        transactionId: outcome.transactionId,
        walletId,
        before: outcome.before,
        after: outcome.after,
        walletVersion: outcome.walletVersion,
      },
      causationId,
    ));
  }
}