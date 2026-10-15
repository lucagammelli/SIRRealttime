import type { GuiLogMessage } from './protocol.js';

const LEVELS: Record<number, GuiLogMessage['level']> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/** Details shown after the message, when present (never the whole entry: it is meant for the log file). */
const DETAILS = ['err', 'reason', 'file', 'status'] as const;

/** Turns one pino JSON line (already redacted) into a message for the window; `null` if it cannot be read. */
export function toGuiLog(chunk: string): GuiLogMessage | null {
  let entry: unknown;
  try {
    entry = JSON.parse(chunk);
  } catch {
    return null;
  }
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as Record<string, unknown>;
  const level = typeof e['level'] === 'number' ? LEVELS[e['level']] : undefined;
  if (!level) return null;
  const extra = DETAILS.map((k) => e[k])
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .map(String);
  const msg = typeof e['msg'] === 'string' ? e['msg'] : '';
  return {
    type: 'log',
    time: typeof e['time'] === 'string' ? e['time'] : '',
    level,
    msg: extra.length > 0 ? `${msg} (${extra.join(', ')})` : msg,
  };
}

/** pino destination that keeps the last `limit` messages and hands each new one to a listener. */
export class LogSink {
  private readonly items: GuiLogMessage[] = [];
  private listener: ((message: GuiLogMessage) => void) | null = null;

  constructor(private readonly limit = 200) {}

  write(chunk: string): void {
    const message = toGuiLog(chunk);
    if (!message) return;
    this.items.push(message);
    if (this.items.length > this.limit) this.items.shift();
    this.listener?.(message);
  }

  recent(): GuiLogMessage[] {
    return [...this.items];
  }

  onMessage(listener: ((message: GuiLogMessage) => void) | null): void {
    this.listener = listener;
  }
}
