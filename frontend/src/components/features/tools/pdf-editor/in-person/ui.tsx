/**
 * Small pieces the in-person signing steps share.
 */
import React from 'react';
import { Button } from 'antd';

/** Stays at the bottom of the screen, in reach, with the next thing to do */
export const ActionBar: React.FC<{ text?: React.ReactNode; children?: React.ReactNode }> = ({ text, children }) => (
  <div className="ip-actions">
    <div className="ip-actions-inner">
      <div className="ip-actions-text" aria-live="polite">{text}</div>
      {children}
    </div>
  </div>
);

export const LoadError: React.FC<{ what: string; onRetry: () => void }> = ({ what, onRetry }) => (
  <div className="ip-alert ip-alert--error" role="alert">
    Couldn&apos;t load {what}.
    <Button size="small" onClick={onRetry}>Try again</Button>
  </div>
);
