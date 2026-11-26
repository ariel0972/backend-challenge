/* eslint-disable prettier/prettier */
import { createHash, randomUUID } from "node:crypto";
import {
  IsolationLevel,
  LockMode,
  UniqueConstraintViolationException,
} from "@mikro-orm/core";
import { MikroORM } from "@mikro-orm/postgresql";
import { Money } from "../domain/money";
import { WalletMapper } from "../infrastructure/database/wallet.mapper";
import { WalletEntity } from "../infrastructure/database/wallet.entity";
import {
  TransactionEntity,
  type BetResult,
} from "../infrastructure/database/transaction.entity";
import { LedgerEntryEntity } from "../infrastructure/database/ledgerEntry.entity";

interface PlaceBetInput {
  walletId: string;
  amount: string;
  currency: string;
  idempotencyKey: string;
}

function replay(
  transaction: TransactionEntity,
  payloadHash: string,
): BetResult {
  if (transaction.payloadHash !== payloadHash) {
    throw new Error("IDEMPOTENCY_CONFLICT");
  }

  if (!transaction.response) {
    throw new Error("IDEMPOTENCY_RESPONSE_MISSING");
  }

  return transaction.response;
}

export async function placeBet(
  orm: MikroORM,
  input: PlaceBetInput,
): Promise<BetResult> {
  if (
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.trim().length === 0 ||
    input.idempotencyKey.length > 200
  ) {
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  }

  const amount = Money.from({
    amount: input.amount,
    currency: input.currency,
  });

  if (!amount.isPositive()) {
    throw new Error("Valor da aposta deve ser positivo");
  }

  // Campos explícitos em ordem fixa: independente da ordem do JSON recebido.
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({
      type: "BET",
      walletId: input.walletId.toLowerCase(),
      amount: amount.toString(),
      currency: amount.currency,
    }))
    .digest("hex");

  try {
    return await orm.em.fork().transactional(
      async (em): Promise<BetResult> => {
        const entity = await em.findOneOrFail(
          WalletEntity,
          { id: input.walletId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );

        // Consulte depois do lock para observar a operação anterior
        // quando duas chamadas disputarem a mesma carteira.
        const existing = await em.findOne(TransactionEntity, {
          idempotencyKey: input.idempotencyKey,
        });

        if (existing) {
          return replay(existing, payloadHash);
        }

        const wallet = WalletMapper.toDomain(entity);

        const transaction = new TransactionEntity();
        transaction.id = randomUUID();
        transaction.walletId = entity;
        transaction.type = "BET";
        transaction.amount = amount.toString();
        transaction.currency = amount.currency;
        transaction.createdAt = new Date();
        transaction.idempotencyKey = input.idempotencyKey;
        transaction.payloadHash = payloadHash;

        let rejectionCode: string | null = null;

        if (wallet.currency !== amount.currency) {
          rejectionCode = "CURRENCY_MISMATCH";
        } else if (wallet.balance.isLessThan(amount)) {
          rejectionCode = "INSUFFICIENT_FUNDS";
        }

        transaction.status =
          rejectionCode === null ? "PROCESSED" : "REJECTED";

        if (rejectionCode === null) {
          wallet.debit(amount);
          entity.balance = wallet.balance.toString();
          entity.version = wallet.version;
          entity.updatedAt = wallet.updatedAt;
        }

        const response: BetResult = {
          transactionId: transaction.id,
          status: transaction.status,
          rejectionCode,
          balance: wallet.balance.toJSON(),
        };

        // Grave a resposta histórica junto com a alteração financeira.
        transaction.response = response;
        em.persist(transaction);
        await em.flush();

        if (rejectionCode === null) {
          const entry = new LedgerEntryEntity();
          entry.id = randomUUID();
          entry.walletId = entity;
          entry.transactionId = transaction;
          entry.direction = "DEBIT";
          entry.amount = amount.toString();
          entry.currency = wallet.currency;
          entry.createdAt = new Date();

          em.persist(entry);
          await em.flush();
        }

        return response;
      },
      { isolationLevel: IsolationLevel.READ_COMMITTED },
    );
  } catch (error) {
    if (!(error instanceof UniqueConstraintViolationException)) {
      throw error;
    }

    // Mesma chave em carteiras diferentes pode disputar o UNIQUE.
    // Aqui a transação perdedora já sofreu rollback.
    const existing = await orm.em.fork().findOne(TransactionEntity, {
      idempotencyKey: input.idempotencyKey,
    });

    if (!existing) {
      throw error;
    }

    return replay(existing, payloadHash);
  }
}
