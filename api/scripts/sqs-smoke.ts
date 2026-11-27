import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../src/mikro-orm.config";
import { openWallet } from "../src/application/open-wallet";
import { WalletEntity } from "../src/infrastructure/database/wallet.entity";
import { LedgerEntryEntity } from "../src/infrastructure/database/ledgerEntry.entity";
import {
  createSqsClient,
  loadQueues,
} from "../src/infrastructure/messaging/sqs";

const orm = await MikroORM.init(config);
const client = createSqsClient();

try {
  const queues = await loadQueues(client);
  const playerId = randomUUID();

  const wallet = await openWallet(orm, {
    playerId,
    amount: "100.00",
    currency: "BRL",
  });

  const firstMessageId = randomUUID();
  const secondMessageId = randomUUID();
  const externalId = randomUUID();
  const idempotencyKey = `sqs-smoke:${externalId}`;

  const envelope = {
    messageId: firstMessageId,
    type: "WagerTransactionRequested",
    occurredAt: new Date().toISOString(),
    data: {
      providerId: "sqs-smoke",
      externalTransactionId: externalId,
      idempotencyKey,
      playerId,
      walletId: wallet.id,
      roundId: randomUUID(),
      gameId: "smoke-game",
      kind: "BET",
      money: {
        amount: "20.00",
        currency: "BRL",
      },
    },
  };

  for (const messageId of [
    firstMessageId,
    firstMessageId,
    secondMessageId,
  ]) {
    await client.send(new SendMessageCommand({
      QueueUrl: queues.input,
      MessageBody: JSON.stringify({ ...envelope, messageId }),
      MessageGroupId: wallet.id,

      // Diferentes de propósito: exercita a inbox,
      // sem depender da deduplicação do SQS.
      MessageDeduplicationId: randomUUID(),
    }));
  }

  let completed = false;
  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    const rows: { total: number }[] = await orm.em.fork().execute(
      `select count(*)::int as total
       from inbox_messages
       where consumer_name = ?
         and message_id in (?, ?)`,
      ["wager-processor", firstMessageId, secondMessageId],
    );

    const events: { total: number; pending: number }[] =
      await orm.em.fork().execute(
        `select
           count(*)::int as total,
           count(*) filter (where published_at is null)::int as pending
         from outbox_events
         where aggregate_id = ?`,
        [wallet.id],
      );

    if (
      rows[0]?.total === 2 &&
      events[0]?.total === 4 &&
      events[0]?.pending === 0
    ) {
      completed = true;
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  assert.ok(completed, "Timeout aguardando inbox/outbox");

  const em = orm.em.fork();
  const saved = await em.findOneOrFail(WalletEntity, { id: wallet.id });

  assert.equal(saved.balance, "80.00");
  assert.equal(saved.version, 2);

  assert.equal(
    await em.count(LedgerEntryEntity, {
      walletId: wallet.id,
      direction: "DEBIT",
    }),
    1,
  );

  console.log({
    result: "SQS_SMOKE_OK",
    walletId: wallet.id,
    balance: saved.balance,
    version: saved.version,
    inboxMessages: 2,
    publishedEvents: 4,
  });
} finally {
  client.destroy();
  await orm.close();
}