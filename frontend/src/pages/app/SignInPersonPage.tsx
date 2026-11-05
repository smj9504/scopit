/**
 * Scopit - Sign in person
 * Route: /app/sign-in-person   (?customer=<id> and/or ?document=<id> to start from one)
 *
 * On the company's own phone or tablet, with the signer there: pick the
 * customer (or add one), pick the documents, fill in what their fields
 * need, then hand over the device to read and sign. Nothing is saved until
 * the signer finishes; that one step saves a new customer and a fully
 * signed request with its signed PDF per document.
 *
 * The employee's steps live in the URL so a phone's back gesture steps back
 * through them, and the state lives here so going back keeps what was
 * entered. The visit is drafted to this tab's storage so a reload doesn't
 * lose it, and leaving once there's something to lose asks first.
 *
 * Handing over ends the employee's session on this device: the tokens leave
 * memory and storage, nothing fetched with them stays cached, and the
 * signer's part (KioskVisit) runs on a kiosk token that only reaches this
 * visit. No navigation leaves it; handing back loads the sign-in page fresh,
 * so the employee signs in again (and nothing of the visit stays in memory).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ConfigProvider, Modal, Skeleton } from 'antd';
import { ArrowLeftOutlined, CloseOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useFocusMode } from '@/hooks/useFocusMode';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getErrorMessage } from '@/services/api';
import { customerService } from '@/services/customerService';
import { useAuthStore } from '@/stores/authStore';
import CustomerStep from '@/components/features/tools/pdf-editor/in-person/CustomerStep';
import DocumentStep from '@/components/features/tools/pdf-editor/in-person/DocumentStep';
import FieldsStep from '@/components/features/tools/pdf-editor/in-person/FieldsStep';
import HandoffStep from '@/components/features/tools/pdf-editor/in-person/HandoffStep';
import KioskVisit, { type KioskSession } from '@/components/features/tools/pdf-editor/in-person/KioskVisit';
import { LoadError } from '@/components/features/tools/pdf-editor/in-person/ui';
import {
  inPersonApi,
  todayOnDevice,
  type Answers,
  type Subject,
} from '@/components/features/tools/pdf-editor/in-person/inPersonApi';
import { kioskClient } from '@/components/features/tools/pdf-editor/in-person/kioskApi';
import '@/components/features/tools/pdf-editor/in-person/inPerson.css';

type Step = 'customer' | 'documents' | 'fields' | 'handoff';

interface Draft {
  subject: Subject | null;
  documentIds: string[];
  answers: Answers;
  sequence: string[] | null;
}

const DRAFT_KEY = 'scopit-in-person-draft';

/** Where the employee picks the visit up again if it's handed back unsigned */
const RESUME_PATH = '/app/sign-in-person?step=handoff';

const readDraft = (): Partial<Draft> => {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    return {};
  }
};

const writeDraft = (draft: Draft | null) => {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage is off or full; the visit just won't survive a reload
  }
};

const subjectName = (subject: Subject | null) =>
  subject?.kind === 'customer' ? subject.name : subject?.customer.name;

/**
 * Take the employee's session off the device: the tokens leave memory and
 * storage. The store keeps saying "signed in" until the device is handed
 * back, so this page stays up (it's behind the signed-in routes); with no
 * token there's nothing it can reach.
 */
const dropEmployeeSession = () => {
  useAuthStore.getState().setTokens('', '');
  useAuthStore.persist.clearStorage();
};

/**
 * To the sign-in page, as a fresh page load: nothing of the visit or the
 * employee's session survives in memory. The router reads the sign-in page's
 * state (where to go after, whose email) from the history entry.
 */
const goToSignIn = (state: { returnTo: string; email?: string }) => {
  useAuthStore.persist.clearStorage();
  const entry = (window.history.state ?? {}) as Record<string, unknown>;
  // reauth: "Continue with Google" must ask for the password, so a customer
  // can't get in through a Google session already open in this browser.
  window.history.replaceState({ ...entry, usr: { ...state, reauth: true } }, '', '/login');
  window.location.reload();
};

