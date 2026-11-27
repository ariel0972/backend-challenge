import type {
  WagerInput,
  WagerKind,
} from "../../application/process-wager";

export class InvalidMessageError extends Error {
  constructor() {
    super("INVALID_MESSAGE");
    this.name = "InvalidMessageError";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidMessageError();
  }

  return value as Record<string, unknown>;
}

function text(value: unknown, max = 200): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max
  ) {
    throw new InvalidMessageError();
  }

  return value;
}

function uuid(value: unknown): string {
  const result = text(value, 36);

  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result)) {
    throw new InvalidMessageError();
  }

  return result.toLowerCase();
}

export function decodeMessage(body: string): {
  messageId: string;
  input: WagerInput;
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    throw new InvalidMessageError();
  }

  const envelope = object(parsed);

  if (envelope.type !== "WagerTransactionRequested") {
    throw new InvalidMessageError();
  }

  const occurredAt = text(envelope.occurredAt, 50);

  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new InvalidMessageError();
  }

  const data = object(envelope.data);
  const money = object(data.money);
  const kind = text(data.kind);
  const amount = text(money.amount, 21);
  const currency = text(money.currency, 3);

  if (!["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"].includes(kind)) {
    throw new InvalidMessageError();
  }

  if (!/^(0|[1-9][0-9]{0,17})\.[0-9]{2}$/.test(amount)) {
    throw new InvalidMessageError();
  }

  if (!["BRL", "USD"].includes(currency)) {
    throw new InvalidMessageError();
  }

  if (kind !== "LOSS" && amount === "0.00") {
    throw new InvalidMessageError();
  }

  const reference = data.referenceExternalTransactionId === undefined
    ? undefined
    : text(data.referenceExternalTransactionId);

  if (
    (["REFUND", "ROLLBACK"].includes(kind) && !reference) ||
    (kind === "BET" && reference !== undefined)
  ) {
    throw new InvalidMessageError();
  }

  return {
    messageId: text(envelope.messageId),
    input: {
      walletId: uuid(data.walletId),
      amount,
      currency,
      kind: kind as WagerKind,
      idempotencyKey: text(data.idempotencyKey),
      referenceExternalTransactionId: reference,
      context: {
        playerId: uuid(data.playerId),
        providerId: text(data.providerId),
        externalTransactionId: text(data.externalTransactionId),
        roundId: text(data.roundId),
        gameId: text(data.gameId),
      },
    },
  };
}