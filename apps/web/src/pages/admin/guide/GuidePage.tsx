import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Empty } from '../../../components/ui.tsx';
import { menuGroups } from '../AdminSidebar.tsx';
import type { MenuGroup } from '../AdminSidebar.tsx';
import { useAuth } from '../auth.tsx';
import { inputClass } from '../forms.tsx';
import type { GuideBlock, GuideLink, GuideSection } from './content.ts';
import { filterSections, GUIDE_SECTIONS, READ_ONLY_NOTE } from './content.ts';

/** Pure: a link of the guide is shown only if the user has that page in its menu (a page of the menu or one under it). */
export function canOpen(to: string, groups: readonly MenuGroup[]): boolean {
  return groups.some((g) => g.items.some((i) => to === i.to || to.startsWith(`${i.to}/`)));
}

function Block({ block }: { block: GuideBlock }) {
  if (block.kind === 'text') return <p className="text-sm leading-relaxed text-text">{block.text}</p>;
  if (block.kind === 'steps')
    return (
      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-text marker:font-semibold marker:text-muted">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    );
  if (block.kind === 'list')
    return (
      <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-text marker:text-muted">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  return (
    <p className="rounded-card border border-border bg-surface-2 px-3 py-2 text-sm leading-relaxed text-text">
      <span className="font-semibold">Nota. </span>
      {block.text}
    </p>
  );
}

function Section({ section, viewer, links }: { section: GuideSection; viewer: boolean; links: readonly GuideLink[] }) {
  const headingId = `${section.id}-titolo`;
  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className="sir-surface scroll-mt-20 space-y-3 rounded-panel border border-border p-4 shadow-card sm:p-5"
    >
      <h2 id={headingId} className="text-lg font-semibold text-text">
        {section.title}
      </h2>
      {section.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
      {viewer && section.needsWrite && <Block block={{ kind: 'note', text: READ_ONLY_NOTE }} />}
      {links.length > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((l) => (
            <Link key={l.to + l.label} to={l.to} className="font-medium text-primary underline">
              {l.label}
            </Link>
          ))}
        </p>
      )}
    </section>
  );
}

/**
 * «Guida»: how to set up and use the portal, in plain words (content in `content.ts`). Index of the sections on the
 * side (on top on a phone), a search by word and links to the pages of the area. A user «Sola lettura» reads all of it,
 * with a note on what only «Lettura e scrittura» can do; the superadmin has one more section.
 */
export function GuidePage() {
  const { user, isAdmin, isSuperadmin } = useAuth();
  const [query, setQuery] = useState('');
  const searchId = useId();
  const groups = useMemo(
    () => menuGroups({ isAdmin, isSuperadmin, inTenant: user.tenant !== null }),
    [isAdmin, isSuperadmin, user.tenant],
  );
  const sections = useMemo(() => filterSections(GUIDE_SECTIONS, query, isSuperadmin), [query, isSuperadmin]);
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text">Guida</h1>
        <p className="text-sm text-muted">Come preparare e usare il portale, passo per passo.</p>
      </header>
      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="mb-4 space-y-3 lg:sticky lg:top-[calc(var(--sir-admin-bar,0px)+1rem)] lg:mb-0">
          <div>
            <label htmlFor={searchId} className="mb-1 block text-sm font-medium text-text">
              Cerca nella guida
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Per esempio: QR, password, data"
              className={inputClass}
            />
          </div>
          <nav aria-label="Indice della guida">
            <ol className="space-y-0.5 text-sm">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="block rounded-button px-2 py-1.5 text-muted hover:bg-hover hover:text-text"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
        <div className="min-w-0 space-y-4">
          {sections.length === 0 ? (
            <Empty>Nessun risultato per «{query.trim()}». Prova con un’altra parola.</Empty>
          ) : (
            sections.map((s) => (
              <Section
                key={s.id}
                section={s}
                viewer={!isAdmin}
                links={(s.links ?? []).filter((l) => canOpen(l.to, groups))}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
