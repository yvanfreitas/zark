import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { isBlocked, type Classifier } from './verdict';

export class ModerationClient {
  constructor(
    private readonly classifier: Classifier,
    private readonly sqs: SQSClient,
    private readonly reviewQueueUrl: string,
  ) {}

  async check(text: string): Promise<boolean> {
    const verdict = await this.classifier.classify(text);
    if (isBlocked(verdict)) {
      await this.sqs.send(new SendMessageCommand({ QueueUrl: this.reviewQueueUrl, MessageBody: text }));
      return false;
    }
    return true;
  }
}
