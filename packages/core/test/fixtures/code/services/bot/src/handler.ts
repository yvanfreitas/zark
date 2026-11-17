import express from 'express';
import { ModerationClient } from '../../moderation/src/index';
import { ConsoleLogger } from './logger';
import * as h from './helpers';
import { BotOrchestrator } from './orchestrator';

export function handle(raw: string) {
  const bot = new BotOrchestrator(new ModerationClient(), new ConsoleLogger());
  bot.handle(raw);
  h.helper(raw);
  express();
}

// Module-level code: calls from here are attributed to the module, not a piece.
const app = express();
setup();
function setup() {
  handle('boot');
}
