import type {
  AgentDownloadInfo,
  AgentRelease,
  DisplayImageTicket,
  PlayerImageInfo,
  TenantBranding,
} from '@arenalive/shared';
import {
  AGENT_LOGO_FILES,
  AGENT_LOGO_MAX_BYTES,
  AGENT_LOGO_MAX_SIDE,
  AGENT_ZIP_FOLDER,
  agentBranding,
  agentDownloadConfig,
  agentDownloadFileName,
  DisplayImageRequestSchema,
  DisplayImageTicketParamSchema,
  IdParamSchema,
  PLAYER_IMAGE_PATH,
  playerImageFileName,
  playerReadyImageFileName,
  resolveBranding,
} from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { AgentReleaseStore } from '../agentRelease.js';
import { readAssetFile } from '../assetStore.js';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { assets, displays } from '../db/index.js';
import { rotateDisplayConfig } from '../displays.js';
import { DisplayImageTickets } from '../displayImageTickets.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { closeImage, compressSlot, configSlot, imageBytes, imageStream, PlayerImageStore } from '../playerImage.js';
import type { ZipEntry } from '../lib/zip.js';
import { zipStream } from '../lib/zip.js';
import { requireRole } from '../security.js';
import type { Tenant } from '../tenancy.js';
import { adminTenantId, findTenant, publicBaseUrlFor, tenantDisplayName, tenantScope } from '../tenancy.js';

const notPublished = (): HttpError =>
  new HttpError(404, 'AGENT_NOT_PUBLISHED', 'L’agente non è ancora stato pubblicato sul server');

/** Pure: `LEGGIMI.txt` of the zip (Windows line ends). */
export function readmeText(o: { name: string; serverUrl: string; release: AgentRelease }): string {
  return [
    'ArenaLive - Agente per Windows',
    '',
    `Cliente:  ${o.name}`,
    `Server:   ${o.serverUrl}`,
    `Versione: ${o.release.version}`,
    '',
    'INSTALLAZIONE',
    '1. Scompatta la cartella in C:\\ArenaLiveAgent: arenalive-agent.exe, config.json, branding.json e il logo',
    '   devono restare insieme. Non avviare l’agente dalla pennina di DataVolley.',
    '2. Fai doppio clic su arenalive-agent.exe.',
    '   L’eseguibile non è firmato: se Windows mostra «Windows ha protetto il PC» (SmartScreen),',
    '   premi «Ulteriori informazioni» e poi «Esegui comunque».',
    '3. Nella finestra scrivi il nome dell’agente (es. il nome del PC o della palestra) e premi «Registra».',
    '4. Nel portale, area riservata, pagina «Agenti», riquadro «Richieste in attesa»: controlla che il',
    '   codice sia quello mostrato sul PC e premi «Abilita». L’agente riceve il suo token da solo.',
    '5. Con «Sfoglia…» scegli la pennina (o il file .dvw) di DataVolley e premi START.',
    '',
    'Dati e log dell’agente: C:\\ArenaLiveAgent\\data e C:\\ArenaLiveAgent\\logs (in config.json).',
    `Controllo dell’eseguibile, sha256 di arenalive-agent.exe: ${o.release.sha256}`,
    '',
  ].join('\r\n');
}

/**
 * Logo of the window of the agent: the horizontal logo of the branding, otherwise the square one, if it is a PNG or a
 * JPEG (WinForms reads neither SVG nor WebP) within 2 MB and 1024×1024; null otherwise.
 */
async function logoEntry(
  ctx: AppContext,
  tenantId: string,
  branding: TenantBranding,
  log: FastifyBaseLogger,
): Promise<ZipEntry | null> {
  for (const id of [branding.logoMain, branding.logoMark]) {
    if (id === null) continue;
    const [row] = await ctx.db
      .select()
      .from(assets)
      .where(tenantScope(assets, tenantId, eq(assets.id, id)))
      .limit(1);
    if (!row || (row.mime !== 'image/png' && row.mime !== 'image/jpeg')) continue;
    if (row.bytes > AGENT_LOGO_MAX_BYTES || row.width > AGENT_LOGO_MAX_SIDE || row.height > AGENT_LOGO_MAX_SIDE)
      continue;
    const data = await readAssetFile(ctx.config.assetsDir, row.tenantId, row.sha256);
    if (!data) {
      log.warn({ assetId: row.id }, 'file di un’immagine mancante');
      continue;
    }
    return { name: `${AGENT_ZIP_FOLDER}/${AGENT_LOGO_FILES[row.mime]}`, data };
  }
  return null;
}

const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

