import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import type { Logger } from '../logger.js';
import { errorMessage } from '../util.js';
import type { GuiController } from './controller.js';

export interface GuiHostOptions {
  /** Text of the window script, written to `scriptPath` (UTF-8 with BOM: PowerShell 5.1 reads files without BOM as ANSI). */
  script: string;
  scriptPath: string;
  /** Default `powershell.exe`; the tests use node with a fake window. */
  command?: string;
  args?: string[];
  logger: Logger;
  /** Builds the controller with the function that writes to the window. */
  createController: (send: (line: string) => void) => GuiController;
  /** Stops everything (signals of the process). */
  signal?: AbortSignal;
}

export const powershellArgs = (scriptPath: string): string[] => [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-STA',
  '-File',
  scriptPath,
];

/**
 * Starts the window process and connects its JSON lines to the controller. Resolves with the exit code when the
 * window is closed (or dies) and the agent is stopped: 0, or 1 when the window could not be started.
 */
export async function runGuiHost(options: GuiHostOptions): Promise<number> {
  const { logger } = options;
  await mkdir(dirname(options.scriptPath), { recursive: true });
  await writeFile(options.scriptPath, `\uFEFF${options.script}`, 'utf8');
  const child = spawn(options.command ?? 'powershell.exe', options.args ?? powershellArgs(options.scriptPath), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdinOpen = true;
  child.stdin.on('error', (err) => {
    stdinOpen = false;
    logger.debug({ err: errorMessage(err) }, 'canale verso la finestra chiuso');
  });
  const send = (line: string): void => {
    if (stdinOpen && child.stdin.writable) child.stdin.write(`${line}\n`, 'utf8');
  };
  const controller = options.createController(send);

  const exited = new Promise<number>((resolve) => {
    child.once('error', (err) => {
      logger.error({ err: errorMessage(err) }, 'finestra non avviata (powershell.exe non disponibile?)');
      resolve(1);
    });
    child.once('exit', (code, signal) => {
      if (code !== 0) logger.warn({ code, signal }, 'la finestra è terminata in modo inatteso');
      resolve(0);
    });
  });

  child.stdout.setEncoding('utf8');
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => controller.handleLine(line));
  child.stderr.setEncoding('utf8');
  createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', (line) => {
    if (line.trim() !== '') logger.warn({ err: line.slice(0, 500) }, 'messaggio della finestra (PowerShell)');
  });

  const onAbort = (): void => {
    void controller.shutdown();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  await controller.init();
  // Ends when the window says quit, or when it is gone (closed, killed, never started).
  await Promise.race([exited, controller.done]);
  await controller.shutdown();
  options.signal?.removeEventListener('abort', onAbort);
  // The window closes when its stdin ends; if it does not, it is killed.
  stdinOpen = false;
  child.stdin.end();
  const kill = setTimeout(() => child.kill(), 5000);
  const code = await exited;
  clearTimeout(kill);
  lines.close();
  return code;
}
