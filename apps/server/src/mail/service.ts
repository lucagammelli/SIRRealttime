import type { MailSettings, MailTestResponse, UpdateMailSettingsRequest } from '@arenalive/shared';
import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { mailSettings } from '../db/index.js';
import { conflict } from '../lib/errors.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import type { MailContent } from './templates.js';
import { testMail } from './templates.js';

/** Connection and send timeouts: the portal never waits long for a mail server. */
export const CONNECTION_TIMEOUT_MS = 5_000;
export const SOCKET_TIMEOUT_MS = 8_000;
/** The whole send (connection, login, delivery) is given up after this. */
export const SEND_TIMEOUT_MS = 10_000;

export const NO_KEY_MESSAGE =
  'Per salvare la password serve la chiave SETTINGS_ENCRYPTION_KEY nel file .env del server (vedi .env.example).';

/** What the mail transport needs to connect. */
export interface SmtpConnection {
  host: string;
  port: number;
  security: 'none' | 'starttls' | 'tls';
  username: string;
  password: string | null;
  fromName: string;
  fromEmail: string;
}

export interface OutgoingMail extends MailContent {
  from: { name: string; address: string };
  to: string;
}

/** The part of a nodemailer transport the service uses (tests: a fake that records the messages). */
export interface MailTransport {
  sendMail(message: OutgoingMail): Promise<unknown>;
  close?(): void;
}
export type TransportFactory = (connection: SmtpConnection) => MailTransport;

export const nodemailerTransport: TransportFactory = (c) =>
  nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.security === 'tls',
    requireTLS: c.security === 'starttls',
    ignoreTLS: c.security === 'none',
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    dnsTimeout: CONNECTION_TIMEOUT_MS,
    ...(c.username ? { auth: { user: c.username, pass: c.password ?? '' } } : {}),
  });

export type SendResult = 'sent' | 'not_configured' | 'failed';

/** Pure: an explanation of a mail error in Italian, without addresses, server answers or other internal details. */
export function smtpFailureMessage(err: unknown): string {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
  const responseCode = typeof err === 'object' && err !== null && 'responseCode' in err ? Number(err.responseCode) : 0;
  if (code === 'EAUTH') return 'Il server di posta ha rifiutato utente o password.';
  if (code === 'ENOTFOUND' || code === 'EDNS') return 'Server di posta non trovato: controlla il nome del server.';
  if (code === 'ECONNREFUSED') return 'Il server di posta ha rifiutato la connessione: controlla porta e sicurezza.';
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNRESET' || code === 'ECONNECTION')
    return 'Il server di posta non risponde in tempo: controlla nome, porta e sicurezza.';
  if (code === 'ETLS' || code === 'ECERT' || /^ERR_SSL|CERT/.test(code))
    return 'Connessione sicura non riuscita: controlla il tipo di sicurezza e la porta.';
  if (code === 'EENVELOPE' || responseCode >= 500)
    return 'Il server di posta ha rifiutato il messaggio: controlla l’indirizzo del mittente.';
  if (code === 'SEND_TIMEOUT') return 'Il server di posta non risponde in tempo.';
  if (code === 'PASSWORD_UNREADABLE')
    return 'La password salvata non si può leggere (chiave cambiata?): inseriscila di nuovo.';
  return 'Invio non riuscito: controlla le impostazioni del server di posta.';
}

class MailError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type Row = typeof mailSettings.$inferSelect;

/**
 * Mail of the portal. Settings in the database (`mail_settings`, one row, edited by the superadmin); the password is
 * encrypted with `key`. `send` never throws and never waits more than SEND_TIMEOUT_MS; logs carry no address nor password.
 */
