import { ModerationClient } from '../moderation-client/moderation-client';
import { buildPrompt, type ChatTurn } from './prompt';

export interface Llm {
  complete(prompt: string): Promise<string>;
}

export class ReplyBuilder {
  constructor(
    private readonly moderation: ModerationClient,
    private readonly llm: Llm,
  ) {}

  async reply(history: ChatTurn[], message: string): Promise<string | undefined> {
    if (!(await this.moderation.check(message))) return undefined;
    return this.llm.complete(buildPrompt(history, message));
  }
}
