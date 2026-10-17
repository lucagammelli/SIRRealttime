import { z } from 'zod';
import {
  AGENT_BRANDING_VERSION,
  AGENT_EXPIRED_ERROR,
  AGENT_LOGO_MAX_BYTES,
  AGENT_LOGO_MAX_SIDE,
  AgentBrandingSchema,
  ApiErrorSchema,
  CreateRegistrationRequestSchema,
  CreateRegistrationResponseSchema,
  INGEST_MAX_HEADER_LENGTH,
  INGEST_MAX_LINES,
  INGEST_MAX_LINE_LENGTH,
  INGEST_PROTOCOL,
  IngestRequestSchema,
  IngestResponseSchema,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  RegistrationStatusResponseSchema,
  SCOUT_SECTION_MARKER,
} from '../src/index.js';

/**
 * Contracts of the C# agent (`apps/agent-dotnet/schemas/`), generated from the zod schemas of this package:
 * the C# tests validate the requests built by the agent against them, so the two agents cannot diverge.
 * Pure: file name → JSON text (stable order, final newline).
 */

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('schema non oggetto');
  return value as JsonObject;
};

/** `property` of an object schema (throws if missing: the zod schema changed shape and the script must follow). */
function property(schema: JsonObject, name: string): JsonObject {
  return asObject(asObject(schema['properties'])[name]);
}

const toSchema = (schema: z.ZodType): JsonObject => asObject(z.toJSONSchema(schema, { io: 'input' }));

/** NUL anywhere in a string. */
const NUL = '\\u0000';
/** JavaScript `\s` (zod refinements are JavaScript regular expressions), spelled out for every regex engine. */
const JS_SPACE = '[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]';

/**
 * The refinements of `IngestRequestSchema` that `z.toJSONSchema` cannot express (it drops them), written here by
 * hand next to the generated part: same rules as `ScoutLineSchema` and the two `refine` of the request.
 */
function ingestRequest(): JsonObject {
  const schema = toSchema(IngestRequestSchema);
  const items = asObject(property(schema, 'lines')['items']);
  items['not'] = {
    anyOf: [{ pattern: '[\\r\\n]' }, { pattern: NUL }, { pattern: `^${JS_SPACE}*\\[3[A-Z0-9-]+\\]${JS_SPACE}*$` }],
  };
  const header = property(schema, 'header');
  header['not'] = { anyOf: [{ pattern: NUL }, { pattern: '\\[3SCOUT\\]' }] };
  schema['allOf'] = [
    {
      if: { properties: { kind: { const: 'snapshot' } }, required: ['kind'] },
      then: { required: ['header'], properties: { fromIndex: { const: 0 } } },
    },
  ];
  return schema;
}

/** `plainText(100)`: besides the length, no control characters and not only spaces (zod trims before `min(1)`). */
function createRegistrationRequest(): JsonObject {
  const schema = toSchema(CreateRegistrationRequestSchema);
  const name = property(schema, 'name');
  name['allOf'] = [{ pattern: '^[^\\u0000-\\u001f\\u007f]*$' }, { not: { pattern: `^${JS_SPACE}*$` } }];
  return schema;
}

/** Limits and fixed texts shared with the C# agent (checked by its tests against its own constants). */
function constants(): JsonObject {
  return {
    ingestProtocol: INGEST_PROTOCOL,
    ingestMaxLines: INGEST_MAX_LINES,
    ingestMaxLineLength: INGEST_MAX_LINE_LENGTH,
    ingestMaxHeaderLength: INGEST_MAX_HEADER_LENGTH,
    scoutSectionMarker: SCOUT_SECTION_MARKER,
    agentExpiredError: AGENT_EXPIRED_ERROR,
    pairingCodeAlphabet: PAIRING_CODE_ALPHABET,
    pairingCodeLength: PAIRING_CODE_LENGTH,
    agentBrandingVersion: AGENT_BRANDING_VERSION,
    agentLogoMaxBytes: AGENT_LOGO_MAX_BYTES,
    agentLogoMaxSide: AGENT_LOGO_MAX_SIDE,
  };
}

const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Every generated file of `apps/agent-dotnet/schemas/`, by name. */
export function agentSchemaFiles(): Record<string, string> {
  return {
    'agent-branding.schema.json': text(toSchema(AgentBrandingSchema)),
    'agent-constants.json': text(constants()),
    'api-error.schema.json': text(toSchema(ApiErrorSchema)),
    'create-registration-request.schema.json': text(createRegistrationRequest()),
    'create-registration-response.schema.json': text(toSchema(CreateRegistrationResponseSchema)),
    'ingest-request.schema.json': text(ingestRequest()),
    'ingest-response.schema.json': text(toSchema(IngestResponseSchema)),
    'registration-status-response.schema.json': text(toSchema(RegistrationStatusResponseSchema)),
  };
}

/** Folder of the generated files, relative to the root of the repository. */
export const AGENT_SCHEMAS_DIR = 'apps/agent-dotnet/schemas';
