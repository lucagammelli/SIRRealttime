import type { AgentDownloadInfo, AgentRelease, TenantBranding } from '@sir/shared';
import {
  AGENT_LOGO_FILES,
  AGENT_LOGO_MAX_BYTES,
  AGENT_LOGO_MAX_SIDE,
  AGENT_ZIP_FOLDER,
  agentBranding,
  agentDownloadConfig,
  agentDownloadFileName,
  resolveBranding,
} from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { AgentReleaseStore } from '../agentRelease.js';
import { readAssetFile } from '../assetStore.js';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { assets } from '../db/index.js';
import { HttpError, notFound } from '../lib/errors.js';
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
    'SIRRealtime - Agente per Windows',
    '',
    `Cliente:  ${o.name}`,
    `Server:   ${o.serverUrl}`,
    `Versione: ${o.release.version}`,
    '',
    'INSTALLAZIONE',
    '1. Scompatta la cartella in C:\\SIRAgent: sir-agent.exe, config.json, branding.json e il logo',
    '   devono restare insieme. Non avviare l’agente dalla pennina di DataVolley.',
    '2. Fai doppio clic su sir-agent.exe.',
    '   L’eseguibile non è firmato: se Windows mostra «Windows ha protetto il PC» (SmartScreen),',
    '   premi «Ulteriori informazioni» e poi «Esegui comunque».',
    '3. Nella finestra scrivi il nome dell’agente (es. il nome del PC o della palestra) e premi «Registra».',
    '4. Nel portale, area riservata, pagina «Agenti», riquadro «Richieste in attesa»: controlla che il',
    '   codice sia quello mostrato sul PC e premi «Abilita». L’agente riceve il suo token da solo.',
    '5. Con «Sfoglia…» scegli la pennina (o il file .dvw) di DataVolley e premi START.',
    '',
    'Dati e log dell’agente: C:\\SIRAgent\\data e C:\\SIRAgent\\logs (in config.json).',
    `Controllo dell’eseguibile, sha256 di sir-agent.exe: ${o.release.sha256}`,
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
        { name: `${AGENT_ZIP_FOLDER}/sir-agent.exe`, file, size: opened.bytes, crc32: opened.crc32 },
        { name: `${AGENT_ZIP_FOLDER}/config.json`, data: json(agentDownloadConfig(serverUrl)) },
        { name: `${AGENT_ZIP_FOLDER}/branding.json`, data: json(agentBranding(name, branding.colors)) },
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
