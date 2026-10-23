import type {
  AssetListResponse,
  AssetSummary,
  BrandColorKey,
  BrandingImageSlot,
  ContrastIssue,
  OurTeam,
  TemplateId,
  TenantBranding,
} from '@arenalive/shared';
import {
  BRAND_COLOR_KEYS,
  BRANDING_IMAGE_SLOTS,
  brandContrastIssues,
  defaultBranding,
  HEX_COLOR_PATTERN,
  isVideoMime,
  MIN_TEXT_CONTRAST,
  OUR_TEAM_CODE_MAX,
  OUR_TEAM_NAME_MAX,
  adminAssetPath,
  TEMPLATES,
  templateChoices,
  templateOf,
} from '@arenalive/shared';
import type { ChangeEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../../components/ui.tsx';
import { useAuth } from '../auth.tsx';
import { Field, inputClass } from '../forms.tsx';
import { assetOptionText } from '../imageUpload.ts';
import type { StudioTarget } from './model.ts';
import { ALL_DEVICES_TEXT, COLOR_LABELS, IMAGE_LABELS } from './model.ts';
import { Advanced, Setting, SettingsCard, TabList } from './StudioUi.tsx';

export type ColorsTab = 'colori' | 'loghi' | 'squadra';
export const COLORS_TABS: readonly { value: ColorsTab; label: string }[] = [
  { value: 'colori', label: 'Colori' },
  { value: 'loghi', label: 'Loghi e nome' },
  { value: 'squadra', label: 'Squadra' },
];

const SLOTS = Object.keys(BRANDING_IMAGE_SLOTS) as BrandingImageSlot[];

const ratio = (r: number): string => r.toLocaleString('it-IT', { maximumFractionDigits: 1 });

/** Pure: Italian text of a contrast warning. */
export function contrastText(issue: ContrastIssue): string {
  const min = ratio(MIN_TEXT_CONTRAST);
  if (issue.color === 'text')
    return `Lo sfondo è troppo scuro per il testo della pagina (contrasto ${ratio(issue.ratio)}:1, minimo ${min}:1).`;
  return `«${COLOR_LABELS[issue.color].label}» ha contrasto ${ratio(issue.ratio)}:1 sullo sfondo (minimo ${min}:1): i testi in questo colore si leggono male.`;
}

/** Pure: the team of the client with a typed field: trimmed, empty as null. */
export function withOurTeamField(team: OurTeam, field: keyof OurTeam, text: string): OurTeam {
  const trimmed = text.trim();
  return { ...team, [field]: trimmed === '' ? null : text };
}

/** Pure: the branding with one colour chosen (undefined: back to the colour of the template). */
export function withColor(branding: TenantBranding, key: BrandColorKey, value: string | undefined): TenantBranding {
  const colors = { ...branding.colors };
  if (value === undefined) delete colors[key];
  else colors[key] = value;
  return { ...branding, colors };
}

/** Elements of the preview of every colour (the page, the blocks with the team colours). */
const TEAM_BLOCKS: readonly StudioTarget[] = ['type:scoreboard', 'type:comparison', 'type:momentum', 'type:teamDuel'];
export const COLOR_TARGETS: Record<BrandColorKey, readonly StudioTarget[]> = {
  primary: ['page'],
  accent: ['page'],
  home: TEAM_BLOCKS,
  away: TEAM_BLOCKS,
  background: ['page'],
};
const COLOR_WHERE: Record<BrandColorKey, string> = {
  primary: `${ALL_DEVICES_TEXT}, in ogni scena (pulsanti, indicatori dei gruppi)`,
  accent: `${ALL_DEVICES_TEXT}, in ogni scena (barra in alto, titoli delle pause)`,
  home: `${ALL_DEVICES_TEXT}, nel tabellone, nei grafici e nelle statistiche`,
  away: `${ALL_DEVICES_TEXT}, nel tabellone, nei grafici e nelle statistiche`,
  background: `${ALL_DEVICES_TEXT}, sotto a tutti i blocchi`,
};

/** Colour picker and hexadecimal field of one colour; empty: the colour of the template. */
export function ColorField({
  name,
  value,
  fallback,
  onChange,
}: {
  name: BrandColorKey;
  value: string | undefined;
  /** Colour of the template when none is chosen. */
  fallback: string;
  onChange: (value: string | undefined) => void;
}) {
  const shown = value ?? fallback;
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const { label, hint } = COLOR_LABELS[name];
  const typed = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.value.trim().toLowerCase();
    setText(e.target.value);
    if (HEX_COLOR_PATTERN.test(next)) onChange(next);
  };
  const invalid = !HEX_COLOR_PATTERN.test(text.trim().toLowerCase());
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: selettore`}
          value={shown}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-9 w-12 cursor-pointer rounded-card border border-border bg-surface-2"
        />
        <label className="min-w-0 flex-1 space-y-1">
          <span className="text-sm font-medium text-text">{label}</span>
          <input
            type="text"
            value={text}
            onChange={typed}
            spellCheck={false}
            maxLength={7}
            aria-invalid={invalid}
            className={`${inputClass} font-mono`}
          />
        </label>
        {value !== undefined && (
          <Button variant="ghost" onClick={() => onChange(undefined)}>
            Predefinito
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">
        {invalid ? 'Scrivi il colore come #rrggbb (es. #1d4ed8).' : hint}
        {value === undefined && !invalid && ' Ora: colore del modello.'}
      </p>
    </div>
  );
}

/** Choice of the graphic template (closed list of @arenalive/shared): name, description and colours of each one. */
export function TemplatePicker({
  value,
  current = value,
  superadmin = false,
  onChange,
}: {
  value: TemplateId;
  /** Template saved for the client: a custom theme it already has stays in the list. */
  current?: TemplateId;
  /** The superadmin also sees (and assigns) the custom themes; the clients never. */
  superadmin?: boolean;
  onChange: (value: TemplateId) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-text">Modello grafico</legend>
      <div role="radiogroup" aria-label="Modello grafico" className="grid gap-2">
        {templateChoices({ current, superadmin }).map((id) => {
          const t = TEMPLATES[id];
          const active = id === value;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(id)}
              className={`flex min-h-11 flex-col items-start gap-1 rounded-card border px-3 py-2 text-left ${
                active ? 'border-primary bg-surface-2' : 'border-border bg-surface hover:bg-hover'
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold text-text">
                {t.label}
                <span aria-hidden="true" className="flex gap-1">
                  {[t.colors.background, t.colors.primary, t.colors.home, t.colors.away].map((c, i) => (
                    <span
                      // Swatches of the template: colours of the contract, the same as tokens.css (a test checks them).
                      key={`${c}-${i}`}
                      className="inline-block size-3.5 rounded-full border border-border"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
              </span>
              <span className="text-xs text-muted">{t.description}</span>
            </button>
          );
        })}
      </div>
      {templateOf(value).forcedTheme !== null && (
        <p className="text-xs text-muted">
          Questo modello usa sempre il tema {templateOf(value).forcedTheme === 'dark' ? 'scuro' : 'chiaro'}: il pulsante
          chiaro/scuro non compare.
        </p>
      )}
    </fieldset>
  );
}

