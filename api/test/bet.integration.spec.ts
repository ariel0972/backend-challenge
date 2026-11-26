/* eslint-disable prettier/prettier */
import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../src/mikro-orm.config";
import { openWallet } from "../src/application/open-wallet";
import { placeBet } from "../src/application/place-bet";
import { WalletEntity } from "../src/infrastructure/database/wallet.entity";
import { TransactionEntity } from "../src/infrastructure/database/transaction.entity";
import { LedgerEntryEntity } from "../src/infrastructure/database/ledgerEntry.entity";

test(
  "duas apostas de 80 sobre 100 deixam 20 e apenas um débito",
  async () => {
    const orm = await MikroORM.init(config);

    try {
      const wallet = await openWallet(orm, {
        playerId: randomUUID(),
        amount: "100.00",
        currency: "BRL",
      });

      const input = {
        walletId: wallet.id,
        amount: "80.00",
        currency: "BRL",
      };

      // Cada chamada cria seu próprio contexto e transação.
      const results = await Promise.all([
        placeBet(orm, { ...input, idempotencyKey: randomUUID() }),
        placeBet(orm, { ...input, idempotencyKey: randomUUID() }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        "PROCESSED",
        "REJECTED",
      ]);

      expect(
        results.find((r) => r.status === "REJECTED")?.rejectionCode,
      ).toBe("INSUFFICIENT_FUNDS");

      // Contexto novo para conferir o estado persistido.
      const em = orm.em.fork();

      const saved = await em.findOneOrFail(WalletEntity, {
        id: wallet.id,
      });

      const bets = await em.find(TransactionEntity, {
        walletId: wallet.id,
        type: "BET",
      });

      const entries = await em.find(LedgerEntryEntity, {
        walletId: wallet.id,
      });

      const debits = entries.filter((e) => e.direction === "DEBIT");
      const credits = entries.filter((e) => e.direction === "CREDIT");

      expect(saved.balance).toBe("20.00");
      expect(saved.version).toBe(2);

      expect(bets).toHaveLength(2);
      expect(bets.map((b) => b.status).sort()).toEqual([
        "PROCESSED",
        "REJECTED",
      ]);

      expect(debits).toHaveLength(1);
      expect(debits[0].amount).toBe("80.00");

      expect(credits).toHaveLength(1);
      expect(credits[0].amount).toBe("100.00");
      expect(entries).toHaveLength(2);

      const processed = bets.find((b) => b.status === "PROCESSED")!;
      expect(debits[0].transactionId.id).toBe(processed.id);

      console.log("Carteira verificada:", wallet.id);
    } finally {
      await orm.close();
    }
  },
  20_000,
);

test("repetições preservam a resposta e não debitam novamente", async () => {
  const orm = await MikroORM.init(config);

  try {
    const wallet = await openWallet(orm, {
      playerId: randomUUID(),
      amount: "100.00",
      currency: "BRL",
    });

    const input = {
      walletId: wallet.id,
      amount: "10.00",
      currency: "BRL",
      idempotencyKey: randomUUID(),
    };

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => placeBet(orm, input)),
    );

    for (const response of responses) {
      expect(response).toEqual(responses[0]);
    }

    expect(responses[0].balance.amount).toBe("90.00");

    // Outra aposta muda o saldo atual para 85.
    await placeBet(orm, {
      ...input,
      amount: "5.00",
      idempotencyKey: randomUUID(),
    });

    // A repetição precisa continuar retornando o saldo histórico de 90.
    expect(await placeBet(orm, input)).toEqual(responses[0]);

    // expect(placeBet(orm, { ...input, amount: "15.00" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    let conflict: unknown;

    try {
      await placeBet(orm, {
        ...input,
        amount: "15.00",
      });
    } catch (error) {
      conflict = error;
    }

    expect(conflict).toBeInstanceOf(Error);
    expect((conflict as Error).message).toBe("IDEMPOTENCY_CONFLICT");

    const em = orm.em.fork();
    const saved = await em.findOneOrFail(WalletEntity, { id: wallet.id });

    expect(saved.balance).toBe("85.00");
    expect(saved.version).toBe(3);

    expect(await em.count(TransactionEntity, {
      idempotencyKey: input.idempotencyKey,
    })).toBe(1);

    expect(await em.count(LedgerEntryEntity, {
      walletId: wallet.id,
      direction: "DEBIT",
    })).toBe(2);
  } finally {
    await orm.close();
  }
}, 30_000);