-- Reversibile (si perdono solo le scelte di foto e video per avviso): ALTER TABLE "player_media" DROP COLUMN "events";
ALTER TABLE "player_media" ADD COLUMN "events" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Aspetto di prima («Principale»): il primo video di ogni giocatore vale per ACE!, Muro e Cambio.
UPDATE "player_media" AS pm SET "events" = '["ace","block","substitution"]'::jsonb
FROM (
  SELECT DISTINCT ON (m."player_id") m."player_id", m."asset_id"
  FROM "player_media" AS m JOIN "assets" AS a ON a."id" = m."asset_id"
  WHERE a."mime" IN ('video/mp4', 'video/webm')
  ORDER BY m."player_id", m."position", m."asset_id"
) AS first_file
WHERE pm."player_id" = first_file."player_id" AND pm."asset_id" = first_file."asset_id";--> statement-breakpoint
-- Senza foto principale «Principale» mostrava la prima delle altre foto: la stessa per i tre avvisi.
UPDATE "player_media" AS pm SET "events" = '["ace","block","substitution"]'::jsonb
FROM (
  SELECT DISTINCT ON (m."player_id") m."player_id", m."asset_id"
  FROM "player_media" AS m
  JOIN "assets" AS a ON a."id" = m."asset_id"
  JOIN "players" AS p ON p."id" = m."player_id"
  WHERE a."mime" NOT IN ('video/mp4', 'video/webm') AND p."photo_asset_id" IS NULL
  ORDER BY m."player_id", m."position", m."asset_id"
) AS first_file
WHERE pm."player_id" = first_file."player_id" AND pm."asset_id" = first_file."asset_id";
