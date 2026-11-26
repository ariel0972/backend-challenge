/* eslint-disable prettier/prettier */
import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../src/mikro-orm.config";
import { openWallet } from "../src/application/open-wallet";
import { placeBet } from "../src/application/place-bet";
import { reconcileWallet } from "../src/application/reconcile-wallet";
import { WalletEntity } from "../src/infrastructure/database/wallet.entity";

test("reconcilia o ledger e detecta divergência sem corrigir saldo", async () => {
  const orm = await MikroORM.init(config);

  try {
    const wallet = await openWallet(orm, {
      playerId: randomUUID(),
      amount: "100.00",
      currency: "BRL",
    });

    await placeBet(orm, {
      walletId: wallet.id,
      amount: "80.00",
      currency: "BRL",
      idempotencyKey: randomUUID(),
    });

    const valid = await reconcileWallet(orm, wallet.id);

    expect(valid.consistent).toBe(true);
    expect(valid.storedBalance.amount).toBe("20.00");
    expect(valid.calculatedBalance.amount).toBe("20.00");
    expect(valid.difference.amount).toBe("0.00");
    expect(valid.checkedEntries).toBe(2);

    // Somente nesta carteira exclusiva do teste:
    // simula corrupção do saldo materializado.
    try {
      await orm.em.fork().nativeUpdate(
        WalletEntity,
        { id: wallet.id },
        { balance: "21.00" },
      );

      const invalid = await reconcileWallet(orm, wallet.id);

      expect(invalid.consistent).toBe(false);
      expect(invalid.calculatedBalance.amount).toBe("20.00");
      expect(invalid.difference.amount).toBe("1.00");

      const persisted = await orm.em.fork().findOneOrFail(
        WalletEntity,
        { id: wallet.id },
      );

      // Reconciliação apenas detecta: não altera silenciosamente.
      expect(persisted.balance).toBe("21.00");
    } finally {
      // Restaura a alteração artificial feita pelo próprio teste.
      await orm.em.fork().nativeUpdate(
        WalletEntity,
        { id: wallet.id },
        { balance: "20.00" },
      );
    }
  } finally {
    await orm.close();
  }
}, 20_000);
