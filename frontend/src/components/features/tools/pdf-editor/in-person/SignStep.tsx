/**
 * The signer reads the filled-in documents and signs them, on this device.
 * Nothing is saved until they finish: that one step makes the customer (if
 * new) and a signed request with its signed PDF per document.
 *
 * Several documents are taken one per screen, with a step list on top
 * showing what each still needs, and a bar that stays in view and always
 * offers the next thing to do: the next line, then the next document, then
 * finishing. Nothing can be finished until every line of every document is
 * signed, so none is left behind.
 *
 * A signer draws their signature (and initials) once: the first line opens
 * the pad, and every other line of theirs, on any document, takes the same
 * mark with a tap -- the same mark the signed PDF puts on all of them.
 *
 * This runs on the handed-over device, on the visit's kiosk token only.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Skeleton } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import * as pdfjsLib from 'pdfjs-dist';
import '../pdfWorker';
import { getErrorMessage } from '@/services/api';
import SignatureCaptureModal, { type SignMode, useSignatureFonts } from '../SignatureCaptureModal';
import {
  CONSENT_TEXT,
  type Answers,
  type FormDocument,
  type InPersonForm,
  type Mark,
  type SignLine,
  type SignedVisit,
} from './inPersonApi';
import { isKioskEnded, type KioskClient } from './kioskApi';
import { ActionBar } from './ui';

interface RenderedPage {
  src: string;
  width: number;
  height: number;
}

/** pdf.js takes the buffer it's given, so it gets a copy and the cache keeps the original */
async function renderPdf(buffer: ArrayBuffer): Promise<RenderedPage[]> {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  try {
    const pages: RenderedPage[] = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      // Sharp on a tablet, within what a phone lets one canvas have
      const viewport = page.getViewport({ scale: Math.min(2.5, 1400 / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      pages.push({ src: canvas.toDataURL('image/jpeg', 0.9), width: base.width, height: base.height });
      canvas.width = 0;
      canvas.height = 0;
    }
    return pages;
  } finally {
    pdf.destroy();
  }
}

/** One signer's mark of one kind, shared by all of that signer's lines of that kind */
const slotOf = (line: Pick<SignLine, 'signerRole' | 'type'>) => `${line.signerRole}:${line.type}`;
/** Line keys are only unique within a document */
const lineId = (doc: FormDocument, line: SignLine) => `${doc.id}:${line.key}`;
const lineDomId = (id: string) => `ip-line-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;

export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((word) => word[0]).join('').toUpperCase().slice(0, 4);

type PreviewState = 'loading' | 'ready' | 'failed';

interface CapturedMark {
  image: string;
  mode: SignMode;
  font?: string;
}

// ── One document ─────────────────────────────────────────────────────────────

const DocumentPages: React.FC<{
  doc: FormDocument;
  active: boolean;
  client: KioskClient;
  answers: Answers;
  today: string;
  lineText: (line: SignLine, compact?: boolean) => string;
  markOf: (line: SignLine) => string | undefined;
  flash: string | null;
  disabled: boolean;
  onLine: (line: SignLine) => void;
  onState: (state: PreviewState) => void;
  onEnded: () => void;
}> = ({ doc, active, client, answers, today, lineText, markOf, flash, disabled, onLine, onState, onEnded }) => {
  const preview = useQuery({
    queryKey: ['in-person-kiosk-preview', client.key, doc.id, answers, today],
    queryFn: async () => renderPdf(await client.preview(doc.id, answers, today)),
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: (count, error) => count < 1 && !isKioskEnded(error),
  });

  const state: PreviewState = preview.isSuccess ? 'ready' : preview.isError ? 'failed' : 'loading';
  const report = useRef(onState);
  report.current = onState;
  useEffect(() => { report.current(state); }, [state]);
  const ended = useRef(onEnded);
  ended.current = onEnded;
  useEffect(() => {
    if (preview.isError && isKioskEnded(preview.error)) ended.current();
  }, [preview.isError, preview.error]);

  return (
    <section hidden={!active} aria-label={doc.name}>
      {state === 'loading' && <Skeleton active paragraph={{ rows: 12 }} />}
      {state === 'failed' && (
        <div className="ip-alert ip-alert--error" role="alert">
          Couldn&apos;t load {doc.name}. {getErrorMessage(preview.error)}
          <Button size="small" onClick={() => preview.refetch()}>Try again</Button>
        </div>
      )}
      {preview.data?.map((page, index) => (
        <div key={index} className="ip-page">
          <img
            src={page.src}
            alt={`${doc.name}, page ${index + 1} of ${preview.data.length}`}
            width={page.width}
            height={page.height}
          />
          {doc.lines.filter((line) => line.page === index + 1).map((line) => {
            const id = lineId(doc, line);
            const mark = markOf(line);
            const text = lineText(line);
            return (
              <button
                key={line.key}
                type="button"
                id={lineDomId(id)}
                className={`ip-line${mark ? ' is-signed' : ''}${flash === id ? ' is-flash' : ''}`}
                style={{
                  left: `${line.x * 100}%`,
                  top: `${line.y * 100}%`,
                  width: `${line.width * 100}%`,
                  height: `${line.height * 100}%`,
                }}
                disabled={disabled}
                onClick={() => onLine(line)}
                aria-label={mark ? `${text}, signed. Tap to sign again` : text}
              >
                {mark
                  ? <img src={`data:image/png;base64,${mark}`} alt="" />
                  : <span className="ip-line-label">{lineText(line, line.width < 0.2)}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
};

// ── The visit's documents, and signing them ──────────────────────────────────

interface SignStepProps {
  form: InPersonForm;
  /** The visit's kiosk-token client */
  client: KioskClient;
  answers: Answers;
  today: string;
  /** Who handed over the device, for "That's me" on a line they sign */
  staff: { name: string; email: string } | null;
  /** Which document is on screen */
  docIndex: number;
  onDoc: (index: number) => void;
  onSigned: (result: SignedVisit) => void;
  /** The kiosk token stopped working */
  onEnded: () => void;
}

const SignStep: React.FC<SignStepProps> = ({
  form, client, answers, today, staff, docIndex, onDoc, onSigned, onEnded,
}) => {
  useSignatureFonts();
  const { documents, signers } = form;
  const several = documents.length > 1;
  const current = Math.min(Math.max(docIndex, 0), documents.length - 1);
  const currentDoc = documents[current];
  const isLast = current === documents.length - 1;
  const consentText = several ? `${CONSENT_TEXT} This covers all ${documents.length} documents.` : CONSENT_TEXT;
  const labelOf = useMemo(() => new Map(signers.map((s) => [s.role, s.label])), [signers]);
  const signerLabel = (role: string) => labelOf.get(role) ?? role;

  // The first signer is taken to be the customer
  const customerName = (
    answers['customer.contact_name'] || form.customer.contactName
    || answers['customer.name'] || form.customer.name || ''
  ).trim();
  const customerEmail = (answers['customer.email'] || form.customer.email || '').trim();
  const [names, setNames] = useState<Record<string, string>>(
    () => (signers[0] ? { [signers[0].role]: customerName } : {}),
  );
  const [me, setMe] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [marks, setMarks] = useState<Record<string, CapturedMark>>({});
  const [placed, setPlaced] = useState<Record<string, boolean>>({});
  const [pad, setPad] = useState<{ slot: string; role: string; type: 'signature' | 'initials'; line?: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, PreviewState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const left = useCallback(
    (doc: FormDocument) => doc.lines.filter((line) => !placed[lineId(doc, line)]),
    [placed],
  );
  const leftHere = left(currentDoc);
  const firstUnfinished = documents.findIndex((doc) => left(doc).length > 0);
  const allSigned = firstUnfinished === -1;
  const currentShown = states[currentDoc.id] === 'ready';
  const allShown = documents.every((doc) => states[doc.id] === 'ready');
  const missingNames = signers.filter((s) => !(names[s.role] ?? '').trim());
  const ready = allShown && allSigned && missingNames.length === 0 && consent;

  /** What a line says on the page, and in full for a screen reader */
  const lineText = (line: SignLine, compact = false) => {
    const kind = line.type === 'initials' ? 'Initial' : 'Sign here';
    // A narrow initials box only has room for the word
    if (signers.length < 2 || compact) return kind;
    return `${signerLabel(line.signerRole)} ${line.type === 'initials' ? 'initials' : 'signs'}`;
  };

  const openPad = (role: string, type: 'signature' | 'initials', line?: string) =>
    setPad({ slot: `${role}:${type}`, role, type, line });

  const tapLine = (doc: FormDocument, line: SignLine) => {
    const id = lineId(doc, line);
    const slot = slotOf(line);
    if (placed[id]) {
      // A signed line redraws the mark, wherever it's been placed
      openPad(line.signerRole, line.type);
    } else if (marks[slot]) {
      setPlaced((prev) => ({ ...prev, [id]: true }));
    } else {
      openPad(line.signerRole, line.type, id);
    }
  };

  const flashTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const showLine = (id: string) => {
    document.getElementById(lineDomId(id))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(id);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1400);
  };

  const signNext = () => {
    const line = leftHere[0];
    if (!line) return;
    showLine(lineId(currentDoc, line));
    tapLine(currentDoc, line);
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const byRole: Record<string, Mark> = {};
      signers.forEach(({ role }) => {
        const signature = marks[`${role}:signature`];
        const initials = marks[`${role}:initials`];
        byRole[role] = {
          ...(signature ? { signature: signature.image, signature_type: signature.mode, signature_font: signature.font } : {}),
          ...(initials ? { initials: initials.image } : {}),
        };
      });
      const result = await client.sign({
        answers,
        today,
        signers: signers.map(({ role }, index) => ({
          role,
          name: (names[role] ?? '').trim(),
          email: me === role ? staff?.email : index === 0 ? customerEmail || undefined : undefined,
        })),
        marks: byRole,
        consentText,
      });
      onSigned(result);
    } catch (err) {
      if (isKioskEnded(err)) {
        onEnded();
        return;
      }
      setSubmitError(getErrorMessage(err) || "Couldn't save the signatures. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  const toSign = (count: number) => `${count} ${count === 1 ? 'line' : 'lines'} to sign`;
  const which = several ? 'this document' : 'the document';

  // The one thing to do next, kept in view under the thumb
  const guide = (() => {
    if (!currentShown) return { text: 'Loading the document…', button: null };
    if (leftHere.length > 0) {
      return {
        text: `${toSign(leftHere.length)} on ${which}`,
        button: (
          <Button type="primary" size="large" disabled={submitting} onClick={signNext}>
            {marks[slotOf(leftHere[0])] ? 'Sign next line' : 'Sign'}
          </Button>
        ),
      };
    }
    if (!isLast) {
      return {
        text: `Signed. Next: ${documents[current + 1].name}`,
        button: <Button type="primary" size="large" onClick={() => onDoc(current + 1)}>Next document</Button>,
      };
    }
    if (!allSigned) {
      const behind = documents[firstUnfinished];
      return {
        text: `${behind.name} still has ${toSign(left(behind).length)}`,
        button: (
          <Button type="primary" size="large" onClick={() => onDoc(firstUnfinished)}>
            Go to document {firstUnfinished + 1}
          </Button>
        ),
      };
    }
    const missing = [
      ...missingNames.map((s) => `${s.label}'s full name`),
      ...(consent ? [] : ['agreement to sign electronically']),
      ...(allShown ? [] : ['every document to load']),
    ];
    return {
      text: missing.length > 0 ? `Still needed: ${missing.join(', ')}` : 'Ready to finish',
      button: (
        <Button type="primary" size="large" disabled={!ready} loading={submitting} onClick={submit}>
          Finish signing
        </Button>
      ),
    };
  })();

  const padName = pad
    ? (pad.type === 'initials' ? initialsOf(names[pad.role] ?? '') : (names[pad.role] ?? '').trim())
    : '';

  return (
    <>
      <h1 className="ip-title">{several ? `Document ${current + 1} of ${documents.length}` : 'Read and sign'}</h1>
      <p className="ip-lead">
        {currentDoc.name}
        {currentShown && (
          <span style={{ display: 'block', marginTop: 4 }}>
            Tap each marked line to sign. After the first signature, tapping a line puts the same signature on it.
          </span>
        )}
      </p>

      {several && (
        <ol className="ip-steps" aria-label="Documents to sign">
          {documents.map((doc, index) => {
            const count = left(doc).length;
            const done = count === 0;
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  className={`ip-step${done ? ' is-done' : ''}`}
                  aria-current={index === current ? 'step' : undefined}
                  onClick={() => onDoc(index)}
                >
                  <span className="ip-step-mark" aria-hidden="true">{done ? <CheckOutlined /> : index + 1}</span>
                  <span>
                    <span className="ip-step-name">{doc.name}</span>
                    <span className="ip-step-meta">{done ? 'Signed' : toSign(count)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {documents.map((doc, index) => (
        <DocumentPages
          key={doc.id}
          doc={doc}
          active={index === current}
          client={client}
          answers={answers}
          today={today}
          lineText={lineText}
          markOf={(line) => (placed[lineId(doc, line)] ? marks[slotOf(line)]?.image : undefined)}
          flash={flash}
          disabled={submitting}
          onLine={(line) => tapLine(doc, line)}
          onState={(state) => setStates((prev) => (prev[doc.id] === state ? prev : { ...prev, [doc.id]: state }))}
          onEnded={onEnded}
        />
      ))}

      {currentShown && isLast && (
        <>
          <h2 className="ip-section-title">{signers.length > 1 ? 'Signers' : 'Signer'}</h2>
          {signers.map((signer) => {
            const id = `ip-signer-${signer.role}`;
            const name = names[signer.role] ?? '';
            const kinds = (['signature', 'initials'] as const).filter((kind) => signer[kind]);
            return (
              <section key={signer.role} className="ip-signer" aria-labelledby={`${id}-label`}>
                <div className="ip-signer-head">
                  <label id={`${id}-label`} className="ip-signer-role" htmlFor={id}>
                    {signers.length > 1 ? `${signer.label}'s full name` : 'Full name'}
                  </label>
                  {staff?.name && me !== signer.role && !name && (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        setNames((prev) => ({ ...prev, [signer.role]: staff.name }));
                        setMe(signer.role);
                      }}
                    >
                      That&apos;s me
                    </Button>
                  )}
                </div>
                <Input
                  id={id}
                  size="large"
                  value={name}
                  autoComplete="off"
                  disabled={submitting}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNames((prev) => ({ ...prev, [signer.role]: value }));
                    if (me === signer.role && value.trim() !== staff?.name) setMe(null);
                  }}
                />
                <div className="ip-marks">
                  {kinds.map((kind) => {
                    const mark = marks[`${signer.role}:${kind}`];
                    const label = kind === 'initials' ? 'Initials' : 'Signature';
                    return (
                      <div key={kind} className="ip-mark">
                        <span className="ip-mark-label">{label}</span>
                        {mark
                          ? <img className="ip-mark-img" src={`data:image/png;base64,${mark.image}`} alt={`${signer.label} ${label.toLowerCase()}`} />
                          : <span className="ip-mark-label">not signed yet</span>}
                        {mark && (
                          <Button size="small" disabled={submitting} onClick={() => openPad(signer.role, kind)}>
                            Redo
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          <div className="ip-consent">
            <Checkbox checked={consent} disabled={submitting} onChange={(e) => setConsent(e.target.checked)}>
              {consentText}
            </Checkbox>
          </div>
          {submitError && <div className="ip-alert ip-alert--error" role="alert">{submitError}</div>}
        </>
      )}

      <ActionBar text={guide.text}>
        {guide.button}
      </ActionBar>

      <SignatureCaptureModal
        open={!!pad}
        fieldType={pad?.type ?? 'signature'}
        title={pad ? `${signerLabel(pad.role)} ${pad.type === 'initials' ? 'initials' : 'signature'}` : undefined}
        defaultName={padName}
        onClose={() => setPad(null)}
        onApply={(image, mode, font) => {
          if (pad) {
            setMarks((prev) => ({ ...prev, [pad.slot]: { image, mode, font } }));
            const { line } = pad;
            if (line) setPlaced((prev) => ({ ...prev, [line]: true }));
          }
          setPad(null);
        }}
      />
    </>
  );
};

export default SignStep;
