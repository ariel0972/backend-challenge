/* eslint-disable prettier/prettier */
import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../src/mikro-orm.config";
import { openWallet } from "../src/application/open-wallet";
import { placeBet } from "../src/application/place-bet";
import { reconcileWallet } from "../src/application/reconcile-wallet";
import { WalletEntity } from "../src/infrastructure/database/wallet.entity";
import { TransactionEntity } from "../src/infrastructure/database/transaction.entity";
import { LedgerEntryEntity } from "../src/infrastructure/database/ledgerEntry.entity";

async function expectError(
  operation: () => Promise<unknown>,
  message: string,
): Promise<void> {
  let failure: unknown;

  try {
    await operation();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain(message);
}

test("banco impede alteração e exclusão de lançamentos", async () => {
  const orm = await MikroORM.init(config);

  try {
    const wallet = await openWallet(orm, {
      playerId: randomUUID(),
      amount: "100.00",
      currency: "BRL",
    });

    const entry = await orm.em.fork().findOneOrFail(
      LedgerEntryEntity,
      { walletId: wallet.id },
    );

    await expectError(
      () => orm.em.fork().nativeUpdate(
        LedgerEntryEntity,
        { id: entry.id },
        { amount: "1.00" },
      ),
      "LEDGER_IMMUTABLE",
    );

    await expectError(
      () => orm.em.fork().nativeDelete(
        LedgerEntryEntity,
        { id: entry.id },
      ),
      "LEDGER_IMMUTABLE",
    );

    const saved = await orm.em.fork().findOneOrFail(
      LedgerEntryEntity,
      { id: entry.id },
    );

    expect(saved.amount).toBe("100.00");

    const reconciliation = await reconcileWallet(orm, wallet.id);
    expect(reconciliation.consistent).toBe(true);
  } finally {
    await orm.close();
  }
}, 20_000);

test("falha no ledger desfaz aposta e permite tentar novamente", async () => {
  const orm = await MikroORM.init(config);

  // Identificadores internos, gerados pelo teste, sem entrada externa.
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `test_fail_ledger_${suffix}`;
  const triggerName = `test_fail_insert_${suffix}`;

  const connection = orm.em.getConnection();

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
      idempotencyKey: randomUUID(),
    };

    await connection.execute(`
      CREATE FUNCTION ${functionName}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'TEST_LEDGER_FAILURE';
      END;
      $$;
    `);

    try {
      await connection.execute(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON ledger_entries
        FOR EACH ROW
        WHEN (NEW.wallet_id = '${wallet.id}'::uuid)
        EXECUTE FUNCTION ${functionName}();
      `);

      await expectError(
        () => placeBet(orm, input),
        "TEST_LEDGER_FAILURE",
      );

      const em = orm.em.fork();

      const persisted = await em.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
      );

      expect(persisted.balance).toBe("100.00");
      expect(persisted.version).toBe(1);

      expect(await em.count(TransactionEntity, {
        idempotencyKey: input.idempotencyKey,
      })).toBe(0);

      expect(await em.count(LedgerEntryEntity, {
        walletId: wallet.id,
        direction: "DEBIT",
      })).toBe(0);

      const reconciliation = await reconcileWallet(orm, wallet.id);
      expect(reconciliation.consistent).toBe(true);
      expect(reconciliation.checkedEntries).toBe(1);
    } finally {
      await connection.execute(`
        DROP TRIGGER IF EXISTS ${triggerName} ON ledger_entries;
      `);

      await connection.execute(`
        DROP FUNCTION IF EXISTS ${functionName}();
      `);
    }

    // Sem a falha artificial, a mesma chave pode ser processada.
    const result = await placeBet(orm, input);

    expect(result.status).toBe("PROCESSED");
    expect(result.balance.amount).toBe("20.00");

    const reconciliation = await reconcileWallet(orm, wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.checkedEntries).toBe(2);
  } finally {
    await orm.close();
  }
}, 30_000);
