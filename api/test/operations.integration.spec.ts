/* eslint-disable prettier/prettier */
import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../src/mikro-orm.config";
import { openWallet } from "../src/application/open-wallet";
import { processWager, type WagerKind } from "../src/application/process-wager";
import { reconcileWallet } from "../src/application/reconcile-wallet";
import { retryPendingReferences } from "../src/application/reference-worker";
import { TransactionEntity } from "../src/infrastructure/database/transaction.entity";

test("WIN, LOSS, REFUND, ROLLBACK e referência fora de ordem", async () => {
  const orm = await MikroORM.init(config);

  try {
    const playerId = randomUUID();
    const wallet = await openWallet(orm, {
      playerId,
      amount: "100.00",
      currency: "BRL",
    });

    const providerId = `provider-${randomUUID()}`;

    function send(
      kind: WagerKind,
      amount: string,
      externalTransactionId: string,
      referenceExternalTransactionId?: string,
    ) {
      return processWager(orm, {
        kind,
        amount,
        currency: "BRL",
        walletId: wallet.id,
        idempotencyKey: `${providerId}:${externalTransactionId}`,
        context: {
          providerId,
          externalTransactionId,
          playerId,
          roundId: "round-1",
          gameId: "game-1",
        },
        referenceExternalTransactionId,
      });
    }

    expect((await send("BET", "80.00", "bet-1")).balance.amount)
      .toBe("20.00");

    expect((await send("WIN", "30.00", "win-1", "bet-1")).balance.amount)
      .toBe("50.00");

    expect((await send("LOSS", "0.00", "loss-1")).balance.amount)
      .toBe("50.00");

    expect((await send("REFUND", "80.00", "refund-1", "bet-1")).balance.amount)
      .toBe("130.00");

    const duplicate = await send("REFUND", "80.00", "refund-2", "bet-1");
    expect(duplicate.status).toBe("REJECTED");
    expect(duplicate.rejectionCode).toBe("REFERENCE_ALREADY_REVERSED");

    expect(
      (await send("ROLLBACK", "30.00", "rollback-1", "win-1")).balance.amount,
    ).toBe("100.00");

    // Consome o saldo para impedir a reversão do crédito do refund.
    await send("BET", "90.00", "bet-spend");

    const insufficient = await send(
      "ROLLBACK", "80.00", "rollback-refund", "refund-1",
    );

    expect(insufficient.status).toBe("REJECTED");
    expect(insufficient.rejectionCode).toBe("REVERSAL_INSUFFICIENT_FUNDS");

    // REFUND chega antes de sua BET.
    const pending = await send(
      "REFUND", "5.00", "refund-late", "bet-late",
    );

    expect(pending.status).toBe("PENDING_REFERENCE");

    await send("BET", "5.00", "bet-late");

    // Torna somente este registro elegível, sem esperar o relógio.
    await orm.em.fork().nativeUpdate(
      TransactionEntity,
      { id: pending.transactionId },
      { nextAttemptAt: new Date(0) },
    );

    await retryPendingReferences(orm);

    const resumed = await orm.em.fork().findOneOrFail(
      TransactionEntity,
      { id: pending.transactionId },
    );

    expect(resumed.status).toBe("PROCESSED");
    expect(resumed.response!.balance.amount).toBe("10.00");

    const reconciliation = await reconcileWallet(orm, wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.calculatedBalance.amount).toBe("10.00");
  } finally {
    await orm.close();
  }
}, 30_000);
