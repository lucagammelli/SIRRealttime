import type { RosterImportState } from '@arenalive/shared';
import { cleanAssetName } from '@arenalive/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from './context.js';
import { players } from './db/index.js';
import { HttpError } from './lib/errors.js';
import { lockClientAssets, storeAsset } from './routes/branding.js';
import { tenantConfigChanged, tenantScope } from './tenancy.js';

/** A photo of the site to download for a player of the roster. */
export interface PhotoToDownload {
  playerId: string;
  key: string;
  firstName: string;
  lastName: string;
}

const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const IDLE: RosterImportState = { running: false, photosDone: 0, photosTotal: 0, lastAt: null, lastError: null };

/**
 * Photos of the players of an import, downloaded in the background (one job per client at a time, its state in
 * memory): each one checked from its bytes and stored in the library of the client (kind `player`, named «Cognome
 * Nome.jpg»), then it becomes the main photo of the player unless one was chosen meanwhile. A photo missing on the
 * site is skipped; the quota of the client stops the job (`lastError`).
 */
export class RosterPhotoJobs {
  private readonly states = new Map<string, RosterImportState>();
  private readonly running = new Set<Promise<void>>();
  private closed = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly log: FastifyBaseLogger,
  ) {}

  state(tenantId: string): RosterImportState {
    return this.states.get(tenantId) ?? IDLE;
  }

  isRunning(tenantId: string): boolean {
    return this.state(tenantId).running;
  }

  /** Starts the download of `photos` for a client (its import is over: the roster is already saved). */
  start(tenantId: string, teamExternalId: number, photos: readonly PhotoToDownload[]): void {
    // One job per client: a second one waits for the next import.
    if (this.isRunning(tenantId)) return;
    if (photos.length === 0 || this.closed) {
      this.states.set(tenantId, { ...IDLE, lastAt: this.ctx.now().toISOString() });
      return;
    }
    this.states.set(tenantId, {
      running: true,
      photosDone: 0,
      photosTotal: photos.length,
      lastAt: null,
      lastError: null,
    });
    const run: Promise<void> = this.run(tenantId, teamExternalId, photos).finally(() => this.running.delete(run));
    this.running.add(run);
  }

  /** Server shutdown: no new photo, the running jobs end. */
  async close(): Promise<void> {
    this.closed = true;
    await this.idle();
  }

  async idle(): Promise<void> {
    await Promise.allSettled([...this.running]);
  }

  private async run(tenantId: string, teamExternalId: number, photos: readonly PhotoToDownload[]): Promise<void> {
    let done = 0;
    let failed = 0;
    let stored = 0;
    let stop: string | null = null;
    for (const photo of photos) {
      if (this.closed) break;
      try {
        const file = await this.ctx.leagues.fetchPlayerPhoto(photo.key, teamExternalId);
        if (file) {
          const ext = EXTENSION[file.info.mime] ?? 'jpg';
          const name = cleanAssetName(`${photo.lastName} ${photo.firstName}.${ext}`);
          await this.ctx.db.transaction(async (tx) => {
            await lockClientAssets(tx, tenantId);
            const { row } = await storeAsset(this.ctx, tx, tenantId, 'player', file.data, file.info, name);
            await tx
              .update(players)
              .set({ photoAssetId: row.id, updatedAt: this.ctx.now() })
              .where(tenantScope(players, tenantId, and(eq(players.id, photo.playerId), isNull(players.photoAssetId))));
          });
          stored++;
        }
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 409) {
          // The quota of the client: the next photos would not fit either.
          stop = err.message;
          break;
        }
        failed++;
        this.log.warn({ err, tenantId, key: photo.key }, 'foto del giocatore non scaricata');
      }
      done++;
      this.states.set(tenantId, { ...this.state(tenantId), photosDone: done });
    }
    this.states.set(tenantId, {
      running: false,
      photosDone: done,
      photosTotal: photos.length,
      lastAt: this.ctx.now().toISOString(),
      lastError: stop ?? (failed > 0 ? `${failed} foto non scaricate dal sito della Lega` : null),
    });
    this.log.info({ tenantId, stored, failed, stopped: stop !== null }, 'foto della rosa scaricate');
    // The public pages show the photos of the players.
    if (stored > 0) tenantConfigChanged(this.ctx, tenantId);
  }
}
