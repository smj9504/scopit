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
 * The step lives in the URL so a phone's back gesture steps back through the
 * flow instead of leaving it, and the state lives here so going back keeps
 * what was entered. The visit is drafted to this tab's storage so a reload
 * doesn't lose it (signatures aren't kept: the signer signs again), and
 * leaving once there's something to lose asks first.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ConfigProvider, Modal, Skeleton } from 'antd';
import { ArrowLeftOutlined, CloseOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useFocusMode } from '@/hooks/useFocusMode';
import { useIsMobile } from '@/hooks/useIsMobile';
import { customerService } from '@/services/customerService';
import CustomerStep from '@/components/features/tools/pdf-editor/in-person/CustomerStep';
import DocumentStep from '@/components/features/tools/pdf-editor/in-person/DocumentStep';
import DoneStep from '@/components/features/tools/pdf-editor/in-person/DoneStep';
import FieldsStep from '@/components/features/tools/pdf-editor/in-person/FieldsStep';
import SignStep from '@/components/features/tools/pdf-editor/in-person/SignStep';
import { LoadError } from '@/components/features/tools/pdf-editor/in-person/ui';
import {
  inPersonApi,
  todayOnDevice,
  type Answers,
  type SignedVisit,
  type Subject,
} from '@/components/features/tools/pdf-editor/in-person/inPersonApi';
import '@/components/features/tools/pdf-editor/in-person/inPerson.css';

type Step = 'customer' | 'documents' | 'fields' | 'sign';

interface Draft {
  subject: Subject | null;
  documentIds: string[];
  answers: Answers;
  sequence: string[] | null;
}

const DRAFT_KEY = 'scopit-in-person-draft';

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
  const [result, setResult] = useState<SignedVisit | null>(null);
  // The device's date: an evening signing must not be dated tomorrow in UTC
  const today = useMemo(() => todayOnDevice(), []);

  useEffect(() => {
    writeDraft(subject && !result ? { subject, documentIds, answers, sequence } : null);
  }, [subject, documentIds, answers, sequence, result]);

  // Opened for a customer: that customer is already picked
  const customerQuery = useQuery({
    queryKey: ['customer', presetCustomer],
    queryFn: () => customerService.getById(presetCustomer as string),
    enabled: !!presetCustomer && !subject,
  });
  useEffect(() => {
    if (!customerQuery.data || subject) return;
    setSubject({ kind: 'customer', id: customerQuery.data.id, name: customerQuery.data.name });
    setParams({ step: 'documents' }, { replace: true, state: location.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerQuery.data]);

  const requested = (params.get('step') as Step | null) ?? 'customer';
  const chosen = documentIds.length > 0;
  const available: Record<Step, boolean> = {
    customer: true,
    documents: !!subject,
    fields: !!subject && chosen,
    sign: !!subject && chosen,
  };
  const step: Step = available[requested] ? requested : 'customer';

  const go = (next: Step, extra: Record<string, string> = {}) =>
    setParams({ step: next, ...extra }, { state: location.state });
  const back = () => navigate(-1);
  const exit = () => navigate(returnTo);

  const form = useQuery({
    queryKey: ['in-person-form', subject, documentIds],
    queryFn: () => inPersonApi.getForm(subject as Subject, documentIds),
    enabled: !!subject && chosen && (step === 'fields' || step === 'sign'),
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

  // Something typed or signed would be lost by leaving now
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    !result && (step === 'fields' || step === 'sign') && currentLocation.pathname !== nextLocation.pathname
  ));

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

  const startOver = () => {
    setSubject(null);
    setDocumentIds([]);
    resetVisit();
    setResult(null);
    setParams({}, { replace: true, state: location.state });
  };

  // Each screen starts at the top; a long document leaves the page far down
  const screenKey = `${result ? 'done' : step}:${params.get('q') ?? ''}:${params.get('doc') ?? ''}`;
  const lastScreen = useRef(screenKey);
  useEffect(() => {
    if (lastScreen.current === screenKey) return;
    lastScreen.current = screenKey;
    window.scrollTo(0, 0);
  }, [screenKey]);

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
    if (result) {
      return <DoneStep result={result} onStartOver={startOver} onExit={exit} />;
    }
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
      case 'sign':
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
                { step: 'sign' },
                { replace: form.data.questions.length === 0, state: location.state },
              )}
            />
          );
        }
        return (
          <SignStep
            form={form.data}
            subject={subject as Subject}
            answers={answers}
            today={today}
            docIndex={Number(params.get('doc') ?? 0) || 0}
            onDoc={(index) => go('sign', { doc: String(index) })}
            isPhone={isPhone}
            onBack={back}
            onSigned={(signed) => {
              writeDraft(null);
              setResult(signed);
              queryClient.invalidateQueries({ queryKey: ['pdf-editor-sign-requests'] });
              queryClient.invalidateQueries({ queryKey: ['customer-documents', signed.customerId] });
              if (signed.customerCreated) queryClient.invalidateQueries({ queryKey: ['customers'] });
            }}
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
      <div className={`ip-root${step === 'sign' && !result ? ' ip-root--wide' : ''}`}>
        <header className="ip-bar">
          <div className="ip-bar-inner">
            {!result && step !== 'customer' && (
              <Button type="text" className="ip-icon-btn" icon={<ArrowLeftOutlined />} aria-label="Back" onClick={back} />
            )}
            <div className="ip-bar-title" style={{ paddingLeft: !result && step !== 'customer' ? 0 : 8 }}>
              Sign in person
              {trail && <span className="ip-bar-trail">{trail}</span>}
            </div>
            <Button type="text" className="ip-icon-btn" icon={<CloseOutlined />} aria-label="Exit" onClick={exit} />
          </div>
        </header>
        <main className={`ip-main${step === 'sign' && !result ? ' ip-main--wide' : ''}`}>
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
