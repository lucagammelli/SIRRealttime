import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Validates `data` with a schema of `@arenalive/shared`; a failure becomes a 400 that lists only the field paths. */
export function validate<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields = [...new Set(r.error.issues.map((i) => i.path.join('.') || '(body)'))].slice(0, 10).join(', ');
  throw badRequest(`Richiesta non valida: ${fields}`);
}
