import { ModerationClient } from '@mod/client';
import type { Logger } from './logger';
import { format } from '../../shared/util';
import express from 'express'; // imported but never called: not counted
import { helper } from './helpers';

export class BotOrchestrator {
  constructor(
    private readonly mod: ModerationClient,
    private log: Logger,
  ) {}

  handle(msg: string) {
    this.log.info(format(msg)); // interface call points at the interface; format is unowned
    this.mod.classify(msg);
    this.mod.classify(msg);
    return this.retry(msg);
  }

  retry(msg: string) {
    return helper(msg);
  }
}
