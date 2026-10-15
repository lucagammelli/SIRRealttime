import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { isSea } from 'node:sea';
import { Agent } from './agent.js';
import type { AgentConfig } from './config.js';
import { ConfigError, defaultConfigPath, loadConfig } from './config.js';
import { waitForLock } from './lock.js';
import { createLogger } from './logger.js';
import { errorMessage } from './util.js';

export const HELP = `sir-agent: legge il file .dvw di DataVolley e invia le azioni al server SIRRealtime

Uso: sir-agent                      finestra (anche con doppio clic sull'eseguibile)
     sir-agent --gui [--config <file>]
     sir-agent [--config <file>] [--console] [--once]

  --gui            finestra con cartella del .dvw, token, START e STOP (solo Windows; è il modo senza argomenti)
  --config <file>  configurazione (default: config.json accanto all'eseguibile)
  --console        log anche sulla console, oltre che su file
  --once           legge il file una volta, invia la coda e termina
                   (codice di uscita 0 tutto inviato, 2 dati rimasti in coda, 3 nessun file .dvw letto;
                   1 configurazione non valida o errore)
  --help           questo aiuto

Con --config (servizio, console) l'agente legge di continuo; se un'altra istanza usa la stessa cartella dati
(lucchetto agent.lock) attende che finisca e riprova ogni 30 secondi.
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
  /** Pause between two attempts to take the lock of `dataDir` (default 30 s). */
  lockRetryMs?: number;
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
  const configPath = args.config ?? defaultConfigPath(baseDir);
  if (args.gui) {
    if (args.once || args.console) {
      io.err(`--gui non si usa con --once o --console\n\n${HELP}`);
      return 1;
    }
    if (process.platform !== 'win32') {
      io.err('La finestra è disponibile solo su Windows: qui usa sir-agent --config <file> --console\n');
      return 1;
    }
    const { runGui } = await import('./gui/main.js');
    return runGui({ baseDir, configPath, signal: io.signal ?? processSignal() });
  }
  let config: AgentConfig;
  try {
    config = loadConfig(configPath, baseDir);
  } catch (err) {
    io.err(`${err instanceof ConfigError ? err.message : errorMessage(err)}\n`);
    return 1;
  }
  await mkdir(config.dataDir, { recursive: true });
  const { logger, close } = createLogger({ level: config.logLevel, logDir: config.logDir, console: args.console });
  try {
    if (args.once) {
      const agent = await Agent.create({ config, logger });
      return await agent.runOnce(Math.max(30_000, config.stableMs * 10), io.signal);
    }
    const signal = io.signal ?? processSignal();
    // Continuous reading: one agent per data folder, taken before the queue is loaded. `--once` does not take it
    // (installa-servizio.ps1 runs it while the service may still be running). The service waits instead of
    // exiting, so NSSM does not restart it in a loop.
    const lock = await waitForLock(config.dataDir, {
      signal,
      ...(io.lockRetryMs !== undefined ? { retryMs: io.lockRetryMs } : {}),
      onWait: (pid) => logger.warn({ pid }, `un'altra istanza dell'agente è attiva (pid ${pid}): attendo`),
    });
    if (!lock) return 0;
    try {
      const agent = await Agent.create({ config, logger });
      await agent.run(signal);
    } finally {
      await lock.release();
    }
    return 0;
  } catch (err) {
    logger.fatal({ err: errorMessage(err) }, 'errore fatale');
    return 1;
  } finally {
    close();
  }
}

/** Aborted by SIGINT or SIGTERM. */
function processSignal(): AbortSignal {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return controller.signal;
}

function parse(argv: string[]): {
  config: string | undefined;
  console: boolean;
  once: boolean;
  gui: boolean;
  help: boolean;
} {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string' },
      console: { type: 'boolean', default: false },
      once: { type: 'boolean', default: false },
      gui: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    config: values.config,
    console: values.console,
    once: values.once,
    // No arguments at all (double click on the executable): the window.
    gui: values.gui || argv.length === 0,
    help: values.help,
  };
}
