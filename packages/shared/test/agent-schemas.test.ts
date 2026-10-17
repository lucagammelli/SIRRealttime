import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_SCHEMAS_DIR, agentSchemaFiles } from '../scripts/agent-schemas.js';

const dir = join(import.meta.dirname, '..', '..', '..', AGENT_SCHEMAS_DIR);
const update = 'schemi non aggiornati: lancia pnpm --filter @sir/shared schemi:agente';

describe('JSON Schema dell’agente C#', () => {
  it('i file in apps/agent-dotnet/schemas sono quelli generati dagli schemi zod', async () => {
    const expected = agentSchemaFiles();
    for (const [name, content] of Object.entries(expected)) {
      const onDisk = await readFile(join(dir, name), 'utf8').catch(() => null);
      expect(onDisk, `${name}: ${update}`).toBe(content);
    }
    const present = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
    expect(present, update).toEqual(Object.keys(expected).sort());
  });

  it('lo schema della richiesta di ingest porta anche le regole dei refine', () => {
    const schema = JSON.parse(agentSchemaFiles()['ingest-request.schema.json'] ?? '{}') as Record<string, unknown>;
    expect(JSON.stringify(schema['allOf'])).toContain('snapshot');
    expect(JSON.stringify(schema)).toContain('\\\\[3SCOUT\\\\]');
  });
});
