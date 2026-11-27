/* eslint-disable prettier/prettier */
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { createSqsClient } from "../src/infrastructure/messaging/sqs";

const client = createSqsClient()

async function create(name: string): Promise<string> {
  const result = await client.send(new CreateQueueCommand({
    QueueName: name,
    Attributes: {
      FifoQueue: "true",
      ContentBasedDeduplication: "false",
    },
  }));

  if (!result.QueueUrl) {
    throw new Error("QUEUE_URL_MISSING");
  }

  return result.QueueUrl;
}

try {
  const dlq = await create(
    process.env.SQS_DLQ_QUEUE ?? "wager-transactions-dlq.fifo",
  );

  const attributes = await client.send(new GetQueueAttributesCommand({
    QueueUrl: dlq,
    AttributeNames: ["QueueArn"],
  }));

  const arn = attributes.Attributes?.QueueArn;

  if (!arn) {
    throw new Error("DLQ_ARN_MISSING");
  }

  const input = await create(
    process.env.SQS_INPUT_QUEUE ?? "wager-transactions.fifo",
  );

  await client.send(new SetQueueAttributesCommand({
    QueueUrl: input,
    Attributes: {
      VisibilityTimeout: "60",
      ReceiveMessageWaitTimeSeconds: "10",
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: arn,
        maxReceiveCount: "5",
      }),
    },
  }));

  const events = await create(
    process.env.SQS_EVENTS_QUEUE ?? "wager-events.fifo",
  );

  console.log({ input, dlq, events });
} finally {
  client.destroy();
}
