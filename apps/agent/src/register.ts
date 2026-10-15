import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreateRegistrationResponse, RegistrationStatusResponse } from '@sir/shared';
import {
  CreateRegistrationRequestSchema,
  CreateRegistrationResponseSchema,
  RegistrationStatusResponseSchema,
  plainText,
} from '@sir/shared';
import { z } from 'zod';
import type { FetchLike } from './sender.js';
import { apiUrl } from './sender.js';
import { writeFileAtomic } from './store.js';
import { errorCode, errorMessage } from './util.js';

/**
 * Self-registration of the agent (pairing): `POST /api/agents/registrations` with a name, then
 * `POST /api/agents/registrations/status` with the secret until an admin approves it in the portal. The secret only
 * ever goes into the `Authorization` header, never into logs or error messages.
 */

export type RegistrationErrorCode =
  'NETWORK' | 'ABORTED' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'INVALID_REQUEST' | 'INVALID_RESPONSE' | 'HTTP';

/** Error of a registration request; `message` is for the window (Italian, no secret). */
export class RegistrationError extends Error {
  constructor(
    readonly code: RegistrationErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RegistrationError';
  }
}

/** What the controller needs of the client (a fake one in the tests); `signal` cancels the request at once. */
export interface RegistrationApi {
  create: (name: string, signal?: AbortSignal) => Promise<CreateRegistrationResponse>;
  status: (secret: string, signal?: AbortSignal) => Promise<RegistrationStatusResponse>;
}

export interface RegistrationClientOptions {
  serverUrl: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

export const registrationsUrl = (serverUrl: string): string => apiUrl(serverUrl, 'api/agents/registrations');
export const registrationStatusUrl = (serverUrl: string): string =>
  apiUrl(serverUrl, 'api/agents/registrations/status');

/** Client of the public registration routes. JSON body, no `Origin` (the server refuses a foreign one). */
export class RegistrationClient implements RegistrationApi {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: RegistrationClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async create(name: string, signal?: AbortSignal): Promise<CreateRegistrationResponse> {
    const body = CreateRegistrationRequestSchema.safeParse({ name });
    if (!body.success) {
      throw new RegistrationError('INVALID_REQUEST', 'Nome agente non valido: da 1 a 100 caratteri, su una riga');
    }
    const raw = await this.post(registrationsUrl(this.options.serverUrl), body.data, {}, signal);
    const parsed = CreateRegistrationResponseSchema.safeParse(raw);
    if (!parsed.success) throw invalidResponse();
    return parsed.data;
  }

  async status(secret: string, signal?: AbortSignal): Promise<RegistrationStatusResponse> {
    const raw = await this.post(
      registrationStatusUrl(this.options.serverUrl),
      {},
      { authorization: `Bearer ${secret}` },
      signal,
    );
    const parsed = RegistrationStatusResponseSchema.safeParse(raw);
    if (!parsed.success) throw invalidResponse();
    return parsed.data;
  }

  private async post(
    url: string,
    body: object,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw new RegistrationError('ABORTED', 'Richiesta annullata');
      throw new RegistrationError('NETWORK', `Server non raggiungibile: ${errorMessage(err)}`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw httpError(res.status);
    }
    try {
      return await res.json();
    } catch {
      throw invalidResponse();
    }
  }
}

const invalidResponse = (): RegistrationError =>
  new RegistrationError('INVALID_RESPONSE', 'Risposta del server non valida: controlla serverUrl in config.json');

function httpError(status: number): RegistrationError {
  if (status === 401) {
    return new RegistrationError(
      'UNAUTHORIZED',
      'Richiesta di registrazione non riconosciuta dal server: registra di nuovo',
      status,
    );
  }
  if (status === 429) {
    return new RegistrationError(
      'RATE_LIMITED',
      'Troppe richieste di registrazione: riprova tra qualche minuto (o rifiuta dal portale quelle in attesa)',
      status,
    );
  }
  if (status === 404) {
    return new RegistrationError(
      'HTTP',
      'Registrazione non disponibile su questo server (404): controlla serverUrl in config.json',
      status,
    );
  }
  return new RegistrationError('HTTP', `Il server ha risposto con un errore (HTTP ${status})`, status);
}

/** Registration waiting for the approval, kept in `<dataDir>/registration.json` to resume it after a restart. */
export const PendingRegistrationSchema = CreateRegistrationResponseSchema.extend({
  version: z.literal(1),
  name: plainText(100),
});
export type PendingRegistration = z.infer<typeof PendingRegistrationSchema>;

export const registrationFile = (dataDir: string): string => join(dataDir, 'registration.json');

/** The pending registration, or `null` (missing or unreadable file: an unreadable one is deleted). */
export async function loadPendingRegistration(dataDir: string): Promise<PendingRegistration | null> {
  const file = registrationFile(dataDir);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const parsed = PendingRegistrationSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  await rm(file, { force: true });
  return null;
}

export async function savePendingRegistration(dataDir: string, registration: PendingRegistration): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFileAtomic(registrationFile(dataDir), JSON.stringify(registration));
}

export async function clearPendingRegistration(dataDir: string): Promise<void> {
  await rm(registrationFile(dataDir), { force: true });
}
