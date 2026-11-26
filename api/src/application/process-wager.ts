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
import { LedgerEntryEntity } from "../infrastructure/database/ledgerEntry.entity";
import {
  TransactionEntity,
  type BetResult,
  type WagerContext,
} from "../infrastructure/database/transaction.entity";

export type WagerKind = "BET" | "WIN" | "LOSS" | "REFUND" | "ROLLBACK";

export interface WagerInput {
  walletId: string;
  amount: string;
  currency: string;
  idempotencyKey: string;
  kind: WagerKind;
  context?: WagerContext;
  referenceExternalTransactionId?: string;
}

function replay(tx: TransactionEntity, hash: string): BetResult {
  if (tx.payloadHash !== hash) {
    throw new Error("IDEMPOTENCY_CONFLICT");
  }
  if (!tx.response) {
    throw new Error("IDEMPOTENCY_RESPONSE_MISSING");
  }
  return tx.response;
}

export async function processWager(
  orm: MikroORM,
  input: WagerInput,
  resumePending = false,
): Promise<BetResult> {
  if (
    typeof input.idempotencyKey !== "string" ||
    !input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 200
  ) {
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  }

  if (!["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"].includes(input.kind)) {
    throw new Error("INVALID_OPERATION");
  }

  if (input.kind !== "BET" && !input.context) {
    throw new Error("MISSING_WAGER_CONTEXT");
  }

  const amount = Money.from({
    amount: input.amount,
    currency: input.currency,
  });

  if (input.kind !== "LOSS" && !amount.isPositive()) {
    throw new Error("AMOUNT_MUST_BE_POSITIVE");
  }

  if (
    ["REFUND", "ROLLBACK"].includes(input.kind) &&
    !input.referenceExternalTransactionId
  ) {
    throw new Error("REFERENCE_REQUIRED");
  }

  const payload: Record<string, string | null> = {
    amount: amount.toString(),
    currency: amount.currency,
    externalTransactionId: input.context?.externalTransactionId ?? null,
    gameId: input.context?.gameId ?? null,
    kind: input.kind,
    playerId: input.context?.playerId.toLowerCase() ?? null,
    providerId: input.context?.providerId ?? null,
    roundId: input.context?.roundId ?? null,
    walletId: input.walletId.toLowerCase(),
  };

  // Ausência de referência mantém compatibilidade com os hashes BET anteriores.
  if (input.referenceExternalTransactionId !== undefined) {
    payload.referenceExternalTransactionId =
      input.referenceExternalTransactionId;
  }

  const canonical = Object.fromEntries(
    Object.entries(payload).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  );

  const hash = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");

  try {
    return await orm.em.fork().transactional(async (em) => {
      const entity = await em.findOneOrFail(
        WalletEntity,
        { id: input.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      const existing = await em.findOne(TransactionEntity, {
        idempotencyKey: input.idempotencyKey,
      });

      if (existing) {
        const previous = replay(existing, hash);

        if (!resumePending || existing.status !== "PENDING_REFERENCE") {
          return previous;
        }

        if (
          existing.nextAttemptAt &&
          existing.nextAttemptAt.getTime() > Date.now()
        ) {
          return previous;
        }
      }

      const wallet = WalletMapper.toDomain(entity);
      const tx = existing ?? new TransactionEntity();

      if (!existing) {
        tx.id = randomUUID();
        tx.walletId = entity;
        tx.type = input.kind;
        tx.status = "PENDING";
        tx.amount = amount.toString();
        tx.currency = amount.currency;
        tx.createdAt = new Date();
        tx.idempotencyKey = input.idempotencyKey;
        tx.payloadHash = hash;
        tx.context = input.context;
        tx.referenceExternalTransactionId =
          input.referenceExternalTransactionId;
      }

      const finish = async (
        status: string,
        code: string | null,
      ): Promise<BetResult> => {
        tx.status = status;

        if (status !== "PENDING_REFERENCE") {
          tx.nextAttemptAt = undefined;
        }

        const response: BetResult = {
          transactionId: tx.id,
          status,
          rejectionCode: code,
          balance: wallet.balance.toJSON(),
        };

        tx.response = response;
        em.persist(tx);
        await em.flush();
        return response;
      };

      if (
        input.context &&
        entity.playerId.toLowerCase() !== input.context.playerId.toLowerCase()
      ) {
        return finish("REJECTED", "PLAYER_MISMATCH");
      }

      if (wallet.currency !== amount.currency) {
        return finish("REJECTED", "CURRENCY_MISMATCH");
      }

      let reference: TransactionEntity | null = null;

      if (input.referenceExternalTransactionId) {
        if (!input.context) {
          return finish("REJECTED", "MISSING_WAGER_CONTEXT");
        }

        reference = await em.findOne(TransactionEntity, {
          context: {
            providerId: input.context.providerId,
            externalTransactionId: input.referenceExternalTransactionId,
          },
        });

        if (
          !reference ||
          ["PENDING", "PENDING_REFERENCE"].includes(reference.status)
        ) {
          tx.attempts += 1;

          const expired =
            Date.now() - tx.createdAt.getTime() >= 15 * 60_000;

          if (tx.attempts >= 8 || expired) {
            return finish("REJECTED", "REFERENCE_UNAVAILABLE");
          }

          const delay = Math.min(
            60_000,
            1000 * 2 ** (tx.attempts - 1),
          );

          tx.nextAttemptAt = new Date(Date.now() + delay);
          return finish("PENDING_REFERENCE", null);
        }

        if (reference.status !== "PROCESSED") {
          return finish("REJECTED", "REFERENCE_NOT_PROCESSED");
        }

        if (
          reference.walletId.id !== wallet.id ||
          reference.currency !== wallet.currency ||
          reference.context?.playerId.toLowerCase() !==
            input.context.playerId.toLowerCase() ||
          reference.context?.roundId !== input.context.roundId
        ) {
          return finish("REJECTED", "REFERENCE_MISMATCH");
        }

        const allowedKinds =
          input.kind === "ROLLBACK"
            ? ["BET", "WIN", "REFUND"]
            : ["BET"];

        if (!allowedKinds.includes(reference.type)) {
          return finish("REJECTED", "INVALID_REFERENCE_KIND");
        }
      }

      let direction: "CREDIT" | "DEBIT" | null = null;

      if (input.kind === "BET") direction = "DEBIT";
      if (input.kind === "WIN") direction = "CREDIT";

      if (input.kind === "REFUND" || input.kind === "ROLLBACK") {
        if (!reference) {
          return finish("REJECTED", "REFERENCE_REQUIRED");
        }

        const referenceAmount = Money.from({
          amount: reference.amount,
          currency: reference.currency,
        });

        if (!amount.equals(referenceAmount)) {
          return finish("REJECTED", "REFERENCE_AMOUNT_MISMATCH");
        }

        const reversed = await em.findOne(TransactionEntity, {
          referenceId: reference.id,
          type: input.kind,
          status: "PROCESSED",
        });

        if (reversed) {
          return finish("REJECTED", "REFERENCE_ALREADY_REVERSED");
        }

        const originalEntry = await em.findOneOrFail(
          LedgerEntryEntity,
          { transactionId: reference.id },
        );

        direction =
          originalEntry.direction === "DEBIT" ? "CREDIT" : "DEBIT";

        tx.referenceId = reference.id;
      } else if (reference) {
        tx.referenceId = reference.id;
      }

      if (direction === "DEBIT" && wallet.balance.isLessThan(amount)) {
        return finish(
          "REJECTED",
          input.kind === "BET"
            ? "INSUFFICIENT_FUNDS"
            : "REVERSAL_INSUFFICIENT_FUNDS",
        );
      }

      if (direction === "CREDIT") {
        const resultingBalance = wallet.balance.add(amount);

        if (
          resultingBalance.toString().split(".")[0].length > 18
        ) {
          return finish("REJECTED", "BALANCE_LIMIT_EXCEEDED");
        }

        wallet.credit(amount);
      }

      if (direction === "DEBIT") {
        wallet.debit(amount);
      }

      if (direction !== null) {
        entity.balance = wallet.balance.toString();
        entity.version = wallet.version;
        entity.updatedAt = wallet.updatedAt;
      }

      const result = await finish("PROCESSED", null);

      if (direction !== null) {
        const entry = new LedgerEntryEntity();
        entry.id = randomUUID();
        entry.walletId = entity;
        entry.transactionId = tx;
        entry.direction = direction;
        entry.amount = amount.toString();
        entry.currency = wallet.currency;
        entry.createdAt = new Date();

        em.persist(entry);
        await em.flush();
      }

      return result;
    }, { isolationLevel: IsolationLevel.READ_COMMITTED });
  } catch (error) {
    if (!(error instanceof UniqueConstraintViolationException)) {
      throw error;
    }

    const existing = await orm.em.fork().findOne(TransactionEntity, {
      idempotencyKey: input.idempotencyKey,
    });

    if (existing) {
      return replay(existing, hash);
    }

    // Inclui reutilização de providerId + externalTransactionId
    // com outra chave. A camada HTTP já converte para 409.
    throw error;
  }
}
