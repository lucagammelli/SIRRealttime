import { join } from 'node:path';
import type { AgentConfig } from '../config.js';
import type { Lock } from '../lock.js';
import type { Logger } from '../logger.js';
import { createLogger } from '../logger.js';
import { guiPaths, readConfigFile } from './config-file.js';
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
  createAgent?: (config: AgentConfig, logger: Logger) => Promise<RunnableAgent>;
  acquireLock?: (dataDir: string) => Promise<Lock>;
}

/** Window mode: log on file and in the window, script written to `dataDir/gui/window.ps1`, then the host. */
export async function runGui(options: GuiOptions): Promise<number> {
  const read = await readConfigFile(options.configPath);
  const paths = guiPaths(read.kind === 'ok' ? read.raw : null, options.baseDir);
  const sink = new LogSink(200);
  const { logger, close } = createLogger({
    level: paths.level,
    logDir: paths.logDir,
    console: false,
    extraStream: sink,
  });
  try {
    logger.info({ configPath: options.configPath }, 'finestra avviata');
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
        }),
    });
    logger.info('finestra chiusa');
    return code;
  } finally {
    close();
  }
}
