import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_SCHEMAS_DIR, agentSchemaFiles } from './agent-schemas.js';

/**
 * Writes the JSON Schemas of the C# agent in `apps/agent-dotnet/schemas/` (generated: never edit them by hand).
 * Uso: pnpm --filter @arenalive/shared schemi:agente
 */
const root = join(import.meta.dirname, '..', '..', '..');
const dir = join(root, AGENT_SCHEMAS_DIR);
await mkdir(dir, { recursive: true });
for (const [name, content] of Object.entries(agentSchemaFiles())) {
  await writeFile(join(dir, name), content, 'utf8');
  console.log(`scritto ${AGENT_SCHEMAS_DIR}/${name}`);
}
