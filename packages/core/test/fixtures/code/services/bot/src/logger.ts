export interface Logger {
  info(m: string): void;
}

export class ConsoleLogger implements Logger {
  info(m: string) {
    console.log(m); // global: unresolved
  }
}

export class LoudLogger extends ConsoleLogger {}