export class MailService {
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly deps: {
      db: Db;
      key: Buffer | null;
      log: FastifyBaseLogger;
      factory?: TransportFactory;
      now?: () => Date;
    },
  ) {}

  private async row(): Promise<Row | null> {
    const [row] = await this.deps.db.select().from(mailSettings).limit(1);
    return row ?? null;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.row()) !== null;
  }

  private view(row: Row | null): MailSettings {
    return {
      host: row?.host ?? '',
      port: row?.port ?? 587,
      security: row?.security ?? 'starttls',
      username: row?.username ?? '',
      passwordSet: row?.passwordEnc !== null && row?.passwordEnc !== undefined,
      fromName: row?.fromName ?? '',
      fromEmail: row?.fromEmail ?? '',
      configured: row !== null,
      encryptionAvailable: this.deps.key !== null,
    };
  }

  /** The settings for the portal: never the password. */
  async settings(): Promise<MailSettings> {
    return this.view(await this.row());
  }

  /** Saves the settings (409 when a password is given without SETTINGS_ENCRYPTION_KEY). */
  async save(req: UpdateMailSettingsRequest): Promise<MailSettings> {
    const { key } = this.deps;
    if (req.password !== undefined && !key) throw conflict(NO_KEY_MESSAGE);
    const current = await this.row();
    let passwordEnc = current?.passwordEnc ?? null;
    if (req.clearPassword) passwordEnc = null;
    if (req.password !== undefined && key) passwordEnc = encryptSecret(key, req.password);
    const values = {
      host: req.host,
      port: req.port,
      security: req.security,
      username: req.username,
      passwordEnc,
      fromName: req.fromName,
      fromEmail: req.fromEmail,
      updatedAt: (this.deps.now ?? (() => new Date()))(),
    };
    const [saved] = await this.deps.db
      .insert(mailSettings)
      .values({ singleton: true, ...values })
      .onConflictDoUpdate({ target: mailSettings.singleton, set: values })
      .returning();
    return this.view(saved ?? null);
  }

  private connection(row: Row): SmtpConnection {
    let password: string | null = null;
    if (row.passwordEnc !== null) {
      password = this.deps.key ? decryptSecret(this.deps.key, row.passwordEnc) : null;
      if (password === null) throw new MailError('PASSWORD_UNREADABLE');
    }
    return {
      host: row.host,
      port: row.port,
      security: row.security,
      username: row.username,
      password,
      fromName: row.fromName,
      fromEmail: row.fromEmail,
    };
  }

  /** Sends or throws (an error with a `code`); used by `send` and by the test of the «Posta» page. */
  private async deliver(row: Row, to: string, content: MailContent): Promise<void> {
    const connection = this.connection(row);
    const transport = (this.deps.factory ?? nodemailerTransport)(connection);
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new MailError('SEND_TIMEOUT')), SEND_TIMEOUT_MS);
      });
      await Promise.race([
        transport.sendMail({ ...content, to, from: { name: connection.fromName, address: connection.fromEmail } }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
      transport.close?.();
    }
  }

  /** Sends a mail: `not_configured` without settings, `failed` on any error (logged by code only). */
  async send(to: string, content: MailContent): Promise<SendResult> {
    let row: Row | null;
    try {
      row = await this.row();
    } catch (err) {
      this.deps.log.error({ err }, 'impostazioni di posta non leggibili');
      return 'failed';
    }
    if (!row) return 'not_configured';
    try {
      await this.deliver(row, to, content);
      return 'sent';
    } catch (err) {
      this.deps.log.warn({ code: errorCode(err) }, 'invio della mail non riuscito');
      return 'failed';
    }
  }

  /** «Invia una mail di prova»: the outcome with a message ready to be shown. */
  async test(to: string): Promise<MailTestResponse> {
    const row = await this.row();
    if (!row) return { ok: false, message: 'Salva prima le impostazioni del server di posta.' };
    try {
      await this.deliver(row, to, testMail());
      return { ok: true, message: `Mail di prova inviata a ${to}.` };
    } catch (err) {
      this.deps.log.warn({ code: errorCode(err) }, 'mail di prova non riuscita');
      return { ok: false, message: smtpFailureMessage(err) };
    }
  }

  /** Runs `work` after the answer has gone (same timing whatever it finds); errors are logged, never thrown. */
  background(work: () => Promise<void>): void {
    const task = work()
      .catch((err: unknown) => this.deps.log.error({ err }, 'attività di posta in background non riuscita'))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  /** Resolves when the background work started so far is done (shutdown, tests). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }
}

function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) return String(err.code);
  return 'sconosciuto';
}
