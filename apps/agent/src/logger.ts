import { closeSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import type { Logger } from 'pino';
import type { LogLevel } from './config.js';

export type { Logger };

const FILE_PATTERN = /^sir-agent-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;

export interface RotatingFileOptions {
  dir: string;
  /** A day's file is continued in `.1`, `.2`… beyond this size. */
  maxBytes?: number;
  /** Days of logs kept. */
  keepDays?: number;
  now?: () => Date;
}

/**
 * Minimal rotating destination for pino: `sir-agent-YYYY-MM-DD.log` per UTC day, a new part beyond `maxBytes`,
 * files older than `keepDays` deleted. Synchronous writes (few lines per second); a write error is swallowed:
 * logging must never stop the agent.
 */
export class RotatingFileStream {
  private fd: number | null = null;
  private day = '';
  private part = 0;
  private size = 0;
  private readonly maxBytes: number;
  private readonly keepDays: number;
  private readonly now: () => Date;

  constructor(private readonly options: RotatingFileOptions) {
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
    this.keepDays = options.keepDays ?? 14;
    this.now = options.now ?? (() => new Date());
  }

  write(chunk: string): boolean {
    try {
      const day = this.now().toISOString().slice(0, 10);
      if (this.fd === null || day !== this.day || this.size >= this.maxBytes) this.rotate(day);
      if (this.fd !== null) this.size += writeSync(this.fd, chunk);
    } catch {
      this.close();
    }
    return true;
  }

  /** Current file, for the tests. */
  currentFile(): string {
    return join(this.options.dir, this.fileName(this.day, this.part));
  }

  close(): void {
    if (this.fd !== null) {
      try {
        closeSync(this.fd);
      } catch {
        // already closed
      }
    }
    this.fd = null;
  }

  private fileName(day: string, part: number): string {
    return `sir-agent-${day}${part > 0 ? `.${part}` : ''}.log`;
  }

  private rotate(day: string): void {
    this.close();
    mkdirSync(this.options.dir, { recursive: true });
    if (day !== this.day) {
      this.day = day;
      this.part = 0;
      this.prune();
    }
    for (;;) {
      const file = join(this.options.dir, this.fileName(day, this.part));
      let size: number;
      try {
        size = statSync(file).size;
      } catch {
        size = 0;
      }
      if (size < this.maxBytes) {
        this.fd = openSync(file, 'a');
        this.size = size;
        return;
      }
      this.part++;
    }
  }

  private prune(): void {
    const limit = new Date(this.now().getTime() - this.keepDays * 86_400_000).toISOString().slice(0, 10);
    for (const name of readdirSync(this.options.dir)) {
      const m = FILE_PATTERN.exec(name);
      if (m?.[1] && m[1] < limit) rmSync(join(this.options.dir, name), { force: true });
    }
  }
}

export interface LoggerOptions {
  level: LogLevel;
  logDir: string;
  console: boolean;
  /** One more destination (the window of the agent), with the same level and the same redaction. */
  extraStream?: { write: (chunk: string) => void };
}

/** Paths never written to the logs. */
export const REDACT_PATHS = [
  'agentToken',
  '*.agentToken',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'secret',
  '*.secret',
  'token',
  '*.token',
];

export function createLogger(options: LoggerOptions): { logger: Logger; close: () => void } {
  const file = new RotatingFileStream({ dir: options.logDir });
  const level = options.level === 'silent' ? 'fatal' : options.level;
  const streams: pino.StreamEntry[] = [{ level, stream: file }];
  if (options.console) streams.push({ level, stream: process.stdout });
  if (options.extraStream) streams.push({ level, stream: options.extraStream });
  const logger = pino(
    {
      level: options.level,
      base: { app: 'sir-agent' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[nascosto]' },
    },
    pino.multistream(streams),
  );
  return { logger, close: () => file.close() };
}
