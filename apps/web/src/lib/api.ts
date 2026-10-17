import { ApiErrorSchema } from '@sir/shared';
import type { z } from 'zod';

/** HTTP error of the API, with a message in Italian ready to be shown. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Dati non validi: controlla i campi.',
  401: 'Sessione scaduta o credenziali non valide.',
  403: 'Non hai i permessi per questa operazione.',
  404: 'Elemento non trovato.',
  409: 'Esiste già un elemento con questi dati.',
  413: 'Richiesta troppo grande.',
  429: 'Troppe richieste: riprova tra un minuto.',
};

/** Statuses whose message from the server is shown as it is (it explains what to change). */
const EXPLAINED_STATUSES = new Set([409, 413, 422]);

/** Message shown for any error thrown by `apiRequest` (or by anything else). */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Errore di rete: controlla la connessione e riprova.';
}

async function serverMessage(res: Response): Promise<string | null> {
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.error : null;
  } catch {
    return null;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: string | undefined;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body ?? {});
  }
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(path, {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      ...(body === undefined ? {} : { body }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Server non raggiungibile: controlla la connessione e riprova.');
  }
  if (!res.ok) {
    // 409 explains the conflict (also «Scegli prima un cliente», TENANT_REQUIRED_MESSAGE, to a superadmin outside
    // any client), 413 and 422 why an image was refused.
    const fromServer = EXPLAINED_STATUSES.has(res.status) ? await serverMessage(res) : null;
    const base =
      STATUS_MESSAGES[res.status] ??
      (res.status >= 500 ? 'Errore del server: riprova più tardi.' : 'Richiesta non riuscita.');
    throw new ApiError(res.status, fromServer ? `${fromServer}.` : base);
  }
  return res;
}

/**
 * Same-origin call to the server: cookie included, JSON body (required by the server for every POST),
 * response validated with the shared `schema`.
 */
export async function apiRequest<T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
  const res = await send(path, options);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, 'Risposta del server non leggibile.');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError(res.status, 'Risposta del server non valida.');
  return parsed.data;
}

/** Same as `apiRequest` for calls without a response body (logout, revocations: 204). */
export async function apiCommand(path: string, options: RequestOptions = {}): Promise<void> {
  await send(path, options);
}
