export interface ChatTurn {
  role: 'user' | 'bot';
  text: string;
}

export function buildPrompt(history: ChatTurn[], message: string): string {
  const context = history.map((turn) => `${turn.role}: ${turn.text}`).join('\n');
  return `${context}\nuser: ${message}\nbot:`;
}
