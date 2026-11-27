/* eslint-disable prettier/prettier */
import {
  GetQueueUrlCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

export function createSqsClient(): SQSClient {
  return new SQSClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint: process.env.SQS_ENDPOINT ?? "http://localhost:4566",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
    maxAttempts: 1,
  });
}

export interface QueueUrls {
  input: string;
  dlq: string;
  events: string;
}

export async function loadQueues(client: SQSClient): Promise<QueueUrls> {
  async function url(name: string): Promise<string> {
    const result = await client.send(
      new GetQueueUrlCommand({ QueueName: name }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );

    if (!result.QueueUrl) {
      throw new Error("QUEUE_URL_MISSING");
    }

    return result.QueueUrl;
  }

  const [input, dlq, events] = await Promise.all([
    url(process.env.SQS_INPUT_QUEUE ?? "wager-transactions.fifo"),
    url(process.env.SQS_DLQ_QUEUE ?? "wager-transactions-dlq.fifo"),
    url(process.env.SQS_EVENTS_QUEUE ?? "wager-events.fifo"),
  ]);

  return { input, dlq, events };
}
