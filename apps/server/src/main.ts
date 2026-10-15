import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { seedAdmin } from './seed.js';
import { syncShortCodes } from './shareCodes.js';

/** Entry point: configuration, migrations, seed of the first admin, HTTP server. */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = await createDatabase(config.databaseUrl);
  await database.migrate();
  const app = await buildApp({ config, db: database.db });
  await seedAdmin(database.db, config, app.log);
  if (config.shareCodeSecretIsDefault)
    app.log.warn('SHARE_CODE_SECRET non impostata: codici brevi con il segreto di sviluppo (vietato in produzione)');
  await syncShortCodes(database.db, config.shareCodeSecret, app.log);

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'arresto del server');
    void app
      .close()
      .then(() => database.close())
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err: unknown) => {
  // The configuration error lists only variable names; other startup errors without stack details for secrets.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Avvio del server fallito: ${message}\n`);
  process.exit(1);
});
