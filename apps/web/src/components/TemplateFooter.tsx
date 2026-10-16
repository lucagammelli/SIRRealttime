import { useTemplate } from '../lib/branding.ts';

/**
 * Footer of a template with a credit («Powered by Istante®» in «SIR VOLLEY»): right aligned on the desktop, centred
 * on the phone, never in the navbar. Nothing for a template without it.
 */
export function TemplateFooter({ className = '' }: { className?: string }) {
  const template = useTemplate();
  const { footerLogo } = template.images;
  if (!footerLogo || !template.footerText) return null;
  return (
    <footer className={`sir-footer flex justify-center px-3 pb-3 md:justify-end ${className}`}>
      <img
        src={footerLogo}
        alt={template.footerText}
        className="sir-footer-logo h-4 w-auto max-w-full object-contain"
      />
    </footer>
  );
}
