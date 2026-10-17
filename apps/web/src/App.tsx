import { Route, Routes } from 'react-router';
import { StatusScreen } from './components/StatusScreen.tsx';
import { AdminApp } from './pages/admin/AdminApp.tsx';
import { ForgotPasswordPage, SetPasswordPage } from './pages/admin/AccountLinkPages.tsx';
import { LivePage } from './pages/LivePage.tsx';

/** Routes: the public page of a link and the reserved area; nothing else is exposed. */
export function App() {
  return (
    <Routes>
      <Route path="/live/:token" element={<LivePage />} />
      {/* Short link (QR codes): the same page, with the short code in place of the long token. */}
      <Route path="/l/:token" element={<LivePage />} />
      {/* Pages of the links sent by mail (no session needed): before the reserved area, which would ask for the login. */}
      <Route path="/admin/password-dimenticata" element={<ForgotPasswordPage />} />
      <Route path="/admin/invito/:token" element={<SetPasswordPage kind="invite" />} />
      <Route path="/admin/reimposta-password/:token" element={<SetPasswordPage kind="reset" />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route
        path="*"
        element={
          <StatusScreen title="SIRRealtime">Per seguire una partita apri il link che ti è stato inviato.</StatusScreen>
        }
      />
    </Routes>
  );
}