/** Code and name of the team of the client in the `.dvw` files («nostra squadra»). */
export function OurTeamFields({ value, onChange }: { value: OurTeam; onChange: (value: OurTeam) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-text">Nostra squadra</legend>
      <p className="text-xs text-muted">
        Riconosce la squadra del cliente nel file della partita, con il codice della squadra e/o un testo contenuto nel
        nome (senza distinguere maiuscole e accenti). Quando è in campo prende sempre il colore della nostra squadra e
        l’avversaria il colore dell’avversario, in casa o in trasferta; se nessuna squadra corrisponde valgono i colori
        di casa e ospite.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Codice squadra" hint="Facoltativo, es. PER.">
          <input
            type="text"
            value={value.code ?? ''}
            maxLength={OUR_TEAM_CODE_MAX}
            spellCheck={false}
            onChange={(e) => onChange(withOurTeamField(value, 'code', e.target.value))}
            className={`${inputClass} font-mono uppercase`}
          />
        </Field>
        <Field label="Testo nel nome della squadra" hint="Facoltativo, es. Perugia.">
          <input
            type="text"
            value={value.name ?? ''}
            maxLength={OUR_TEAM_NAME_MAX}
            onChange={(e) => onChange(withOurTeamField(value, 'name', e.target.value))}
            className={inputClass}
          />
        </Field>
      </div>
    </fieldset>
  );
}

