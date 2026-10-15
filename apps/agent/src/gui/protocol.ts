import { z } from 'zod';

/**
 * Messages between the window (PowerShell, `window.ps1`) and the agent: one JSON object per line on the stdin and
 * stdout of the window process. Internal to the agent (not an agent↔server contract, so not in `@sir/shared`).
 */

/** Longest line accepted from the window. */
export const MAX_GUI_LINE = 8192;

/** Window → agent. */
export const GuiInMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('start'),
      watchPath: z.string().trim().min(1).max(1024),
      /** Pasted in the window; absent = keep the one in config.json. */
      token: z.string().max(400).optional(),
    })
    .strict(),
  z.object({ type: z.literal('stop') }).strict(),
  z.object({ type: z.literal('quit') }).strict(),
]);
export type GuiInMessage = z.infer<typeof GuiInMessageSchema>;

export const GUI_PHASES = ['idle', 'starting', 'running', 'stopping'] as const;
export type GuiPhase = (typeof GUI_PHASES)[number];

const AgentStatusSchema = z.object({
  file: z.string().nullable(),
  matchKey: z.string().nullable(),
  lines: z.int(),
  queue: z.int(),
  lastSuccessAt: z.string().nullable(),
  serverReachable: z.boolean(),
});

/** Agent → window. The token never travels in clear: only whether it is there and its last 4 characters. */
export const GuiOutMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    watchPath: z.string(),
    serverUrl: z.string(),
    token: z.object({ present: z.boolean(), last4: z.string().nullable() }),
    configError: z.string().optional(),
  }),
  z.object({ type: z.literal('state'), phase: z.enum(GUI_PHASES), status: AgentStatusSchema.nullable() }),
  z.object({
    type: z.literal('log'),
    /** ISO 8601 UTC; the window shows it in local time. */
    time: z.string(),
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    msg: z.string(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type GuiOutMessage = z.infer<typeof GuiOutMessageSchema>;
export type GuiLogMessage = Extract<GuiOutMessage, { type: 'log' }>;

/** Parses one line from the window; `null` when it is not valid JSON or not a known message. */
export function parseGuiLine(line: string): GuiInMessage | null {
  if (line.length > MAX_GUI_LINE) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  const parsed = GuiInMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
