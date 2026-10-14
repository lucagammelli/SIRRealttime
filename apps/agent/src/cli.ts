import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { isSea } from 'node:sea';
import { Agent } from './agent.js';
import type { AgentConfig } from './config.js';
import { ConfigError, defaultConfigPath, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { errorMessage } from './util.js';

export const HELP = `sir-agent: legge il file .dvw di DataVolley e invia le azioni al server SIRRealtime

Uso: sir-agent [--config <file>] [--console] [--once]

  --config <file>  configurazione (default: config.json accanto all'eseguibile)
  --console        log anche sulla console, oltre che su file
  --once           legge il file una volta, invia la coda e termina
                   (codice di uscita 0 tutto inviato, 2 dati rimasti in coda, 3 nessun file .dvw letto;
                   1 configurazione non valida o errore)
  --help           questo aiuto
`;

/** Folder of the executable (Node SEA), or the current folder when run with node. */
export function baseDirectory(): string {
  return isSea() ? dirname(process.execPath) : process.cwd();
}

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Stops the main loop (signals). Default: SIGINT and SIGTERM. */
  signal?: AbortSignal;
  baseDir?: string;
}

/** Runs the agent; resolves with the exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (err) {
    io.err(`${errorMessage(err)}\n\n${HELP}`);
    return 1;
  }
  if (args.help) {
    io.out(HELP);
    return 0;
  }
  const baseDir = io.baseDir ?? baseDirectory();
  let config: AgentConfig;
  try {
    config = loadConfig(args.config ?? defaultConfigPath(baseDir), baseDir);
  } catch (err) {
    io.err(`${err instanceof ConfigError ? err.message : errorMessage(err)}\n`);
    return 1;
  }
  await mkdir(config.dataDir, { recursive: true });
  const { logger, close } = createLogger({ level: config.logLevel, logDir: config.logDir, console: args.console });
  try {
    const agent = await Agent.create({ config, logger });
    if (args.once) return await agent.runOnce(Math.max(30_000, config.stableMs * 10), io.signal);
    const controller = new AbortController();
    const stop = (): void => controller.abort();
    io.signal?.addEventListener('abort', stop, { once: true });
    if (!io.signal) {
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    }
    await agent.run(controller.signal);
    return 0;
  } catch (err) {
    logger.fatal({ err: errorMessage(err) }, 'errore fatale');
    return 1;
  } finally {
    close();
  }
}

function parse(argv: string[]): { config: string | undefined; console: boolean; once: boolean; help: boolean } {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string' },
      console: { type: 'boolean', default: false },
      once: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return { config: values.config, console: values.console, once: values.once, help: values.help };
}
