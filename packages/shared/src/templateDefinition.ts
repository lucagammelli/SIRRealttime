import { z } from 'zod';

/** `#rrggbb`, lower case (the same pattern as `HexColorSchema` of colors.ts, which depends on this module). */
const HexSchema = z.string().regex(/^#[0-9a-f]{6}$/, { message: 'colore non valido (#rrggbb)' });
const PublicPathSchema = z.string().regex(/^\/[A-Za-z0-9._/-]+$/, { message: 'percorso non valido' });
const TextSchema = z.string().trim().min(1).max(200);

/** Colour of the client that the team of the client («nostra squadra») takes when it is on court. */
export const OurTeamColorSchema = z.enum(['home', 'accent']);
export type OurTeamColor = z.infer<typeof OurTeamColorSchema>;

/** CSS custom property (`--sir-…`) or property name written by a theme document. */
const CssNameSchema = z.string().regex(/^(--[a-z][a-z0-9-]*|[a-z][a-z0-9-]*)$/);
/** CSS value of a theme document: no way out of the declaration (no `;`, braces, comments, `@`, `url(`). */
const CssValueSchema = z
  .string()
  .min(1)
  .max(300)
  .refine((v) => !/[{};@<>\\]|\/\*|url\(|image-set\(|expression\(/i.test(v), { message: 'valore CSS non ammesso' });
const CssDeclarationsSchema = z.record(CssNameSchema, CssValueSchema);

/**
 * Look of a custom theme as CSS, written under `[data-template='<id>']` by `themeCss` (generated into
 * apps/web/src/styles/themes.generated.css): the tokens (`vars`), those that change on smaller screens (`media`), those
 * of the big screen (`tvVars`) and rules on the hook classes of the components (`&` is the template scope).
 */
export const ThemeCssSchema = z.strictObject({
  vars: z.record(z.string().regex(/^--sir-[a-z0-9-]+$/), CssValueSchema),
  media: z
    .array(
      z.strictObject({
        query: z.string().regex(/^\([a-z0-9: -]+\)( and \([a-z0-9: -]+\))*$/),
        vars: z.record(z.string().regex(/^--sir-[a-z0-9-]+$/), CssValueSchema),
      }),
    )
    .default([]),
  tvVars: z.record(z.string().regex(/^--sir-[a-z0-9-]+$/), CssValueSchema).default({}),
  rules: z
    .array(
      z.strictObject({
        selectors: z.array(z.string().regex(/^(\[data-sir-scope\])?&( [a-z0-9.\-[\]='"]+)?$/)).min(1),
        declarations: CssDeclarationsSchema,
      }),
    )
    .default([]),
});
export type ThemeCss = z.output<typeof ThemeCssSchema>;

/** A block of a default page (validated again by `DeviceBlocksSchema` of layout.ts, which owns the block types). */
const BlockSketchSchema = z.looseObject({ id: z.string().min(1).max(64), type: z.string().min(1).max(32) });

/**
 * Definition of a graphic template: the one document that describes a look (a built-in model or a custom theme of a
 * client, see `themes/*.json`). The CSS tokens that draw it stay in apps/web/src/styles/tokens.css under
 * `[data-template='<id>']`; a test of the portal checks that they match `colors` and the dark surfaces.
 */
export const TemplateDefinitionSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  /**
   * Custom theme of one client: not offered by the guided setup nor by the template list of the clients; only a
   * superadmin assigns it, and a client that has it keeps it.
   */
  custom: z.boolean().default(false),
  /** Name in the selector of «Grafica». */
  label: TextSchema,
  /** One line under the name. */
  description: TextSchema,
  /** Theme imposed by the template (no light/dark switch); null: the choice of the viewer. */
  forcedTheme: z.enum(['dark', 'light']).nullable(),
  /** Colour of our team: the colour of the home team (standard) or the accent of the client. */
  ourColor: OurTeamColorSchema,
  /**
   * Colours of the template where the client has chosen none (the same values as tokens.css, checked by a test of the
   * portal): shown by the colour fields of «Grafica».
   */
  colors: z.strictObject({
    primary: HexSchema,
    accent: HexSchema,
    home: HexSchema,
    away: HexSchema,
    background: HexSchema,
  }),
  /** Surface and background of the dark theme in tokens.css (the dark variants of the client colours use them). */
  darkSurface: HexSchema,
  /** Lightest dark panel with coloured small text on it (table header and rows): the `-ink` colours have 4.5:1 on it. */
  darkInkSurface: HexSchema,
  darkBackground: HexSchema,
  /** Font of the template, informative (the @font-face and the token are in the portal); null: the portal fonts. */
  fonts: z.strictObject({ sans: TextSchema.nullable() }).default({ sans: null }),
  /** Images of the template (files of apps/web/public), null: none; the alternative text goes with the logo. */
  images: z.strictObject({
    navbarLogo: PublicPathSchema.nullable(),
    navbarLogoAlt: TextSchema.nullable().default(null),
  }),
  /**
   * Arrows of the court maps: `evaluation` coloured by the evaluation and as thick as their share; `team` thin (1.5 px),
   * in the colour of the attacking team, 85% opaque, with a small head.
   */
  courtArrows: z.enum(['evaluation', 'team']),
  /** Scoreboard: the one of the portal or the one of the specification mockup (status line, partials in pills). */
  scoreboard: z.enum(['standard', 'mockup']).default('standard'),
  /** Smallest heights (rem) of the blocks on the big screen, by block type, where they differ from the portal. */
  tvMinRem: z.record(z.string(), z.number().positive().max(100)).optional(),
  /** Tokens and rules of the look, for a custom theme (the built-in models have theirs in tokens.css). */
  css: ThemeCssSchema.optional(),
  /** Default page of the template for every device (missing: the portal default). */
  layout: z
    .strictObject({
      tv: z.array(BlockSketchSchema),
      tablet: z.array(BlockSketchSchema),
      phone: z.array(BlockSketchSchema),
    })
    .optional(),
});
export type TemplateDocument = z.output<typeof TemplateDefinitionSchema>;
export type TemplateDocumentInput = z.input<typeof TemplateDefinitionSchema>;

/** Pure: a custom theme document (e.g. `themes/*.json`) read and validated; throws a ZodError when it is wrong. */
export function parseCustomTheme(document: unknown): TemplateDocument {
  const theme = TemplateDefinitionSchema.parse(document);
  if (!theme.custom) throw new Error(`il tema ${theme.id} non è personalizzato (custom: true)`);
  return theme;
}
