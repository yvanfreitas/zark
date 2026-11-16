export interface Verdict {
  allowed: boolean;
  reason?: string;
}

export interface Classifier {
  classify(text: string): Promise<Verdict>;
}

export function isBlocked(verdict: Verdict): boolean {
  return !verdict.allowed;
}
