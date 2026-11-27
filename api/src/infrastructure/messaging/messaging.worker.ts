import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  NotFoundError,
  UniqueConstraintViolationException,
} from "@mikro-orm/core";
import { MikroORM } from "@mikro-orm/postgresql";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
} from "@aws-sdk/client-sqs";
import { processWager } from "../../application/process-wager";
import { decodeMessage, InvalidMessageError } from "./decode-message";
import {
  createSqsClient,
  loadQueues,
  type QueueUrls,
} from "./sqs";

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...fields,
  }));
}

interface OutboxRow {
  id: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

@Injectable()
export class MessagingWorker
implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly client = createSqsClient();
  private queues?: QueueUrls;
  private stopping = false;
  private jobs: Promise<void>[] = [];

  constructor(
    @Inject(MikroORM)
    private readonly orm: MikroORM,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.MESSAGING_ENABLED !== "true") {
      return;
    }

    this.queues = await loadQueues(this.client);

    this.jobs = [
      this.consumeLoop(),
      this.publishLoop(),
    ];
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled(this.jobs);
    this.client.destroy();
  }

  private async consumeLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        const result = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queues!.input,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 10,
            VisibilityTimeout: 60,
            MessageSystemAttributeNames: ["ApproximateReceiveCount"],
          }),
          { abortSignal: AbortSignal.timeout(15_000) },
        );

        for (const message of result.Messages ?? []) {
          if (this.stopping) {
            await this.changeVisibility(message, 0);
            continue;
          }

          await this.handleMessage(message);
        }
      } catch (error) {
        log("sqs_receive_failed", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });

        if (!this.stopping) {
          await pause(1000);
        }
      }
    }
  }

  private async changeVisibility(
    message: Message,
    seconds: number,
  ): Promise<void> {
    if (!message.ReceiptHandle) return;

    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queues!.input,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: seconds,
      }),
      { abortSignal: AbortSignal.timeout(5000) },
    );
  }

  private async acknowledge(message: Message): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queues!.input,
        ReceiptHandle: message.ReceiptHandle!,
      }),
      { abortSignal: AbortSignal.timeout(5000) },
    );
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.ReceiptHandle || !message.MessageId) {
      throw new Error("INVALID_SQS_RESPONSE");
    }

    let heartbeat: Promise<void> = Promise.resolve();
    let extending = false;

    const timer = setInterval(() => {
      if (extending) return;

      extending = true;
      heartbeat = this.changeVisibility(message, 60)
        .catch(() => {
          log("sqs_visibility_extension_failed", {
            sqsMessageId: message.MessageId,
          });
        })
        .finally(() => {
          extending = false;
        });
    }, 20_000);

    let failure: unknown;
    let succeeded = false;

    try {
      const decoded = decodeMessage(message.Body ?? "");
      const started = Date.now();

      const result = await processWager(
        this.orm,
        decoded.input,
        false,
        {
          consumerName: "wager-processor",
          messageId: decoded.messageId,
        },
      );

      succeeded = true;

      log("sqs_processed", {
        correlationId: decoded.input.idempotencyKey,
        messageId: decoded.messageId,
        transactionId: result.transactionId,
        walletId: decoded.input.walletId,
        providerId: decoded.input.context?.providerId,
        status: result.status,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      failure = error;
    } finally {
      clearInterval(timer);
      await heartbeat;
    }

    if (succeeded) {
      // processWager já retornou após o commit.
      // Se o delete falhar, a inbox protege a próxima entrega.
      await this.acknowledge(message);
      return;
    }

    const code = failure instanceof Error ? failure.message : "";
    const permanent =
      failure instanceof InvalidMessageError ||
      failure instanceof NotFoundError ||
      failure instanceof UniqueConstraintViolationException ||
      [
        "INBOX_PAYLOAD_CONFLICT",
        "IDEMPOTENCY_CONFLICT",
        "INVALID_IDEMPOTENCY_KEY",
        "INVALID_OPERATION",
        "MISSING_WAGER_CONTEXT",
        "REFERENCE_REQUIRED",
        "AMOUNT_MUST_BE_POSITIVE",
      ].includes(code);

    if (permanent) {
      // Se enviar à DLQ falhar, não excluímos a mensagem original.
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queues!.dlq,
          MessageBody: message.Body ?? "",
          MessageGroupId: "invalid-messages",
          MessageDeduplicationId: message.MessageId,
          MessageAttributes: {
            failureType: {
              DataType: "String",
              StringValue:
                failure instanceof Error ? failure.name : "UnknownError",
            },
          },
        }),
        { abortSignal: AbortSignal.timeout(5000) },
      );

      await this.acknowledge(message);

      log("sqs_sent_to_dlq", {
        sqsMessageId: message.MessageId,
        errorType:
          failure instanceof Error ? failure.name : "UnknownError",
      });

      return;
    }

    const attempts = Number(
      message.Attributes?.ApproximateReceiveCount ?? "1",
    );

    const delay = Math.min(30, 2 ** Math.min(attempts, 5));

    await this.changeVisibility(message, delay);

    log("sqs_retry_scheduled", {
      sqsMessageId: message.MessageId,
      attempts,
      delaySeconds: delay,
      errorType:
        failure instanceof Error ? failure.name : "UnknownError",
    });

    // A redrive policy envia à DLQ ao ultrapassar maxReceiveCount.
  }

  private async publishLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        const found = await this.publishOne();

        if (!found) {
          await pause(500);
        }
      } catch (error) {
        log("outbox_worker_failed", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });

        if (!this.stopping) {
          await pause(1000);
        }
      }
    }
  }

  private async publishOne(): Promise<boolean> {
    return this.orm.em.fork().transactional(async (em) => {
      const rows: OutboxRow[] = await em.execute(`
        select id, aggregate_id, payload, attempts
        from outbox_events
        where published_at is null
          and next_attempt_at <= now()
        order by occurred_at, id
        limit 1
        for update skip locked
      `);

      const row = rows[0];

      if (!row) {
        return false;
      }

      try {
        await this.client.send(
          new SendMessageCommand({
            QueueUrl: this.queues!.events,
            MessageBody: JSON.stringify(row.payload),
            MessageGroupId: row.aggregate_id,
            MessageDeduplicationId: row.id,
          }),
          { abortSignal: AbortSignal.timeout(5000) },
        );
      } catch (error) {
        const attempts = row.attempts + 1;
        const delay = Math.min(60, 2 ** Math.min(attempts, 6));

        await em.execute(
          `update outbox_events
           set attempts = ?,
               next_attempt_at = now() + (? * interval '1 second')
           where id = ?`,
          [attempts, delay, row.id],
        );

        log("outbox_retry_scheduled", {
          eventId: row.id,
          attempts,
          delaySeconds: delay,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });

        return true;
      }

      await em.execute(
        `update outbox_events
         set published_at = now(), attempts = attempts + 1
         where id = ?`,
        [row.id],
      );

      log("outbox_published", {
        eventId: row.id,
        walletId: row.aggregate_id,
      });

      return true;
    });
  }
}