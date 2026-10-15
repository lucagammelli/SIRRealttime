import { join } from 'node:path';
import type { AgentConfig } from '../config.js';
import type { Lock } from '../lock.js';
import type { Logger } from '../logger.js';
import { createLogger } from '../logger.js';
import { guiWritablePaths, readConfigFile } from './config-file.js';
import type { RunnableAgent } from './controller.js';
import { GuiController } from './controller.js';
import { runGuiHost } from './host.js';
import { LogSink } from './log-sink.js';
import { WINDOW_SCRIPT } from './window-script.js';

export interface GuiOptions {
  baseDir: string;
  configPath: string;
  signal?: AbortSignal;
  /** For the tests: a fake window instead of powershell.exe. */
  command?: string;
  args?: (scriptPath: string) => string[];
  script?: string;
  statusIntervalMs?: number;
  registrationPollMs?: number;
  /** Safe folder used when dataDir or logDir are on the USB stick (default `<tmp>/SIRAgent`). */
  fallbackDir?: string;
  createAgent?: (config: AgentConfig, logger: Logger) => Promise<RunnableAgent>;
  acquireLock?: (dataDir: string) => Promise<Lock>;
}

/**
 * Window mode: log on file and in the window, script written to `dataDir/gui/window.ps1`, then the host. With
 * dataDir or logDir on the USB stick both go to a safe folder instead, and the window shows the error.
 */
export async function runGui(options: GuiOptions): Promise<number> {
  const read = await readConfigFile(options.configPath);
  const paths = guiWritablePaths(read.kind === 'ok' ? read.raw : null, options.baseDir, options.fallbackDir);
  const sink = new LogSink(200);
  const { logger, close } = createLogger({
    level: paths.level,
    logDir: paths.logDir,
    console: false,
    extraStream: sink,
  });
  try {
    logger.info({ configPath: options.configPath }, 'finestra avviata');
    if (paths.problem) logger.error({ err: paths.problem }, 'cartelle dell’agente sulla pennina');
    const scriptPath = join(paths.dataDir, 'gui', 'window.ps1');
    const code = await runGuiHost({
      script: options.script ?? WINDOW_SCRIPT,
      scriptPath,
      ...(options.command ? { command: options.command } : {}),
      ...(options.args ? { args: options.args(scriptPath) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      logger,
      createController: (send) =>
        new GuiController({
          configPath: options.configPath,
          baseDir: options.baseDir,
          logger,
          send,
          logSink: sink,
          ...(options.createAgent ? { createAgent: options.createAgent } : {}),
          ...(options.acquireLock ? { acquireLock: options.acquireLock } : {}),
          ...(options.statusIntervalMs ? { statusIntervalMs: options.statusIntervalMs } : {}),
          ...(options.registrationPollMs ? { registrationPollMs: options.registrationPollMs } : {}),
          ...(paths.problem ? { startupError: paths.problem } : {}),
        }),
    });
    logger.info('finestra chiusa');
    return code;
  } finally {
    close();
  }
}