/**
 * Agent for Windows (admin of the client; a superadmin on its active client): what is on offer, and the zip for the
 * client with the executable, `config.json` (server of the client, never a token), `branding.json`, the logo and
 * `LEGGIMI.txt`, generated and streamed at every request.
 */
export function agentDownloadRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };
  const store = new AgentReleaseStore(ctx.config.agentDownloadDir);

  const tenantOf = async (id: string): Promise<Tenant> => {
    const tenant = await findTenant(ctx, { id });
    if (!tenant) throw notFound();
    return tenant;
  };

  app.get('/api/admin/agent/info', admin, async (request, reply): Promise<AgentDownloadInfo> => {
    const tenant = await tenantOf(adminTenantId(request));
    void reply.header('cache-control', 'no-store');
    const opened = await store.open(request.log);
    if (!opened) return { available: false };
    await opened.file.close();
    return {
      available: true,
      version: opened.release.version,
      builtAt: opened.release.builtAt,
      bytes: opened.bytes,
      sha256: opened.release.sha256,
      fileName: agentDownloadFileName(tenant.slug, opened.release.version),
    };
  });

  const download = { ...admin, config: perMinute(ctx.rateLimits.agentDownload) };

  app.get('/api/admin/agent/download', download, async (request, reply) => {
    const tenant = await tenantOf(adminTenantId(request));
    const opened = await store.open(request.log);
    if (!opened) throw notPublished();
    const { release, file } = opened;
    try {
      const branding = resolveBranding(tenant.branding);
      const name = tenantDisplayName(tenant, branding);
      const serverUrl = publicBaseUrlFor(ctx.config.publicBaseUrl, tenant.hostnames);
      const logo = await logoEntry(ctx, tenant.id, branding, request.log);
      const entries: ZipEntry[] = [
        { name: `${AGENT_ZIP_FOLDER}/arenalive-agent.exe`, file, size: opened.bytes, crc32: opened.crc32 },
        { name: `${AGENT_ZIP_FOLDER}/config.json`, data: json(agentDownloadConfig(serverUrl)) },
        {
          name: `${AGENT_ZIP_FOLDER}/branding.json`,
          data: json(agentBranding(name, branding.colors, branding.template)),
        },
        ...(logo ? [logo] : []),
        {
          name: `${AGENT_ZIP_FOLDER}/LEGGIMI.txt`,
          data: Buffer.from(`\uFEFF${readmeText({ name, serverUrl, release })}`, 'utf8'),
        },
      ];
      const zip = zipStream(entries, new Date(release.builtAt), () => file.close());
      request.log.info({ tenantId: tenant.id, version: release.version, logo: logo !== null }, 'agente scaricato');
      const fileName = agentDownloadFileName(tenant.slug, release.version);
      return await reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .header('content-length', String(zip.size))
        .header('cache-control', 'no-store')
        .send(zip.stream);
    } catch (err) {
      await file.close().catch(() => undefined);
      throw err;
    }
  });
}

const imageNotPublished = (): HttpError =>
  new HttpError(404, 'PLAYER_IMAGE_NOT_PUBLISHED', 'Immagine non ancora pubblicata sul server');
const readyNotAvailable = (): HttpError =>
  new HttpError(404, 'PLAYER_IMAGE_NOT_READY', 'L’immagine pronta non è disponibile sul server: scarica solo il file');
const ticketNotFound = (): HttpError =>
  new HttpError(404, 'TICKET_NOT_FOUND', 'Download scaduto o già usato: prepara di nuovo l’immagine');
const displayGone = (): HttpError =>
  new HttpError(
    410,
    'DISPLAY_GONE',
    'Il player è stato revocato o ha una configurazione più recente: prepara di nuovo l’immagine',
  );

/** Headers of a downloaded image. */
const imageHeaders = (type: string, fileName: string, bytes: number) => ({
  'content-type': type,
  'content-disposition': `attachment; filename="${fileName}"`,
  'content-length': String(bytes),
  'cache-control': 'no-store',
});

/**
 * Image of the SD card of the players (page «Player»). Admin only, as the agent: who prepares a player also creates
 * it and downloads its configuration (a viewer cannot), and every download is heavy for the server.
 * - generic, the same for every client: what is on offer and the file, streamed (about 750 MB, never in memory):
 *   the three parts of format 2 one after the other (one `.img.gz`), or the `.img.xz` of before;
 * - ready for one player (format 2 only): `POST …/displays/:id/image` gives the player a new token as `…/config`
 *   and a ticket (memory only, used once, 10 minutes, same client and user); `GET …/displays/image/:ticket` streams
 *   the first part, the slot with `arenalive-player.json` compressed now, and the third part.
 */
