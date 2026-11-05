/**
 * The signer's part of an in-person visit, on the handed-over device.
 *
 * By now the employee is signed out on this device and everything here runs
 * on the visit's kiosk token (kioskApi.ts): the signer reads and signs this
 * visit's documents, emails themselves their copies, and hands the device
 * back. There's no way back to the employee's steps from here: no Back or
 * Exit, and the page holding this (KioskSigningPage) keeps the browser's Back
 * on it. Progress is reported up so a reload resumes the visit
 * (kioskSession.ts). Handing back goes to the sign-in page.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal } from 'antd';
import type { InPersonForm, SignedVisit } from './inPersonApi';
import type { Handoff, KioskClient } from './kioskApi';
import type { SignProgress } from './kioskSession';
import DoneStep from './DoneStep';
import SignStep from './SignStep';

export interface KioskSession extends Handoff {
  client: KioskClient;
  /** The device's date when it was handed over */
  today: string;
}

const visitName = (form: InPersonForm) =>
  (form.documents.length === 1 ? form.documents[0]?.name : `${form.documents.length} documents`) ?? '';

const KioskVisit: React.FC<{
  session: KioskSession;
  /** Where a reloaded visit was */
  initialDocIndex?: number;
  initialResult?: SignedVisit | null;
  initialEnded?: boolean;
  initialProgress?: SignProgress;
  onDoc?: (index: number) => void;
  onProgress?: (progress: SignProgress) => void;
  onSigned: (result: SignedVisit) => void;
  /** Give the device back; `signed` once the documents are */
  onHandBack: (signed: boolean) => void;
}> = ({
  session, initialDocIndex = 0, initialResult = null, initialEnded = false, initialProgress,
  onDoc, onProgress, onSigned, onHandBack,
}) => {
  const { form, answers, client, today, staff } = session;
  const company = session.companyName || 'the company';
  const [docIndex, setDocIndex] = useState(initialDocIndex);
  const [result, setResult] = useState<SignedVisit | null>(initialResult);
  const [ended, setEnded] = useState(initialEnded);
  const [confirming, setConfirming] = useState(false);
  const leaving = useRef(false);

  const handBack = () => {
    leaving.current = true;
    onHandBack(!!result);
  };

  // A reload resumes the visit, but closing the tab ends it: ask first, until it's signed
  useEffect(() => {
    if (result) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [result]);

  // A pull-down at the top of a long document mustn't reload the page
  useEffect(() => {
    const targets = [document.documentElement, document.body];
    const before = targets.map((el) => el.style.overscrollBehaviorY);
    targets.forEach((el) => { el.style.overscrollBehaviorY = 'contain'; });
    return () => targets.forEach((el, i) => { el.style.overscrollBehaviorY = before[i]; });
  }, []);

  // Each screen starts at the top
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [docIndex, result, ended]);

  const showDoc = (index: number) => {
    setDocIndex(index);
    onDoc?.(index);
  };

  const wide = !result && !ended;
  const trail = [form.customer.name, visitName(form)].filter(Boolean).join(' · ');

  const renderBody = () => {
    if (ended) {
      return (
        <div className="ip-empty">
          <strong>This signing session has ended</strong>
          {result
            ? `The documents are signed and saved. Hand the device back to ${company}; they can email the copies.`
            : `A signing session lasts up to 2 hours. Nothing was signed. Hand the device back to ${company} to start again.`}
          <div style={{ marginTop: 16 }}>
            <Button type="primary" size="large" onClick={handBack}>Hand back to {company}</Button>
          </div>
        </div>
      );
    }
    if (result) {
      return (
        <DoneStep
          result={result}
          client={client}
          companyName={session.companyName}
          onHandBack={handBack}
          onEnded={() => setEnded(true)}
        />
      );
    }
    return (
      <SignStep
        form={form}
        client={client}
        answers={answers}
        today={today}
        staff={staff}
        docIndex={docIndex}
        onDoc={showDoc}
        initialProgress={initialProgress}
        onProgress={onProgress}
        onSigned={(signed) => {
          setResult(signed);
          onSigned(signed);
        }}
        onEnded={() => setEnded(true)}
      />
    );
  };

  return (
    <div className={`ip-root${wide ? ' ip-root--wide' : ''}`}>
      <header className="ip-bar">
        <div className="ip-bar-inner">
          <div className="ip-bar-title" style={{ paddingLeft: 8 }}>
            Sign in person
            {trail && <span className="ip-bar-trail">{trail}</span>}
          </div>
          <Button type="text" onClick={() => (result || ended ? handBack() : setConfirming(true))}>
            Hand back
          </Button>
        </div>
      </header>
      <main className={`ip-main${wide ? ' ip-main--wide' : ''}`}>{renderBody()}</main>
      <Modal
        open={confirming}
        title={`Hand the device back to ${company}?`}
        okText="Hand back"
        cancelText="Keep signing"
        onOk={handBack}
        onCancel={() => setConfirming(false)}
      >
        Nothing has been signed yet. {staff.name || company} signs in to Scopit again to continue.
      </Modal>
    </div>
  );
};

export default KioskVisit;
