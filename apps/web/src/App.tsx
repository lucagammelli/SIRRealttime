import { hasSystemLogo } from '@arenalive/shared';
import { Route, Routes } from 'react-router';
import { PRODUCT_NAME, ProductLogo } from './components/ProductLogo.tsx';
import { StatusScreen } from './components/StatusScreen.tsx';
import { SYSTEM_LOGO_FULL_SIZE, SystemLogo } from './components/SystemLogo.tsx';
import { useSystemLogos } from './lib/systemLogos.ts';
import { AdminApp } from './pages/admin/AdminApp.tsx';
import { ForgotPasswordPage, SetPasswordPage } from './pages/admin/AccountLinkPages.tsx';
import { DisplayPage } from './pages/DisplayPage.tsx';
import { LivePage } from './pages/LivePage.tsx';

/**
 * Home page (any address without a link): the left system logo centred, otherwise the logo of ArenaLive, both in the
 * variant meant for the background behind them; the name of the product stays as title for screen readers.
 */
function HomeScreen() {
  const { left } = useSystemLogos();
  const logo = hasSystemLogo(left) ? (
    <SystemLogo pair={left} side="sinistra" size={SYSTEM_LOGO_FULL_SIZE} />
  ) : (
    <ProductLogo size={SYSTEM_LOGO_FULL_SIZE} />
  );
  return (
    <StatusScreen title={PRODUCT_NAME} logo={logo}>
      Per seguire una partita apri il link che ti è stato inviato.
    </StatusScreen>
  );
}

/** Routes: the public page of a link, the page of a player and the reserved area; nothing else is exposed. */
export function App() {
  return (
    <Routes>
      <Route path="/live/:token" element={<LivePage />} />
      {/* Short link (QR codes): the same page, with the short code in place of the long token. */}
      <Route path="/l/:token" element={<LivePage />} />
      {/* Page of a player (Raspberry Pi of a big screen): the token is in the fragment, `/schermo#<token>`. */}
      <Route path="/schermo" element={<DisplayPage />} />
      {/* Pages of the links sent by mail (no session needed): before the reserved area, which would ask for the login. */}
      <Route path="/admin/password-dimenticata" element={<ForgotPasswordPage />} />
      <Route path="/admin/invito/:token" element={<SetPasswordPage kind="invite" />} />
      <Route path="/admin/reimposta-password/:token" element={<SetPasswordPage kind="reset" />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="*" element={<HomeScreen />} />
    </Routes>
  );
}