export function playerImageRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };
  const download = { ...admin, config: perMinute(ctx.rateLimits.agentDownload) };
  const store = new PlayerImageStore(ctx.config.playerDownloadDir);
  const tickets = new DisplayImageTickets(() => ctx.now().getTime());

  app.get(`${PLAYER_IMAGE_PATH}/info`, admin, async (request, reply): Promise<PlayerImageInfo> => {
    void reply.header('cache-control', 'no-store');
    const image = await store.open(request.log);
    if (!image) return { available: false };
    await closeImage(image);
    if (image.format === 1)
      return {
        available: true,
        version: image.version,
        builtAt: image.builtAt,
        bytes: image.bytes,
        sha256: image.sha256,
        sha256Of: 'file',
        fileName: playerImageFileName(image.version, 'xz'),
        ready: false,
      };
    const { manifest } = image;
    return {
      available: true,
      version: manifest.version,
      builtAt: manifest.builtAt,
      bytes: imageBytes(image, image.slotPart),
      sha256: manifest.imageSha256,
      sha256Of: 'image',
      fileName: playerImageFileName(manifest.version, 'gz'),
      ready: true,
    };
  });

  app.get(PLAYER_IMAGE_PATH, download, async (request, reply) => {
    const image = await store.open(request.log);
    if (!image) throw imageNotPublished();
    const tenantId = request.adminTenantId;
    if (image.format === 1) {
      request.log.info({ tenantId, version: image.version }, 'immagine del player scaricata');
      return reply
        .headers(imageHeaders('application/x-xz', playerImageFileName(image.version, 'xz'), image.bytes))
        .send(image.file.createReadStream({ start: 0, autoClose: true }));
    }
    const { version } = image.manifest;
    request.log.info({ tenantId, version }, 'immagine del player scaricata');
    return reply
      .headers(imageHeaders('application/gzip', playerImageFileName(version, 'gz'), imageBytes(image, image.slotPart)))
      .send(imageStream(image, image.slotPart));
  });

  app.post('/api/admin/displays/:id/image', admin, async (request, reply): Promise<DisplayImageTicket> => {
    const tenantId = adminTenantId(request);
    const userId = request.user?.id;
    if (!userId) throw notFound();
    const { id } = validate(IdParamSchema, request.params);
    const { wifi } = validate(DisplayImageRequestSchema, request.body ?? {});
    const image = await store.open(request.log);
    if (!image || image.format !== 2) {
      if (image) await closeImage(image);
      throw readyNotAvailable();
    }
    try {
      const rotated = await rotateDisplayConfig(ctx, tenantId, id, wifi, (file) => {
        const slot = configSlot(file);
        if (!slot) throw badRequest('La configurazione è troppo lunga per l’immagine: accorcia il nome o il Wi-Fi');
        return slot;
      });
      const slot = rotated.value;
      const { ticket, expiresAt } = tickets.issue({
        tenantId,
        userId,
        displayId: rotated.displayId,
        displayName: rotated.name,
        tokenHash: rotated.tokenHash,
        slot,
      });
      request.log.info(
        { displayId: rotated.displayId, wifi: wifi !== undefined, userId },
        'immagine pronta del player preparata',
      );
      void reply.header('cache-control', 'no-store');
      return {
        ticket,
        expiresAt: expiresAt.toISOString(),
        fileName: playerReadyImageFileName(rotated.name, image.manifest.version),
        size: imageBytes(image, compressSlot(slot)),
      };
    } finally {
      await closeImage(image);
    }
  });

  app.get('/api/admin/displays/image/:ticket', download, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const userId = request.user?.id;
    const { ticket } = validate(DisplayImageTicketParamSchema, request.params);
    const grant = userId ? tickets.take(ticket, tenantId, userId) : null;
    if (!grant) throw ticketNotFound();
    let middle: Buffer;
    try {
      const [row] = await ctx.db
        .select({ revoked: displays.revoked, tokenHash: displays.tokenHash })
        .from(displays)
        .where(tenantScope(displays, tenantId, eq(displays.id, grant.displayId)))
        .limit(1);
      if (!row || row.revoked || row.tokenHash !== grant.tokenHash) throw displayGone();
      middle = compressSlot(grant.slot);
    } finally {
      grant.slot.fill(0);
    }
    const image = await store.open(request.log);
    if (!image || image.format !== 2) {
      if (image) await closeImage(image);
      throw readyNotAvailable();
    }
    const { version } = image.manifest;
    request.log.info({ displayId: grant.displayId, userId, version }, 'immagine pronta del player scaricata');
    return reply
      .headers(
        imageHeaders(
          'application/gzip',
          playerReadyImageFileName(grant.displayName, version),
          imageBytes(image, middle),
        ),
      )
      .send(imageStream(image, middle));
  });
}