/** Link to the library, the only place where files are uploaded (the pages choose from it). */
export function LibraryLink({ className = '' }: { className?: string }) {
  return (
    <Link to="/admin/media" className={`text-sm font-medium text-primary underline ${className}`}>
      Carica nella libreria
    </Link>
  );
}

/**
 * One image of the branding: preview, the choice among the files of the library of the right kind, removal from the
 * branding (the file stays in the library). New files are uploaded in «Immagini e video».
 */
export function ImageField({
  slot,
  asset,
  assetId,
  assets,
  onChoose,
  onClear,
}: {
  slot: BrandingImageSlot;
  asset: AssetSummary | undefined;
  assetId: string | null;
  /** The files of the library (the ones of the kind of the slot are offered). */
  assets: readonly AssetSummary[];
  onChoose: (slot: BrandingImageSlot, assetId: string) => void;
  onClear: (slot: BrandingImageSlot) => void;
}) {
  const { label, hint } = IMAGE_LABELS[slot];
  const notSquare = slot === 'logoMark' && asset !== undefined && asset.width !== asset.height;
  const files = assets.filter((a) => a.kind === BRANDING_IMAGE_SLOTS[slot] && !isVideoMime(a.mime));
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-text">{label}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-14 w-28 items-center justify-center rounded-card border border-dashed border-border bg-surface-2 p-1">
          {assetId ? (
            <img src={adminAssetPath(assetId)} alt={label} className="max-h-12 w-auto max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted">Nessuna immagine</span>
          )}
        </div>
        <select
          className={inputClass}
          aria-label={`Scegli dalla libreria: ${label.toLowerCase()}`}
          value={assetId ?? ''}
          onChange={(e) => {
            if (e.target.value) onChoose(slot, e.target.value);
          }}
        >
          <option value="">{files.length === 0 ? 'Nessun file nella libreria' : 'Scegli dalla libreria…'}</option>
          {files.map((a) => (
            <option key={a.id} value={a.id}>
              {assetOptionText(a)}
            </option>
          ))}
        </select>
        {assetId && (
          <Button variant="ghost" onClick={() => onClear(slot)}>
            Togli
          </Button>
        )}
        <LibraryLink />
      </div>
      <p className="text-xs text-muted">
        {hint}
        {asset && ` ${asset.width}×${asset.height} px.`}
      </p>
      {notSquare && <p className="text-xs text-warn">L’immagine non è quadrata: verrà adattata.</p>}
    </div>
  );
}

/**
 * Section «Colori e loghi» (the old page «Grafica»): template, colours and their contrast, logos and display name,
 * the team of the client, the images uploaded with the space used.
 */
