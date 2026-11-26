/* eslint-disable prettier/prettier */
import { IsolationLevel } from "@mikro-orm/core";
import { MikroORM } from "@mikro-orm/postgresql";
import { Money } from "../domain/money";
import { WalletEntity } from "../infrastructure/database/wallet.entity";
import { LedgerEntryEntity } from "../infrastructure/database/ledgerEntry.entity";

export async function reconcileWallet( orm: MikroORM, walletId: string ) {
  return orm.em.fork().transactional(
    async (em) => {
      const wallet = await em.findOneOrFail(WalletEntity, {
        id: walletId,
      });

      const entries = await em.find(LedgerEntryEntity, {
        walletId: wallet.id,
      });

      let calculated = Money.zero(wallet.currency);

      for (const entry of entries) {
        const amount = Money.from({
          amount: entry.amount,
          currency: entry.currency,
        });

        if (entry.direction === "CREDIT") {
          calculated = calculated.add(amount);
        } else if (entry.direction === "DEBIT") {
          calculated = calculated.subtract(amount);
        } else {
          throw new Error("INVALID_LEDGER_DIRECTION");
        }
      }

      const stored = Money.from({
        amount: wallet.balance,
        currency: wallet.currency,
      });

      // Convenção: diferença = saldo armazenado - saldo calculado.
      const difference = stored.subtract(calculated);

      return {
        walletId: wallet.id,
        storedBalance: stored.toJSON(),
        calculatedBalance: calculated.toJSON(),
        difference: difference.toJSON(),
        consistent: difference.isZero(),
        checkedEntries: entries.length,
      };
    },
    { isolationLevel: IsolationLevel.REPEATABLE_READ },
  );
}