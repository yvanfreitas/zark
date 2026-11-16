import type { Classifier, Verdict } from './verdict';

export class HttpClassifier implements Classifier {
  constructor(private readonly endpoint: string) {}

  async classify(text: string): Promise<Verdict> {
    const res = await fetch(this.endpoint, { method: 'POST', body: JSON.stringify({ text }) });
    return (await res.json()) as Verdict;
  }
}
