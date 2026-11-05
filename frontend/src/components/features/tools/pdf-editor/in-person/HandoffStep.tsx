/**
 * The employee's last step: handing the device to the signer. Handing over
 * signs the employee out on this device, so while the signer has it they can
 * only read and sign this visit's documents, with the details as entered;
 * getting back into Scopit takes the employee's sign-in.
 */
import React from 'react';
import { Button } from 'antd';
import { ActionBar } from './ui';

const HandoffStep: React.FC<{
  customerName: string;
  documentNames: string[];
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onHandOver: () => void;
}> = ({ customerName, documentNames, busy, error, onBack, onHandOver }) => {
  const what = documentNames.length === 1 ? documentNames[0] : `${documentNames.length} documents`;
  return (
    <>
      <h1 className="ip-title">Hand over the device</h1>
      <p className="ip-lead">
        {customerName || 'The signer'} reads and signs {what} on this device.
      </p>
      <div className="ip-panel">
        <p className="ip-note" style={{ marginTop: 0 }}>
          Handing over signs you out of Scopit on this device. While they have it, they can only
          read and sign these documents, and the details you entered can&apos;t be changed.
        </p>
        <p className="ip-note">
          When they&apos;re done, they tap <strong>Hand back</strong> and you sign in again.
        </p>
      </div>
      {error && <div className="ip-alert ip-alert--error" role="alert">{error}</div>}
      <ActionBar>
        <Button size="large" disabled={busy} onClick={onBack}>Back</Button>
        <Button type="primary" size="large" loading={busy} onClick={onHandOver}>
          Hand over
        </Button>
      </ActionBar>
    </>
  );
};

export default HandoffStep;
