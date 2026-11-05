/**
 * Scopit - In-person signing, the signer's page
 * Route: /sign-in-person/kiosk   (public: the employee is signed out by now)
 *
 * The employee's hand-over (SignInPersonPage) saves the visit to this tab's
 * storage, signs the employee out and loads this page fresh. It runs only on
 * the visit's kiosk token, so it lives outside the signed-in routes, and a
 * reload simply picks the visit up again from storage (kioskSession.ts):
 * the document on screen, names, drawn signatures and where they're placed,
 * or the signed result.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button, ConfigProvider } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import KioskVisit from '@/components/features/tools/pdf-editor/in-person/KioskVisit';
import { kioskClient } from '@/components/features/tools/pdf-editor/in-person/kioskApi';
import {
  RESUME_PATH,
  clearInPersonDraft,
  clearKiosk,
  goToSignIn,
  kioskExpired,
  loadKiosk,
  updateKiosk,
} from '@/components/features/tools/pdf-editor/in-person/kioskSession';
import '@/components/features/tools/pdf-editor/in-person/inPerson.css';

const KioskSigningPage: React.FC = () => {
  const [stored] = useState(loadKiosk);

  // While the signer has the device there is no employee session on it, in
  // this tab or (through the shared storage) any other.
  useEffect(() => {
    if (!stored) return;
    const auth = useAuthStore.getState();
    if (auth.accessToken || auth.refreshToken || auth.isAuthenticated) auth.logout();
    useAuthStore.persist.clearStorage();
  }, [stored]);

  // The browser's Back stays on the visit
  useEffect(() => {
    if (!stored) return undefined;
    const stay = () => window.history.pushState(window.history.state, '', window.location.href);
    stay();
    window.addEventListener('popstate', stay);
    return () => window.removeEventListener('popstate', stay);
  }, [stored]);

  const session = useMemo(
    () => (stored
      ? { ...stored.handoff, client: kioskClient(stored.handoff.token), today: stored.today }
      : null),
    [stored],
  );

  if (!stored || !session) {
    return (
      <div className="ip-root">
        <main className="ip-main">
          <div className="ip-empty">
            <strong>No signing in progress on this device</strong>
            Sign in to Scopit to start an in-person signing.
            <div style={{ marginTop: 16 }}>
              <Button type="primary" size="large" onClick={() => window.location.assign('/login')}>
                Sign in
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <ConfigProvider componentSize="large">
      <KioskVisit
        session={session}
        initialDocIndex={stored.docIndex}
        initialResult={stored.result ?? null}
        initialEnded={!stored.result && kioskExpired(stored.handoff)}
        initialProgress={stored.progress}
        onDoc={(docIndex) => updateKiosk({ docIndex })}
        onProgress={(progress) => updateKiosk({ progress })}
        onSigned={(result) => {
          // Signed: the drawn marks aren't needed any more, nor the employee's draft
          updateKiosk({ result, progress: undefined });
          clearInPersonDraft();
        }}
        onHandBack={(signed) => {
          clearKiosk();
          if (signed) clearInPersonDraft();
          goToSignIn({
            // Signed: back where the visit was started. Not signed: back to the
            // hand-over, with what was entered, to change it or hand over again.
            returnTo: signed ? stored.returnTo : RESUME_PATH,
            email: stored.handoff.staff.email,
          });
        }}
      />
    </ConfigProvider>
  );
};

export default KioskSigningPage;
