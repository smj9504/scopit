/**
 * After signing: where the signed documents landed, downloading them, and
 * emailing the customer a copy -- all of a visit's documents in one email.
 */
import React, { useState } from 'react';
import { App, Button, Input } from 'antd';
import { CheckOutlined, DownloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getErrorMessage } from '@/services/api';
import { pdfEditorApi } from '../pdfEditorApi';
import { inPersonApi, type SignedVisit } from './inPersonApi';

const download = async (requestId: string, name: string | null) => {
  const blob = await pdfEditorApi.downloadSignedDocument(requestId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(name || 'document').replace(/\.[^.]+$/, '')}_signed.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const DoneStep: React.FC<{
  result: SignedVisit;
  onStartOver: () => void;
  onExit: () => void;
}> = ({ result, onStartOver, onExit }) => {
  const { message } = App.useApp();
  const [email, setEmail] = useState(result.customerEmail ?? '');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string[] | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

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
      const sent = await inPersonApi.email(requests.map((r) => r.id), emails);
      setSentTo(sent.emails);
      message.success(several ? 'Signed copies sent' : 'Signed copy sent');
    } catch (err) {
      setEmailError(getErrorMessage(err) || "Couldn't send the email. Try again.");
    } finally {
      setSending(false);
    }
  };

  const onDownload = async (id: string, name: string | null) => {
    setDownloading(id);
    try {
      await download(id, name);
    } catch {
      message.error("Couldn't download the signed PDF. Try again.");
    } finally {
      setDownloading(null);
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
            <Link to={`/app/customers/${result.customerId}`}>{result.customerName}</Link>
            {result.customerCreated && <span className="ip-tag">New customer</span>}
          </p>
        </div>
      </div>

      {noPdf.length > 0 && (
        <div className="ip-alert ip-alert--warn" role="alert">
          The signatures are saved, but the signed PDF for {noPdf.map((r) => r.documentName).join(', ')}
          {' '}couldn&apos;t be made yet. It&apos;s made again when you download it.
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
              <Button
                icon={<DownloadOutlined />}
                loading={downloading === r.id}
                onClick={() => onDownload(r.id, r.documentName)}
                aria-label={`Download ${r.documentName ?? 'document'}`}
              >
                PDF
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <p className="ip-note">
        {several ? 'They’re' : 'It’s'} also in the PDF Editor&apos;s Sign Requests and on the customer&apos;s Signatures tab.
      </p>

      <h2 className="ip-section-title">{several ? 'Email the customer copies' : 'Email the customer a copy'}</h2>
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
              placeholder="customer@example.com"
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
        <Button size="large" onClick={onStartOver}>Sign another</Button>
        <Button size="large" type="primary" onClick={onExit}>Done</Button>
      </div>
    </>
  );
};

export default DoneStep;
