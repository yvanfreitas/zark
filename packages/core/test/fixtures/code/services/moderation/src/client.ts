import { format } from '../../shared/util';

export class ModerationClient {
  classify(text: string) {
    return format(text);
  }
  private secret() {}
}
