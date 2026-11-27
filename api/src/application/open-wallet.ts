/* eslint-disable prettier/prettier */
import { randomUUID } from "node:crypto";
import { MikroORM } from "@mikro-orm/postgresql";
import { Money } from "../domain/money";
import { Wallet } from "../domain/wallet";
import { WalletMapper } from "../infrastructure/database/wallet.mapper";
import { TransactionEntity } from "../infrastructure/database/transaction.entity";
import { LedgerEntryEntity } from "../infrastructure/database/ledgerEntry.entity";
import { enqueueOutcome } from "../infrastructure/messaging/transactional-messaging";

interface OpenWalletInput {
  playerId: string;
  amount: string;
  currency: string;
}

export async function openWallet(orm: MikroORM, input: OpenWalletInput): Promise<Wallet> {
  const initialBalance = Money.from({
    amount: input.amount,
    currency: input.currency,
  });

  const wallet = Wallet.open({
    id: randomUUID(),
    playerId: input.playerId,
    initialBalance,
  });

  await orm.em.fork().transactional(async (em) => {
    const entity = WalletMapper.toEntity(wallet);

    em.persist(entity);
    await em.flush();

    if (initialBalance.isZero()) {
      return;
    }

    const transaction = new TransactionEntity();
    transaction.id = randomUUID();
    transaction.walletId = entity;
    transaction.type = "OPENING";
    transaction.status = "PROCESSED";
    transaction.amount = initialBalance.toString();
    transaction.currency = wallet.currency;
    transaction.createdAt = wallet.createdAt;

    em.persist(transaction);
    await em.flush();

    const entry = new LedgerEntryEntity();
    entry.id = randomUUID();
    entry.walletId = entity;
    entry.transactionId = transaction;
    entry.direction = "CREDIT";
    entry.amount = initialBalance.toString();
    entry.currency = wallet.currency;
    entry.createdAt = wallet.createdAt;

    em.persist(entry);
    await em.flush();

    await enqueueOutcome(em, {
      transactionId: transaction.id,
      walletId: wallet.id,
      kind: "OPENING",
      status: "PROCESSED",
      previousStatus: "PENDING",
      rejectionCode: null,
      before: Money.zero(wallet.currency).toJSON(),
      after: wallet.balance.toJSON(),
      walletVersion: wallet.version,
      correlationId: transaction.id,
    });
  });

  return wallet;
}