const SignInPersonPage: React.FC = () => {
  useFocusMode(true);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const isPhone = useIsMobile();
  const [params, setParams] = useSearchParams();

  // Where Done and Exit go: the page this was opened from
  const [returnTo] = useState<string>(
    () => (location.state as { returnTo?: string } | null)?.returnTo || '/app/tools/pdf_editor',
  );
  const presetCustomer = params.get('customer');
  const presetDocument = params.get('document');

  // A step in the URL means this tab was already mid-visit; otherwise it's a new one
  const [draft] = useState<Partial<Draft>>(() => (params.get('step') ? readDraft() : {}));
  const [subject, setSubject] = useState<Subject | null>(draft.subject ?? null);
  const [documentIds, setDocumentIds] = useState<string[]>(
    Array.isArray(draft.documentIds) ? draft.documentIds : presetDocument ? [presetDocument] : [],
  );
  const [answers, setAnswers] = useState<Answers>(draft.answers ?? {});
  // What a phone asks one by one: what was blank when the questions loaded
  const [sequence, setSequence] = useState<string[] | null>(draft.sequence ?? null);
  // The device's date: an evening signing must not be dated tomorrow in UTC
  const today = useMemo(() => todayOnDevice(), []);

  // Once handed over, the signer's part of the visit
  const [kiosk, setKiosk] = useState<KioskSession | null>(null);
  const [handing, setHanding] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  useEffect(() => {
    if (kiosk) return;
    writeDraft(subject ? { subject, documentIds, answers, sequence } : null);
  }, [subject, documentIds, answers, sequence, kiosk]);

  // Opened for a customer: that customer is already picked
  const customerQuery = useQuery({
    queryKey: ['customer', presetCustomer],
    queryFn: () => customerService.getById(presetCustomer as string),
    enabled: !!presetCustomer && !subject && !kiosk,
  });
  useEffect(() => {
    if (!customerQuery.data || subject) return;
    setSubject({ kind: 'customer', id: customerQuery.data.id, name: customerQuery.data.name });
    setParams({ step: 'documents' }, { replace: true, state: location.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerQuery.data]);

  const stepParam = params.get('step');
  // "sign" was the hand-over step's old name
  const requested = ((stepParam === 'sign' ? 'handoff' : stepParam) as Step | null) ?? 'customer';
  const chosen = documentIds.length > 0;
  const available: Record<Step, boolean> = {
    customer: true,
    documents: !!subject,
    fields: !!subject && chosen,
    handoff: !!subject && chosen,
  };
  const step: Step = available[requested] ? requested : 'customer';

  const go = (next: Step, extra: Record<string, string> = {}) =>
    setParams({ step: next, ...extra }, { state: location.state });
  const back = () => navigate(-1);
  const exit = () => navigate(returnTo);

  const form = useQuery({
    queryKey: ['in-person-form', subject, documentIds],
    queryFn: () => inPersonApi.getForm(subject as Subject, documentIds),
    enabled: !kiosk && !!subject && chosen && (step === 'fields' || step === 'handoff'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Start from what's on record, keeping anything already typed for this visit
  const questions = form.data?.questions;
  useEffect(() => {
    if (!questions) return;
    const merged = Object.fromEntries(questions.map((q) => [q.key, answers[q.key] ?? q.value ?? '']));
    setAnswers(merged);
    setSequence((prev) => prev ?? questions.filter((q) => !merged[q.key]).map((q) => q.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions]);

  // Something typed would be lost by leaving now; and once handed over, the
  // signer can't navigate anywhere at all (the browser's Back included)
  const inKiosk = useRef(false);
  inKiosk.current = !!kiosk;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    inKiosk.current
    || ((step === 'fields' || step === 'handoff') && currentLocation.pathname !== nextLocation.pathname)
  ));
  useEffect(() => {
    if (kiosk && blocker.state === 'blocked') blocker.reset?.();
  }, [kiosk, blocker]);

  const resetVisit = () => {
    setAnswers({});
    setSequence(null);
  };
  const pickCustomer = (next: Subject) => {
    setSubject(next);
    setDocumentIds(presetDocument ? [presetDocument] : []);
    resetVisit();
    go('documents');
  };
  const pickDocuments = (ids: string[]) => {
    setDocumentIds(ids);
    setSequence(null);
  };

  const handOver = async () => {
    if (!subject) return;
    setHanding(true);
    setHandoffError(null);
    try {
      const handed = await inPersonApi.handoff(subject, documentIds, answers);
      // From here the device is the signer's
      await queryClient.cancelQueries();
      queryClient.clear();
      dropEmployeeSession();
      setKiosk({ ...handed, client: kioskClient(handed.token), today });
    } catch (err) {
      setHandoffError(getErrorMessage(err) || "Couldn't hand over. Check your connection and try again.");
    } finally {
      setHanding(false);
    }
  };

  const handBack = (signed: boolean) => {
    if (signed) writeDraft(null);
    goToSignIn({
      // Signed: back where the visit was started. Not signed: back to the
      // hand-over, with what was entered, to change it or hand over again.
      returnTo: signed ? returnTo : RESUME_PATH,
      email: kiosk?.staff.email,
    });
  };

  // Each screen starts at the top; a long document leaves the page far down
  const screenKey = `${step}:${params.get('q') ?? ''}`;
  const lastScreen = useRef(screenKey);
  useEffect(() => {
    if (lastScreen.current === screenKey) return;
    lastScreen.current = screenKey;
    window.scrollTo(0, 0);
  }, [screenKey]);

  if (kiosk) {
    return (
      <ConfigProvider componentSize="large">
        <KioskVisit session={kiosk} onSigned={() => writeDraft(null)} onHandBack={handBack} />
      </ConfigProvider>
    );
  }

  // What's been chosen so far, so whoever holds the device can see it's the right visit
  const docCount = documentIds.length;
  const trail = [
    subjectName(subject),
    step === 'customer' || step === 'documents' || !docCount
      ? null
      : docCount === 1
        ? form.data?.documents[0]?.name
        : `${docCount} documents`,
  ].filter(Boolean).join(' · ');

  const signerLabel = (role: string) => form.data?.signers.find((s) => s.role === role)?.label ?? role;

  const renderStep = () => {
    if (presetCustomer && !subject) {
      return customerQuery.isError
        ? <LoadError what="the customer" onRetry={() => customerQuery.refetch()} />
        : <Skeleton active paragraph={{ rows: 3 }} />;
    }
    switch (step) {
      case 'documents':
        return (
          <DocumentStep
            customerId={subject?.kind === 'customer' ? subject.id : undefined}
            selected={documentIds}
            onSelected={pickDocuments}
            onContinue={() => go('fields')}
          />
        );
      case 'fields':
      case 'handoff':
        if (form.isLoading) return <Skeleton active paragraph={{ rows: 5 }} />;
        if (form.isError || !form.data) {
          return <LoadError what="the documents' fields" onRetry={() => form.refetch()} />;
        }
        if (step === 'fields') {
          const screen = params.get('q');
          return (
            <FieldsStep
              questions={form.data.questions}
              answers={answers}
              onAnswers={setAnswers}
              documentCount={form.data.documents.length}
              signerLabel={signerLabel}
              isPhone={isPhone}
              sequence={sequence ?? []}
              screen={screen}
              fromReview={params.get('from') === 'review'}
              onShow={(next, fromReview) => go('fields', { q: next, ...(fromReview ? { from: 'review' } : {}) })}
              onBack={back}
              onDone={() => setParams(
                { step: 'handoff' },
                { replace: form.data.questions.length === 0, state: location.state },
              )}
            />
          );
        }
        return (
          <HandoffStep
            customerName={form.data.customer.name || subjectName(subject) || ''}
            documentNames={form.data.documents.map((doc) => doc.name)}
            busy={handing}
            error={handoffError}
            onBack={back}
            onHandOver={handOver}
          />
        );
      default:
        return (
          <CustomerStep
            newCustomer={subject?.kind === 'new' ? subject.customer : null}
            onCustomer={(customer) => pickCustomer({ kind: 'customer', id: customer.id, name: customer.name })}
            onNewCustomer={(customer) => pickCustomer({ kind: 'new', customer })}
          />
        );
    }
  };

  return (
    <ConfigProvider componentSize="large">
      <div className="ip-root">
        <header className="ip-bar">
          <div className="ip-bar-inner">
            {step !== 'customer' && (
              <Button type="text" className="ip-icon-btn" icon={<ArrowLeftOutlined />} aria-label="Back" onClick={back} />
            )}
            <div className="ip-bar-title" style={{ paddingLeft: step !== 'customer' ? 0 : 8 }}>
              Sign in person
              {trail && <span className="ip-bar-trail">{trail}</span>}
            </div>
            <Button type="text" className="ip-icon-btn" icon={<CloseOutlined />} aria-label="Exit" onClick={exit} />
          </div>
        </header>
        <main className="ip-main">
          {renderStep()}
        </main>
      </div>
      <Modal
        open={blocker.state === 'blocked'}
        title="Leave this signing?"
        okText="Leave"
        cancelText="Stay"
        okButtonProps={{ danger: true }}
        onOk={() => {
          writeDraft(null);
          blocker.proceed?.();
        }}
        onCancel={() => blocker.reset?.()}
      >
        What you&apos;ve entered is lost: nothing is saved until the signer finishes signing.
      </Modal>
    </ConfigProvider>
  );
};

export default SignInPersonPage;
