import { INVITE_TTL_HOURS, RESET_TTL_HOURS } from '@arenalive/shared';

/** Text and HTML of a mail (the HTML is minimal; the text is what a mail program without HTML shows). */
export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

/** The client a mail is about: its name and, if it has one, the absolute address of its logo. */
export interface MailBrand {
  name: string;
  logoUrl: string | null;
}

/** Pure: text safe inside HTML (the names and addresses of users and clients are never HTML). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface Layout {
  brand: MailBrand;
  heading: string;
  paragraphs: string[];
  action: { label: string; url: string } | null;
  footer: string;
}

function render(subject: string, l: Layout): MailContent {
  const text = [
    l.heading,
    '',
    ...l.paragraphs.flatMap((p) => [p, '']),
    ...(l.action ? [`${l.action.label}:`, l.action.url, ''] : []),
    l.footer,
  ].join('\n');
  const logo =
    l.brand.logoUrl && /^https?:\/\//.test(l.brand.logoUrl)
      ? `<p><img src="${escapeHtml(l.brand.logoUrl)}" alt="${escapeHtml(l.brand.name)}" style="max-height:48px"></p>`
      : '';
  const button = l.action
    ? `<p><a href="${escapeHtml(l.action.url)}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(l.action.label)}</a></p>` +
      `<p style="font-size:13px;color:#555555">Se il pulsante non funziona, copia questo indirizzo nel browser:<br>${escapeHtml(l.action.url)}</p>`
    : '';
  const html =
    `<!doctype html><html lang="it"><body style="font-family:Arial,Helvetica,sans-serif;color:#111111;line-height:1.5">` +
    logo +
    `<h1 style="font-size:20px">${escapeHtml(l.heading)}</h1>` +
    l.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('') +
    button +
    `<p style="font-size:13px;color:#555555">${escapeHtml(l.footer)}</p>` +
    `</body></html>`;
  return { subject, text, html };
}

/** Invitation of a new user: the link leads to the page where it chooses its first password. */
export function inviteMail(brand: MailBrand, link: string): MailContent {
  return render(`Sei stato invitato su ${brand.name}`, {
    brand,
    heading: `Sei stato invitato su ${brand.name}`,
    paragraphs: [
      `Ti è stato creato un accesso all’area riservata di ${brand.name}.`,
      'Scegli la tua password per entrare: il link serve una volta sola.',
    ],
    action: { label: 'Scegli la password', url: link },
    footer: `Il link vale ${INVITE_TTL_HOURS} ore. Se non te lo aspettavi, ignora questa mail.`,
  });
}

/** Link to choose a new password. */
export function resetMail(brand: MailBrand, link: string): MailContent {
  return render(`Nuova password per ${brand.name}`, {
    brand,
    heading: 'Nuova password',
    paragraphs: [
      `Hai chiesto di reimpostare la password di accesso a ${brand.name}.`,
      'Usa il link qui sotto per sceglierne una nuova: serve una volta sola.',
    ],
    action: { label: 'Scegli la nuova password', url: link },
    footer: `Il link vale ${RESET_TTL_HOURS} ${RESET_TTL_HOURS === 1 ? 'ora' : 'ore'}. Se non l’hai chiesto tu, ignora questa mail: la tua password non cambia.`,
  });
}

/** Test message of the «Posta» page. */
export function testMail(): MailContent {
  return render('Prova di invio da ArenaLive', {
    brand: { name: 'ArenaLive', logoUrl: null },
    heading: 'Prova di invio',
    paragraphs: ['Se leggi questa mail, il server di posta di ArenaLive è configurato correttamente.'],
    action: null,
    footer: 'Messaggio automatico: non serve rispondere.',
  });
}
