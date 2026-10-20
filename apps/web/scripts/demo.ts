/**
 * Live demo for development: server in-process (in-memory PGlite), synthetic match played by the simulator and sent
 * by the real agent, as in production. Then `pnpm --filter @arenalive/web dev` shows it at http://localhost:5173.
 *
 *   pnpm --filter @arenalive/web demo
 *
 * Variables (all optional): DEMO_SPEED (time acceleration of the simulator, default 15), DEMO_SEED (default 1),
 * DEMO_SETS (3, 4 or 5; default 4), DEMO_PORT (default 8090), DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD.
 * Everything is lost when the process stops (Ctrl+C).
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '@arenalive/agent/src/agent.ts';
import { parseConfig } from '@arenalive/agent/src/config.ts';
import { createLogger } from '@arenalive/agent/src/logger.ts';
import { generateMatch, play } from '@arenalive/dvw-simulator';
import { buildApp, createDatabase, loadConfig, seedAdmin, SESSION_COOKIE } from '@arenalive/server';
import { CreateAgentResponseSchema, CreateShareTokenResponseSchema } from '@arenalive/shared';
import { z } from 'zod';

const PORTAL = 'http://localhost:5173';

const EnvSchema = z.object({
  DEMO_SPEED: z.coerce.number().positive().max(10_000).default(15),
  DEMO_SEED: z.coerce.number().int().min(0).default(1),
  DEMO_SETS: z
    .enum(['3', '4', '5'])
    .default('4')
    .transform((v) => Number(v) as 3 | 4 | 5),
  DEMO_PORT: z.coerce.number().int().min(1).max(65535).default(8090),
  // Development credentials of a throw-away in-memory database, not a secret.
  DEMO_ADMIN_EMAIL: z.email().default('admin@arenalive.local'),
  DEMO_ADMIN_PASSWORD: z.string().min(12).default('password-demo-arenalive'),
});

async function main(): Promise<void> {
  const env = EnvSchema.parse(process.env);
  const config = loadConfig({
    DATABASE_URL: 'pglite:memory',
    HOST: '127.0.0.1',
    PORT: String(env.DEMO_PORT),
    CORS_ORIGIN: PORTAL,
    PUBLIC_BASE_URL: PORTAL,
    COOKIE_SECURE: 'false',
    ADMIN_EMAIL: env.DEMO_ADMIN_EMAIL,
    ADMIN_PASSWORD: env.DEMO_ADMIN_PASSWORD,
    LOG_LEVEL: 'warn',
  });
  const database = await createDatabase(config.databaseUrl);
  await database.migrate();
  // Generous limits: the demo shares one IP between browser, proxy and agent.
  const app = await buildApp({
    config,
    db: database.db,
    rateLimits: { login: 100, ingest: 100_000, public: 10_000, admin: 10_000 },
  });
  await seedAdmin(database.db, config, app.log);
  await app.listen({ port: config.port, host: config.host });

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: env.DEMO_ADMIN_EMAIL, password: env.DEMO_ADMIN_PASSWORD },
  });
  const session = login.cookies.find((c) => c.name === SESSION_COOKIE);
  if (login.statusCode !== 200 || !session) throw new Error(`login dell'admin di prova fallito (${login.statusCode})`);
  const cookie = `${SESSION_COOKIE}=${session.value}`;
  const post = async <T>(url: string, payload: object, schema: z.ZodType<T>): Promise<T> => {
    const res = await app.inject({ method: 'POST', url, payload, headers: { cookie } });
    if (res.statusCode !== 201) throw new Error(`${url}: risposta ${res.statusCode}`);
    return schema.parse(res.json());
  };
  const agentToken = await post('/api/admin/agents', { name: 'Agente demo' }, CreateAgentResponseSchema);
  const share = await post(
    '/api/admin/share-tokens',
    { label: 'Demo live', matchId: null, expiresAt: null },
    CreateShareTokenResponseSchema,
  );

  // Simulator writes on the "USB stick" folder; the agent keeps its queue and logs elsewhere (as required by its config).
  const dir = await mkdtemp(join(tmpdir(), 'arenalive-demo-'));
  const stick = join(dir, 'pennina');
  await mkdir(stick, { recursive: true });
  const agentConfig = parseConfig(
    {
      watchPath: stick,
      serverUrl: `http://127.0.0.1:${config.port}`,
      agentToken: agentToken.token,
      pollIntervalMs: 250,
      stableMs: 250,
      dataDir: join(dir, 'agente', 'data'),
      logDir: join(dir, 'agente', 'logs'),
      logLevel: 'warn',
    },
    dir,
  );
  const { logger, close: closeLog } = createLogger({ level: 'warn', logDir: agentConfig.logDir, console: true });
  const agent = await Agent.create({ config: agentConfig, logger });
  const controller = new AbortController();
  const agentDone = agent.run(controller.signal);

  const match = generateMatch({ seed: env.DEMO_SEED, sets: env.DEMO_SETS });
  const played = play(match, {
    out: join(stick, 'demo.dvw'),
    speed: env.DEMO_SPEED,
    mode: 'atomic',
    corrections: true,
    signal: controller.signal,
  }).then(() => {
    if (!controller.signal.aborted)
      process.stdout.write('\nPartita simulata conclusa: il server resta acceso (Ctrl+C per chiudere).\n');
  });

  process.stdout.write(
    [
      '',
      'Demo ArenaLive avviata',
      `  Pagina pubblica: ${share.url}`,
      `  Maxischermo:     ${share.url}?tv=1`,
      `  Area riservata:  ${PORTAL}/admin   (${env.DEMO_ADMIN_EMAIL} / ${env.DEMO_ADMIN_PASSWORD})`,
      `  Server:          http://127.0.0.1:${config.port}`,
      `  Partita:         ${match.home.name} - ${match.away.name}, ${env.DEMO_SETS} set, velocità ×${env.DEMO_SPEED}`,
      '',
      'In un altro terminale avvia il portale: pnpm --filter @arenalive/web dev',
      '',
    ].join('\n'),
  );

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    controller.abort();
    void Promise.allSettled([agentDone, played])
      .then(() => app.close())
      .then(() => database.close())
      .finally(() => {
        closeLog();
        void rm(dir, { recursive: true, force: true }).finally(() => process.exit(0));
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write(`Demo non avviata: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
