import { Route, Routes } from 'react-router';
import { StatusScreen } from './components/StatusScreen.tsx';
import { AdminApp } from './pages/admin/AdminApp.tsx';
import { LivePage } from './pages/LivePage.tsx';

/** Routes: the public page of a link and the reserved area; nothing else is exposed. */
export function App() {
  return (
    <Routes>
      <Route path="/live/:token" element={<LivePage />} />
      {/* Short link (QR codes): the same page, with the short code in place of the long token. */}
      <Route path="/l/:token" element={<LivePage />} />
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
