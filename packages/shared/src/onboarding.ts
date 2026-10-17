import { z } from 'zod';

/**
 * Guided first setup of a client: shown by itself to the first admin («Lettura e scrittura») who enters a client not
 * configured yet. The flag is in the database (`tenants.onboarded_at`), not in the browser.
 */
export const OnboardingStatusSchema = z.object({
  /** The setup was finished (or the client was already configured); the portal no longer opens it by itself. */
  completed: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
});
export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;
