import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IngestRequest } from '@sir/shared';
import { IngestRequestSchema } from '@sir/shared';
import pino from 'pino';
import type { Logger } from 'pino';
import { matches } from '../../server/src/db/index.js';
import type { TestServer } from '../../server/test/helpers.js';
import { ADMIN, createAgent, login, startServer } from '../../server/test/helpers.js';
import type { AgentTiming } from '../src/agent.js';
import { Agent } from '../src/agent.js';
import type { AgentConfig } from '../src/config.js';
import { parseConfig } from '../src/config.js';
import type { FetchLike } from '../src/sender.js';

export { matches };

/** Temporary folder with the watched folder (`stick`) and the agent's folder (`home`). */
export function tempDirs(): { root: string; stick: string; home: string; cleanup: () => Promise<void> } {
  const root = mkdtempSync(join(tmpdir(), 'sir-agent-'));
  return {
    root,
    stick: join(root, 'pennina'),
    home: join(root, 'agente'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export interface LiveServer extends TestServer {
  url: string;
  port: number;
  token: string;
}

/** Real server (in-memory PGlite) listening on 127.0.0.1; `port` 0 = any free port. */
export async function startLiveServer(port = 0): Promise<LiveServer> {
  const server = await startServer();
  const token = await createAgent(server);
  await server.app.listen({ host: '127.0.0.1', port });
  const actual = (server.app.server.address() as AddressInfo).port;
  return { ...server, url: `http://127.0.0.1:${actual}`, port: actual, token };
}

/** A port with nothing listening (taken and released at once). */
export async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address() as AddressInfo;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

export interface LogEntry {
  level: number;
  msg: string;
  [key: string]: unknown;
}

/** Logger that keeps every entry in memory (also the raw text, to check what is never logged). */
export function memoryLogger(): { logger: Logger; entries: LogEntry[]; raw: string[] } {
  const entries: LogEntry[] = [];
  const raw: string[] = [];
  const logger = pino(
    { level: 'debug', redact: { paths: ['agentToken', '*.agentToken', 'authorization', '*.authorization'] } },
    {
      write: (chunk: string) => {
        raw.push(chunk);
        entries.push(JSON.parse(chunk) as LogEntry);
      },
    },
  );
  return { logger, entries, raw };
}

export const FAST_TIMING: Partial<AgentTiming> = {
  retryBaseMs: 20,
  retryMaxMs: 100,
  authPauseMs: 150,
  rereadMs: 60_000,
  statusIntervalMs: 60_000,
  requestTimeoutMs: 5000,
};

export function agentConfig(
  dirs: { stick: string; home: string },
  url: string,
  token: string,
  extra: object = {},
): AgentConfig {
  return parseConfig(
    {
      watchPath: dirs.stick,
      serverUrl: url,
      agentToken: token,
      pollIntervalMs: 10,
      stableMs: 20,
      logLevel: 'debug',
      ...extra,
    },
    dirs.home,
  );
}

/** Fetch that records every ingest request (decoded) before sending it. */
export function recordingFetch(): { fetch: FetchLike; requests: IngestRequest[] } {
  const requests: IngestRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const body = init.body as Buffer;
    const gz = (init.headers as Record<string, string>)['content-encoding'] === 'gzip';
    const { gunzipSync } = await import('node:zlib');
    const json = (gz ? gunzipSync(body) : body).toString('utf8');
    requests.push(IngestRequestSchema.parse(JSON.parse(json)));
    return fetch(input, init);
  };
  return { fetch: fetchImpl, requests };
}

export interface RunningAgent {
  agent: Agent;
  stop: () => Promise<void>;
}

/** Starts the main loop of an agent in the background. */
export async function runAgent(
  config: AgentConfig,
  logger: Logger,
  options: { timing?: Partial<AgentTiming>; fetch?: FetchLike } = {},
): Promise<RunningAgent> {
  const agent = await Agent.create({
    config,
    logger,
    timing: { ...FAST_TIMING, ...options.timing },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const controller = new AbortController();
  const loop = agent.run(controller.signal);
  return {
    agent,
    stop: async () => {
      controller.abort();
      await loop;
    },
  };
}

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
  what = 'condizione',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout in attesa di: ${what}`);
}

export interface ServerMatch {
  id: string;
  matchKey: string;
  lineCount: number;
  lastSeq: number;
  contentHash: string | null;
  state: unknown;
}

/** Matches stored by the server, read through the admin API (`GET /api/admin/matches/:id`). */
export async function serverMatches(server: TestServer): Promise<ServerMatch[]> {
  const cookie = await login(server.app, ADMIN);
  const list = await server.app.inject({ method: 'GET', url: '/api/admin/matches', headers: { cookie } });
  const out: ServerMatch[] = [];
  for (const m of list.json<{ id: string }[]>()) {
    const res = await server.app.inject({ method: 'GET', url: `/api/admin/matches/${m.id}`, headers: { cookie } });
    out.push(res.json<ServerMatch>());
  }
  return out;
}

/** Deletes every match (and its lines) from the server database, as after a reset. */
export async function wipeMatches(server: TestServer): Promise<void> {
  await server.database.db.delete(matches);
}
