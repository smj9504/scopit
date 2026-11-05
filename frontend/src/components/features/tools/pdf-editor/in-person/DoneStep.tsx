/**
 * After signing, still in the signer's hands: what was signed, emailing them
 * their copies (all of a visit's documents in one email), and handing the
 * device back. Runs on the visit's kiosk token: the company's own screens
 * (downloads, the customer's page, another visit) wait until the employee
 * signs in again.
 */
import React, { useState } from 'react';
import { App, Button, Input } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { getErrorMessage } from '@/services/api';
import type { SignedVisit } from './inPersonApi';
import { isKioskEnded, type KioskClient } from './kioskApi';

const DoneStep: React.FC<{
  result: SignedVisit;
  client: KioskClient;
  companyName: string;
  onHandBack: () => void;
  onEnded: () => void;
}> = ({ result, client, companyName, onHandBack, onEnded }) => {
  const { message } = App.useApp();
  const [email, setEmail] = useState(result.customerEmail ?? '');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string[] | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const { requests } = result;
  const several = requests.length > 1;
  const noPdf = requests.filter((r) => !r.signedPdfReady);

  const send = async () => {
    const emails = email.split(/[,;\s]+/).map((e) => e.trim()).filter((e) => e.includes('@'));
    if (emails.length === 0) {
      setEmailError('Enter an email address.');
      return;
    }
    setSending(true);
    setEmailError(null);
    try {
      const sent = await client.email(requests.map((r) => r.id), emails);
      setSentTo(sent.emails);
      message.success(several ? 'Signed copies sent' : 'Signed copy sent');
    } catch (err) {
      if (isKioskEnded(err)) {
        onEnded();
        return;
      }
      setEmailError(getErrorMessage(err) || "Couldn't send the email. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="ip-done-head">
        <span className="ip-done-icon" aria-hidden="true"><CheckOutlined /></span>
        <div>
          <h1 className="ip-title" style={{ margin: 0 }}>Signed</h1>
          <p className="ip-lead" style={{ margin: 0 }}>
            {several ? `${requests.length} documents` : requests[0]?.documentName}
            {' for '}
            {result.customerName}
          </p>
        </div>
      </div>

      {noPdf.length > 0 && (
        <div className="ip-alert ip-alert--warn" role="alert">
          The signatures are saved, but the signed PDF for {noPdf.map((r) => r.documentName).join(', ')}
          {' '}couldn&apos;t be made yet. It&apos;s made again when it&apos;s emailed.
        </div>
      )}

      <ul className="ip-rows">
        {requests.map((r) => (
          <li key={r.id}>
            <div className="ip-row" style={{ cursor: 'default' }}>
              <span className="ip-row-body">
                <span className="ip-row-title">{r.documentName}</span>
                <span className="ip-row-meta">Signed in person</span>
              </span>
            </div>
          </li>
        ))}
      </ul>

      <p className="ip-note">
        {several ? 'The signed copies are' : 'The signed copy is'} saved with {companyName || 'the company'}.
      </p>

      <h2 className="ip-section-title">{several ? 'Email the signed copies' : 'Email a signed copy'}</h2>
      {sentTo ? (
        <p className="ip-note" style={{ marginTop: 0 }}>Sent to {sentTo.join(', ')}.</p>
      ) : (
        <>
          {several && <p className="ip-note" style={{ margin: '0 0 8px' }}>The {requests.length} signed PDFs go in one email.</p>}
          <div className="ip-email-row">
            <Input
              size="large"
              type="email"
              inputMode="email"
              autoCapitalize="off"
              aria-label="Email address"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onPressEnter={send}
              disabled={sending}
            />
            <Button size="large" type="primary" loading={sending} onClick={send}>Send</Button>
          </div>
          {emailError && <div className="ip-alert ip-alert--error" role="alert">{emailError}</div>}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 32 }}>
        <Button size="large" type="primary" onClick={onHandBack}>
          Hand back to {companyName || 'the company'}
        </Button>
      </div>
    </>
  );
};

export default DoneStep;
