/**
 * ProductImport
 *
 * The ways to bring a product into the library, best first:
 *
 * - From the retailer's page, with the library's bookmarklet: one click on
 *   a product page sends that page, as the person's browser has it, to the
 *   library (big retailers turn the server's own fetch away; a person's
 *   browser they don't). See useBookmarkletImport for the receiving end.
 * - From a screenshot of the listing (paste with Ctrl+V, or a file):
 *   Claude reads it.
 * - From a link the server fetches: smaller shops and makers' sites.
 * - By hand.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Input, Modal, Row, Space, Spin, Typography, message } from 'antd';
import { CameraOutlined, EditOutlined, LinkOutlined, ShoppingOutlined } from '@ant-design/icons';
import { productLibraryService } from '@/services/productLibraryService';
import type { ProductDraft } from '@/types/productLibrary';

/** What the library's page and the bookmarklet say to each other. */
export const IMPORT_READY = 'mj-product-import-ready';
export const IMPORT_PAGE = 'mj-product-import';
/** First line of a product page copied to the clipboard by the bookmarklet; then its URL, then its HTML. */
export const COPIED_PAGE_MARK = 'scopit-product-page';

/**
 * The bookmarklet: on a product page, opens the library (this app's origin)
 * and, once the library says it is ready, hands it the page's URL and HTML.
 *
 * A shop whose pages send Cross-Origin-Opener-Policy: same-origin cuts the
 * two windows off from each other, and the library never says it's ready.
 * Then a button on the shop's page copies the page to the clipboard, to
 * paste into the library (readCopiedPage).
 */
