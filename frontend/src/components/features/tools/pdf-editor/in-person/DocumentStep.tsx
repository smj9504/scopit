/**
 * What they're signing: one or more of the company's documents that have a
 * signature or initials line, with the customer's own copies on top. Picked
 * documents are signed in the order they're picked.
 */
import React from 'react';
import { Button, Skeleton } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { inPersonApi } from './inPersonApi';
import { ActionBar, LoadError } from './ui';

const DocumentStep: React.FC<{
  customerId?: string;
  selected: string[];
  onSelected: (ids: string[]) => void;
  onContinue: () => void;
}> = ({ customerId, selected, onSelected, onContinue }) => {
  const navigate = useNavigate();
  const documents = useQuery({
    queryKey: ['in-person-documents', customerId ?? null],
    queryFn: () => inPersonApi.listDocuments(customerId),
  });
  const list = documents.data ?? [];

  const toggle = (id: string) => {
    onSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  const count = selected.length;

  return (
    <>
      <h1 className="ip-title">What are they signing?</h1>
      <p className="ip-lead">
        Pick one document, or several to sign in one go. They&apos;re signed in the order you pick them.
      </p>

      {documents.isLoading && <Skeleton active title={false} paragraph={{ rows: 4 }} />}
      {documents.isError && <LoadError what="documents" onRetry={() => documents.refetch()} />}

      {documents.isSuccess && list.length === 0 && (
        <div className="ip-empty">
          <strong>No documents are ready to sign.</strong>
          A document needs a Signature or Initials field first. Open it in the PDF Editor, add its
          fields with Define Fields, then come back here.
          <div style={{ marginTop: 12 }}>
            <Button onClick={() => navigate('/app/tools/pdf_editor')}>Open PDF Editor</Button>
          </div>
        </div>
      )}

      {list.length > 0 && (
        <ul className="ip-rows" role="group" aria-label="Documents">
          {list.map((doc) => {
            const order = selected.indexOf(doc.id);
            const checked = order >= 0;
            const meta = [
              doc.signers.length > 0 ? `Signed by ${doc.signers.join(', ')}` : null,
              `${doc.pageCount} ${doc.pageCount === 1 ? 'page' : 'pages'}`,
            ].filter(Boolean).join(' · ');
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  className="ip-row"
                  onClick={() => toggle(doc.id)}
                >
                  <span className="ip-check" aria-hidden="true">
                    {checked && <span className="ip-order">{order + 1}</span>}
                  </span>
                  <span className="ip-row-body">
                    <span className="ip-row-title">
                      {doc.name}
                      {doc.customerCopy && <span className="ip-tag">Customer&apos;s copy</span>}
                    </span>
                    <span className="ip-row-meta">{meta}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <ActionBar text={count > 1 ? `${count} documents, signed in this order` : undefined}>
        <Button type="primary" size="large" disabled={count === 0} onClick={onContinue}>
          Continue
        </Button>
      </ActionBar>
    </>
  );
};

export default DocumentStep;
