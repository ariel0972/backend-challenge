/* eslint-disable prettier/prettier */
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import { TransactionEntity } from "../infrastructure/database/transaction.entity";
import { processWager, type WagerKind } from "./process-wager";

export async function retryPendingReferences(orm: MikroORM) {
  const pending = await orm.em.fork().find(
    TransactionEntity,
    {
      status: "PENDING_REFERENCE",
      nextAttemptAt: { $lte: new Date() },
    },
    {
      limit: 50,
      orderBy: { nextAttemptAt: "asc" },
    },
  );

  for (const tx of pending) {
    if (!tx.idempotencyKey || !tx.context) {
      throw new Error("INVALID_PENDING_TRANSACTION");
    }

    await processWager(orm, {
      walletId: tx.walletId.id,
      amount: tx.amount,
      currency: tx.currency,
      idempotencyKey: tx.idempotencyKey,
      kind: tx.type as WagerKind,
      context: tx.context,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
    }, true);
  }
}

@Injectable()
export class ReferenceWorker
implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReferenceWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;

  constructor(
    @Inject(MikroORM)
    private readonly orm: MikroORM,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      if (this.stopping || this.running) return;

      this.running = retryPendingReferences(this.orm)
        .catch((error: unknown) => {
          this.logger.error(JSON.stringify({
            event: "reference_retry_failed",
            errorType: error instanceof Error ? error.name : "UnknownError",
          }));
        })
        .finally(() => {
          this.running = undefined;
        });
    }, 1000);
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
