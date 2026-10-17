import type { ClubResponse, OurTeam, TenantBranding } from '@sir/shared';
import { BrandingResponseSchema, ClubResponseSchema, UpdateClubProfileRequestSchema } from '@sir/shared';
import { apiRequest } from '../../../lib/api.ts';
import { initBranding } from '../../../lib/branding.ts';

/** What the profile of the club saves (the rest stays as it is): name shown, square logo, «nostra squadra». */
export interface ProfileChange {
  displayName?: string | null;
  logoMark?: string | null;
  ourTeam?: OurTeam;
}

/** `PUT /api/admin/club/profile` with the saved profile and the change; throws when a text is not valid. */
export async function saveProfile(club: ClubResponse, change: ProfileChange): Promise<ClubResponse> {
  const body = UpdateClubProfileRequestSchema.safeParse({
    displayName: 'displayName' in change ? change.displayName : club.displayName,
    logoMark: 'logoMark' in change ? change.logoMark : club.logoMark,
    ourTeam: change.ourTeam ?? club.ourTeam,
    profile: club.profile,
  });
  if (!body.success) throw new TypeError('invalid profile');
  const res = await apiRequest('/api/admin/club/profile', ClubResponseSchema, { method: 'PUT', body: body.data });
  void initBranding({ fresh: true });
  return res;
}

/** `PUT /api/admin/branding` with the whole document; the portal reads its graphics again. */
export async function saveBranding(branding: TenantBranding): Promise<TenantBranding> {
  const res = await apiRequest('/api/admin/branding', BrandingResponseSchema, { method: 'PUT', body: branding });
  void initBranding({ fresh: true });
  return res.branding;
}
