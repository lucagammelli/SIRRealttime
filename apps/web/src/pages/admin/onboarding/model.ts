import type { ClubResponse, MeResponse, TenantBranding, TenantIntermissions, TenantOverlays } from '@sir/shared';
import { defaultBranding, defaultIntermissions, defaultOverlays } from '@sir/shared';
import { sameValue } from '../studio/model.ts';

/** The five steps of the guided first setup, in order. */
export const ONBOARDING_STEPS = [
  { id: 'logo', title: 'Il logo', lead: 'Il logo della società compare nelle pagine pubbliche, nell’app e nei QR.' },
  { id: 'squadra', title: 'La squadra', lead: 'In che serie gioca il club: il calendario arriva dal sito della Lega.' },
  { id: 'colori', title: 'I colori', lead: 'Scegli un modello e, se vuoi, i colori della società.' },
  { id: 'grafica', title: 'La grafica', lead: 'Un modello pronto per le pause e gli avvisi durante la partita.' },
  { id: 'fatto', title: 'Fatto', lead: 'Ecco il riepilogo e i prossimi passi.' },
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]['id'];

export const stepIndex = (step: OnboardingStep): number => ONBOARDING_STEPS.findIndex((s) => s.id === step);

/** What the client has already saved, to resume the procedure from the right step. */
export interface OnboardingProgress {
  club: Pick<ClubResponse, 'logoMark' | 'displayName' | 'ourTeam' | 'profile' | 'leagues'>;
  branding: TenantBranding;
  intermissions: TenantIntermissions;
  overlays: TenantOverlays;
}

/** Pure: whether the client has chosen its squad (a team of a championship, or a name written by hand). */
export function hasSquad(club: OnboardingProgress['club']): boolean {
  return (
    club.leagues.some((l) => l.team !== null) ||
    club.displayName !== null ||
    club.ourTeam.name !== null ||
    club.ourTeam.code !== null
  );
}

/** Pure: the first step with nothing saved yet (`fatto` when the four are done): where «Riprendi» goes. */
export function resumeStep(p: OnboardingProgress): OnboardingStep {
  if (p.club.logoMark === null && p.branding.logoMain === null) return 'logo';
  if (!hasSquad(p.club)) return 'squadra';
  const plain = defaultBranding();
  if (sameValue(p.branding.colors, plain.colors) && p.branding.template === plain.template) return 'colori';
  if (sameValue(p.intermissions, defaultIntermissions()) && sameValue(p.overlays, defaultOverlays())) return 'grafica';
  return 'fatto';
}

/** Pure: the later of two steps (the step reached in this session and the one the saved data tell). */
export const laterStep = (a: OnboardingStep, b: OnboardingStep): OnboardingStep =>
  stepIndex(a) >= stepIndex(b) ? a : b;

/**
 * Pure: whether the procedure opens by itself. Only for an admin («Lettura e scrittura») of a client not configured
 * yet, once per session when skipped; never for a viewer, never for the superadmin (not even inside a client).
 */
export function opensByItself(input: { role: MeResponse['role']; completed: boolean; skipped: boolean }): boolean {
  return input.role === 'admin' && !input.completed && !input.skipped;
}

/**
 * Pure: the notice «Configurazione da completare» above the pages: a button «Riprendi» for the admin, a link for the
 * superadmin inside the client, nothing for a viewer or when the setup is done.
 */
export function noticeFor(input: { role: MeResponse['role']; completed: boolean }): 'resume' | 'link' | null {
  if (input.completed) return null;
  if (input.role === 'admin') return 'resume';
  if (input.role === 'superadmin') return 'link';
  return null;
}

/** Key of sessionStorage: the procedure was skipped in this session (it does not open by itself again until the next login). */
export const skippedKey = (tenantId: string): string => `sir-configurazione-saltata:${tenantId}`;
/** Key of sessionStorage: the last step reached, for «Riprendi». */
export const reachedKey = (tenantId: string): string => `sir-configurazione-passo:${tenantId}`;

export function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Private mode: the procedure may open again, nothing else.
  }
}

/** Pure: the branding with the fields the profile of the club owns (name, square logo, «nostra squadra») from the club. */
export function brandingWithClub(branding: TenantBranding, club: ClubResponse): TenantBranding {
  return { ...branding, displayName: club.displayName, logoMark: club.logoMark, ourTeam: club.ourTeam };
}