export function ColorsSection({
  tenantName,
  draft,
  base,
  onChange,
  assets,
  tab,
  onTab,
  onTemplate,
}: {
  tenantName: string;
  draft: TenantBranding;
  /** Saved branding (the template a client already has stays available). */
  base: TenantBranding;
  onChange: (change: (branding: TenantBranding) => TenantBranding) => void;
  assets: AssetListResponse;
  tab: ColorsTab;
  onTab: (tab: ColorsTab) => void;
  /** Choice of another template (the Studio then asks whether the page takes its blocks); missing: only the draft. */
  onTemplate?: (template: TemplateId) => void;
}) {
  const { isSuperadmin } = useAuth();
  const issues = useMemo(() => brandContrastIssues(draft.colors, draft.template), [draft.colors, draft.template]);
  const template = templateOf(draft.template);
  const byId = useMemo(() => new Map(assets.assets.map((a) => [a.id, a])), [assets]);

  const panelId = 'pannello-colori';
  return (
    <div className="space-y-3">
      <TabList
        label="Colori e loghi"
        tabs={COLORS_TABS}
        value={tab}
        onChange={onTab}
        idPrefix="scheda-colori"
        panelId={panelId}
      />
      <div id={panelId} role="tabpanel" aria-labelledby={`scheda-colori-${tab}`} className="space-y-3">
        {tab === 'colori' && (
          <>
            <SettingsCard title="Colori">
              <p className="text-xs text-muted">
                I colori scelti qui vanno sopra quelli del modello; vuoti: i colori del modello.{' '}
                {template.ourColor === 'accent'
                  ? 'Nostra squadra: il colore di risalto; avversaria: il colore della squadra ospite.'
                  : 'Nostra squadra: il colore della squadra di casa; avversaria: il colore della squadra ospite.'}
              </p>
              {BRAND_COLOR_KEYS.map((key) => (
                <Setting
                  key={key}
                  id={`color-${key}`}
                  where={COLOR_WHERE[key]}
                  scene={null}
                  targets={COLOR_TARGETS[key]}
                >
                  <ColorField
                    name={key}
                    value={draft.colors[key]}
                    fallback={template.colors[key]}
                    onChange={(v) => onChange((d) => withColor(d, key, v))}
                  />
                </Setting>
              ))}
              {issues.length > 0 && (
                <ul role="status" className="space-y-1 rounded-card border border-warn bg-surface-2 px-3 py-2 text-sm">
                  {issues.map((issue) => (
                    <li key={issue.color} className="text-text">
                      {contrastText(issue)}
                    </li>
                  ))}
                </ul>
              )}
            </SettingsCard>
            <Advanced>
              <Setting
                id="template"
                where={`${ALL_DEVICES_TEXT}, in ogni scena: colori di base, caratteri, loghi e pagina predefinita`}
                scene={null}
                targets={['page']}
              >
                <TemplatePicker
                  value={draft.template}
                  current={base.template}
                  superadmin={isSuperadmin}
                  onChange={(t) => (onTemplate ? onTemplate(t) : onChange((d) => ({ ...d, template: t })))}
                />
              </Setting>
              <div className="pt-2">
                <Button onClick={() => onChange(() => defaultBranding())}>Ripristina predefiniti</Button>
                <p className="pt-1 text-xs text-muted">
                  Colori, modello, nome, nostra squadra e loghi tornano quelli del portale (le immagini restano
                  caricate).
                </p>
              </div>
            </Advanced>
          </>
        )}
        {tab === 'loghi' && (
          <SettingsCard title="Logo e nome">
            <Setting
              id="displayName"
              where="titolo della scheda del browser e testata senza logo"
              scene={null}
              targets={['page']}
            >
              <Field label="Nome visualizzato" hint="Facoltativo: titolo delle pagine e testata senza logo.">
                <input
                  type="text"
                  value={draft.displayName ?? ''}
                  maxLength={100}
                  placeholder={tenantName}
                  onChange={(e) =>
                    onChange((d) => ({ ...d, displayName: e.target.value.trim() ? e.target.value : null }))
                  }
                  className={inputClass}
                />
              </Field>
            </Setting>
            {SLOTS.map((slot) => (
              <Setting
                key={slot}
                id={`image-${slot}`}
                where={
                  slot === 'logoMain'
                    ? 'testata della pagina pubblica e tabellone della TV'
                    : slot === 'logoMark'
                      ? 'icona del browser e blocco «Logo» quadrato'
                      : 'diapositive «Sponsor» delle pause senza immagini scelte'
                }
                scene={slot === 'sponsorLogo' ? 'setBreak' : 'play'}
                targets={
                  slot === 'logoMain'
                    ? ['type:scoreboard', 'type:logo']
                    : slot === 'logoMark'
                      ? ['type:logo']
                      : ['pause']
                }
              >
                <ImageField
                  slot={slot}
                  assetId={draft[slot]}
                  asset={draft[slot] ? byId.get(draft[slot]) : undefined}
                  assets={assets.assets}
                  onChoose={(s, id) => onChange((d) => ({ ...d, [s]: id }))}
                  onClear={(s) => onChange((d) => ({ ...d, [s]: null }))}
                />
              </Setting>
            ))}
          </SettingsCard>
        )}
        {tab === 'squadra' && (
          <SettingsCard title="Squadra">
            <Setting
              id="ourTeam"
              where={`${ALL_DEVICES_TEXT}: tabellone, grafici, statistiche, pause e avvisi della partita`}
              scene={null}
              targets={TEAM_BLOCKS}
            >
              <OurTeamFields value={draft.ourTeam} onChange={(t) => onChange((d) => ({ ...d, ourTeam: t }))} />
            </Setting>
          </SettingsCard>
        )}
      </div>
    </div>
  );
}