export function bookmarkletHref(appOrigin: string): string {
  const q = JSON.stringify;
  const code =
    `(()=>{var o=${q(appOrigin)},h=document.documentElement.outerHTML,ok=0,b;if(h.length>5e6)h=h.slice(0,5e6);` +
    `var w=window.open(o+'/app/tools/cabinet_estimate/products?import=1','scopit_product_import');` +
    `addEventListener('message',function f(e){if(e.source===w&&e.data===${q(IMPORT_READY)}){ok=1;if(b)b.remove();` +
    `w.postMessage({type:${q(IMPORT_PAGE)},url:location.href,html:h},o);removeEventListener('message',f)}});` +
    `setTimeout(function(){if(ok)return;b=document.createElement('button');` +
    `b.textContent='Scopit: copy this page, then paste it in Scopit (Ctrl+V)';` +
    `b.style.cssText='position:fixed;z-index:2147483647;top:16px;right:16px;padding:12px 16px;background:#2563eb;color:#fff;border:0;border-radius:8px;font:600 14px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer';` +
    `b.onclick=function(){navigator.clipboard.writeText(${q(COPIED_PAGE_MARK)}+'\\n'+location.href+'\\n'+h).then(function(){b.textContent='Copied. Paste it in Scopit (Ctrl+V)';setTimeout(function(){b.remove()},5000)},function(){b.textContent='Could not copy. Use a screenshot instead'})};` +
    `document.body.appendChild(b)},8000)})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

/** A product page the bookmarklet copied to the clipboard, or null for anything else. */
export function readCopiedPage(text: string): { url: string; html: string } | null {
  // Windows' clipboard turns the line breaks into \r\n.
  const head = /^scopit-product-page\r?\n(https?:\/\/[^\r\n]+)\r?\n/.exec(text);
  return head ? { url: head[1].trim(), html: text.slice(head[0].length) } : null;
}

export interface ProductImportProps {
  open: boolean;
  onClose: () => void;
  /** Something was read: open it in the editor. */
  onDraft: (draft: ProductDraft) => void;
}

const ProductImport: React.FC<ProductImportProps> = ({ open, onClose, onDraft }) => {
  const [url, setUrl] = useState('');
  const [shot, setShot] = useState<{ blob: Blob; preview: string } | null>(null);
  const [shotUrl, setShotUrl] = useState('');
  const [reading, setReading] = useState<'url' | 'shot' | 'page' | null>(null);
  const [blockedNote, setBlockedNote] = useState<string | null>(null);
  const shotInput = useRef<HTMLInputElement>(null);
  const bookmarklet = useRef<HTMLAnchorElement>(null);
  const href = useMemo(() => bookmarkletHref(window.location.origin), []);

  // Set by hand rather than as a prop, which React flags for javascript: links.
  useEffect(() => {
    bookmarklet.current?.setAttribute('href', href);
  });

  useEffect(() => {
    if (!open) return;
    setBlockedNote(null);
    const onPaste = (e: ClipboardEvent) => {
      // A shop's page the bookmarklet copied (when the shop cut the windows off)
      const page = readCopiedPage(e.clipboardData?.getData('text/plain') ?? '');
      if (page) {
        e.preventDefault();
        setReading('page');
        productLibraryService
          .readHtml(page.url, page.html)
          .then(onDraft)
          .catch((err: any) => message.error(err?.response?.data?.detail ?? 'The product page could not be read'))
          .finally(() => setReading(null));
        return;
      }
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const blob = item?.getAsFile();
      if (blob) {
        e.preventDefault();
        setShot({ blob, preview: URL.createObjectURL(blob) });
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, onDraft]);

  const readUrl = async () => {
    if (!url.trim()) return;
    setReading('url');
    setBlockedNote(null);
    try {
      const draft = await productLibraryService.readUrl(url.trim());
      if (draft.blocked) {
        setBlockedNote(draft.note ?? 'The site turned the request away.');
        setShotUrl(url.trim());
      } else {
        onDraft(draft);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail ?? 'The link could not be read');
    } finally {
      setReading(null);
    }
  };

  const readShot = async () => {
    if (!shot) return;
    setReading('shot');
    try {
      const type = shot.blob.type || 'image/png';
      onDraft(await productLibraryService.readScreenshot(shot.blob, `screenshot.${type.split('/')[1] || 'png'}`, shotUrl.trim() || undefined));
    } catch (e: any) {
      message.error(e?.response?.data?.detail ?? 'The screenshot could not be read');
    } finally {
      setReading(null);
    }
  };

  const section = (icon: React.ReactNode, title: string, body: React.ReactNode, recommended = false) => (
    <Card size="small" style={{ height: '100%', borderColor: recommended ? '#91caff' : undefined }}>
      <Space size={8} style={{ marginBottom: 8 }}>
        {icon}
        <Typography.Text strong>{title}</Typography.Text>
        {recommended && <Typography.Text type="secondary" style={{ fontSize: 12 }}>recommended</Typography.Text>}
      </Space>
      {body}
    </Card>
  );

  return (
    <Modal open={open} title="Add a product" width={880} footer={null} onCancel={onClose} destroyOnHidden>
      <Row gutter={[12, 12]}>
        <Col xs={24} md={12}>
          {section(
            <ShoppingOutlined />,
            "From the retailer's page",
            <>
              <ol style={{ paddingLeft: 18, margin: '0 0 10px', color: '#374151', fontSize: 13 }}>
                <li>Drag this button to your browser's bookmarks bar (once).</li>
                <li>Open the product on Home Depot, Lowe's, Wayfair, Floor &amp; Decor, Amazon…</li>
                <li>Click the bookmark: the product opens here, filled in, to check and save.</li>
              </ol>
              <a
                ref={bookmarklet}
                // Replaced by the bookmarklet itself once mounted (see the effect above).
                href="#bookmarklet"
                onClick={(e) => {
                  e.preventDefault();
                  message.info('Drag it to the bookmarks bar, then click it on a product page.');
                }}
                draggable
                style={{
                  display: 'inline-block',
                  padding: '4px 12px',
                  borderRadius: 6,
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'grab',
                }}
              >
                + Scopit product
              </a>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '10px 0 0' }}>
                {reading === 'page' ? (
                  <>
                    <Spin size="small" /> Reading the pasted page…
                  </>
                ) : (
                  <>Some shops keep the two windows apart: the bookmark then puts a “copy this page” button on the shop's page. Click it, come back here and paste (Ctrl+V).</>
                )}
              </Typography.Paragraph>
            </>,
            true
          )}
        </Col>
        <Col xs={24} md={12}>
          {section(
            <CameraOutlined />,
            'From a screenshot',
            <>
              <div
                onClick={() => shotInput.current?.click()}
                style={{
                  height: 96,
                  border: '1px dashed #c9c7c2',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  background: '#fafaf8',
                  overflow: 'hidden',
                  marginBottom: 8,
                }}
              >
                {shot ? (
                  <img src={shot.preview} alt="" style={{ maxHeight: '100%', maxWidth: '100%' }} />
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 13, textAlign: 'center', padding: 8 }}>
                    Paste a screenshot of the listing (Ctrl+V), or click to choose one.
                    <br />
                    Take in the name, price and the size/specifications.
                  </Typography.Text>
                )}
              </div>
              <input
                ref={shotInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setShot({ blob: f, preview: URL.createObjectURL(f) });
                  e.target.value = '';
                }}
              />
              <Space.Compact style={{ width: '100%' }}>
                <Input placeholder="The listing's link (optional)" value={shotUrl} onChange={(e) => setShotUrl(e.target.value)} />
                <Button type="primary" disabled={!shot} loading={reading === 'shot'} onClick={readShot}>
                  Read
                </Button>
              </Space.Compact>
            </>
          )}
        </Col>
        <Col xs={24} md={12}>
          {section(
            <LinkOutlined />,
            'From a link',
            <>
              <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 8 }}>
                Works for many makers' and smaller shops' sites. Big retailers usually turn it away — use the bookmark or a
                screenshot for those.
              </Typography.Paragraph>
              <Space.Compact style={{ width: '100%' }}>
                <Input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onPressEnter={readUrl} />
                <Button loading={reading === 'url'} onClick={readUrl}>
                  Read
                </Button>
              </Space.Compact>
              {blockedNote && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 8 }}
                  message={`${blockedNote}. Use the bookmark on that page, or paste a screenshot of it on the right.`}
                />
              )}
            </>
          )}
        </Col>
        <Col xs={24} md={12}>
          {section(
            <EditOutlined />,
            'By hand',
            <>
              <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 8 }}>
                Type in the name, price and size yourself.
              </Typography.Paragraph>
              <Button onClick={() => onDraft({ fields: {}, image_urls: [], blocked: false })}>Start empty</Button>
            </>
          )}
        </Col>
      </Row>
    </Modal>
  );
};

export default ProductImport;
