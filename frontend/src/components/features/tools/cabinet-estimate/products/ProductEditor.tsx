/**
 * ProductEditor
 *
 * Check and save a product: one read off a listing (a draft, its pictures
 * offered to keep) or one already in the library. Pictures on the left —
 * the main one large, the rest to reorder, drop or add (upload or paste
 * with Ctrl+V), and a surface texture for the 3D view — and its facts on
 * the right, the style fields only where they apply to the category.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  ColorPicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { CheckCircleFilled, CloseOutlined, LinkOutlined, PictureOutlined, StarOutlined, UploadOutlined } from '@ant-design/icons';
import { useProductImage } from '@/components/features/tools/cabinet-estimate/products/productImages';
import { productLibraryService } from '@/services/productLibraryService';
import type { Product, ProductDraft, ProductFields, ProductMeta } from '@/types/productLibrary';

/** Categories laid out as tiles, planks or slabs: they have a piece size and may sell by area or box. */
const TILED = new Set(['backsplash', 'floor_tile', 'wall_tile', 'flooring']);
/** Which style choices apply to which categories. */
const STYLE_FIELDS: Record<string, string[]> = {
  door_style: ['cabinet', 'vanity'],
  hardware_style: ['cabinet_hardware'],
  sink_type: ['kitchen_sink'],
  faucet_style: ['kitchen_faucet', 'bath_faucet'],
  pattern: ['backsplash', 'floor_tile', 'wall_tile', 'flooring'],
};
const STYLE_LABELS: Record<string, string> = {
  door_style: 'Door style',
  hardware_style: 'Hardware style',
  sink_type: 'Sink type',
  faucet_style: 'Faucet style',
  pattern: 'Pattern',
};

const words = (key: string) => key.replace(/_/g, ' ');

/** What the form edits: a product's facts, less the specs it carries along untouched. */
type FormValues = Omit<ProductFields, 'specs'>;

const formValues = (f: Partial<ProductFields>): Partial<FormValues> => ({
  category: f.category ?? 'other',
  title: f.title,
  brand: f.brand,
  model_number: f.model_number,
  sku: f.sku,
  finish: f.finish,
  description: f.description,
  retailer: f.retailer,
  source_url: f.source_url,
  price: f.price != null ? Number(f.price) : null,
  price_unit: f.price_unit ?? 'each',
  box_sf: f.box_sf,
  width_in: f.width_in,
  depth_in: f.depth_in,
  height_in: f.height_in,
  tile_width_in: f.tile_width_in,
  tile_length_in: f.tile_length_in,
  look: f.look ?? {},
});

/** A picture added here, not yet uploaded. */
interface LocalImage {
  blob: Blob;
  name: string;
  preview: string;
}

/** One picture in the strip: kept on the server, offered by a draft, or added here. */
type Picture =
  | { kind: 'stored'; id: string }
  | { kind: 'offered'; url: string; keep: boolean }
  | { kind: 'local'; image: LocalImage };

/** A picture of the strip: a stored one comes through the API, the others are at hand. */
const PictureImg: React.FC<{ picture: Picture; style: React.CSSProperties }> = ({ picture, style }) => {
  const stored = useProductImage(picture.kind === 'stored' ? picture.id : null);
  const src = picture.kind === 'stored' ? stored : picture.kind === 'offered' ? picture.url : picture.image.preview;
  return src ? <img src={src} alt="" referrerPolicy="no-referrer" style={style} /> : null;
};

export interface ProductEditorProps {
  open: boolean;
  meta: ProductMeta | undefined;
  /** A product to edit; absent for a new one. */
  product?: Product | null;
  /** What was read off a listing, to start a new product from. */
  draft?: ProductDraft | null;
  onClose: () => void;
  onSaved: (product: Product) => void;
  /** The product was taken out of the library. */
  onArchived?: (product: Product) => void;
}

const ProductEditor: React.FC<ProductEditorProps> = ({ open, meta, product, draft, onClose, onSaved, onArchived }) => {
  const [form] = Form.useForm<FormValues>();
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [swatch, setSwatch] = useState<{ id?: string | null; local?: LocalImage }>({});
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const swatchInput = useRef<HTMLInputElement>(null);
  const storedSwatch = useProductImage(swatch.local ? null : swatch.id);
  const category = Form.useWatch('category', form);
  const priceUnit = Form.useWatch('price_unit', form);
  const sourceUrl = Form.useWatch('source_url', form);

  // Start from the product, or the draft, each time the editor opens.
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (product) {
      form.setFieldsValue(formValues(product));
      setPictures(product.image_file_ids.map((id) => ({ kind: 'stored', id })));
      setSwatch({ id: product.swatch_file_id });
    } else {
      form.setFieldsValue(formValues(draft?.fields ?? {}));
      // The first few offered pictures are kept unless unticked; the rest are there to pick.
      setPictures((draft?.image_urls ?? []).map((url, i) => ({ kind: 'offered', url, keep: i < 4 })));
      setSwatch({});
    }
  }, [open, product, draft, form]);

  const addLocal = (blob: Blob, name: string, asSwatch = false) => {
    const image = { blob, name, preview: URL.createObjectURL(blob) };
    if (asSwatch) setSwatch({ local: image });
    else setPictures((all) => [...all, { kind: 'local', image }]);
  };

  // Ctrl+V of a picture while the editor is open adds it.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const blob = item?.getAsFile();
      if (blob) {
        e.preventDefault();
        addLocal(blob, `pasted.${blob.type.split('/')[1] || 'png'}`);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open]);

  const shown = pictures.filter((p) => p.kind !== 'offered' || p.keep);
  const main = shown[0];

  const makeMain = (p: Picture) => setPictures((all) => [p, ...all.filter((x) => x !== p)]);
  const drop = (p: Picture) =>
    setPictures((all) => (p.kind === 'offered' ? all.map((x) => (x === p ? { ...p, keep: false } : x)) : all.filter((x) => x !== p)));
  const toggleOffered = (p: Picture) =>
    setPictures((all) => all.map((x) => (x === p && p.kind === 'offered' ? { ...p, keep: !p.keep } : x)));

  const categories = meta?.categories ?? [];
  const lookOptions = meta?.look_options ?? {};
  const styleKeys = Object.keys(STYLE_FIELDS).filter((k) => STYLE_FIELDS[k].includes(category));

  const retailerLabel = useMemo(() => {
    if (!sourceUrl) return null;
    try {
      return new URL(sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }, [sourceUrl]);

  const save = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const look = Object.fromEntries(Object.entries(values.look ?? {}).filter(([, v]) => v != null && v !== ''));
      const fields = { ...values, look, specs: product?.specs ?? (draft?.fields?.specs as Record<string, unknown>) ?? {} };
      const stored = pictures.filter((p): p is { kind: 'stored'; id: string } => p.kind === 'stored').map((p) => p.id);
      const offered = pictures.filter((p): p is { kind: 'offered'; url: string; keep: boolean } => p.kind === 'offered' && p.keep).map((p) => p.url);
      let saved = product
        ? await productLibraryService.update(product.id, { ...fields, image_file_ids: stored, image_urls: offered })
        : await productLibraryService.create({ ...fields, image_urls: offered });
      for (const p of pictures) {
        if (p.kind === 'local') saved = await productLibraryService.uploadImage(saved.id, p.image.blob, p.image.name);
      }
      if (swatch.local) saved = await productLibraryService.uploadImage(saved.id, swatch.local.blob, swatch.local.name, true);
      if (offered.length && saved.image_file_ids.length < stored.length + offered.length) {
        message.warning('Some pictures could not be fetched from the retailer; add them by hand if you need them.');
      }
      onSaved(saved);
    } catch (e: any) {
      message.error(e?.response?.data?.detail ?? 'The product could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const thumb = (p: Picture, i: number) => {
    const offered = p.kind === 'offered';
    const kept = !offered || p.keep;
    return (
      <div
        key={i}
        style={{
          position: 'relative',
          width: 64,
          height: 64,
          borderRadius: 6,
          border: `1px solid ${p === main ? '#2563eb' : '#e5e3de'}`,
          background: '#fff',
          opacity: kept ? 1 : 0.45,
          cursor: 'pointer',
        }}
        onClick={() => (offered && !p.keep ? toggleOffered(p) : makeMain(p))}
      >
        <PictureImg picture={p} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6 }} />
        {offered && (
          <CheckCircleFilled
            onClick={(e) => {
              e.stopPropagation();
              toggleOffered(p);
            }}
            style={{ position: 'absolute', top: 3, right: 3, color: p.keep ? '#2563eb' : '#c9c7c2', background: '#fff', borderRadius: 10 }}
          />
        )}
        {!offered && (
          <CloseOutlined
            onClick={(e) => {
              e.stopPropagation();
              drop(p);
            }}
            style={{ position: 'absolute', top: 3, right: 3, fontSize: 10, padding: 2, color: '#374151', background: '#fffd', borderRadius: 8 }}
          />
        )}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      title={product ? 'Edit product' : 'New product'}
      width={980}
      onCancel={onClose}
      destroyOnHidden
      footer={[
        product && (
          <Popconfirm
            key="archive"
            title="Take this product out of the library?"
            description="Estimates that use it keep their copy."
            okText="Remove"
            onConfirm={async () => {
              try {
                await productLibraryService.archive(product.id);
                onArchived?.(product);
              } catch {
                message.error('The product could not be removed');
              }
            }}
          >
            <Button danger style={{ float: 'left' }}>
              Remove from library
            </Button>
          </Popconfirm>
        ),
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={save}>
          Save to library
        </Button>,
      ]}
    >
      {draft?.note && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={draft.note} />}
      <Row gutter={24}>
        <Col xs={24} md={9}>
          <div
            style={{
              aspectRatio: '1 / 1',
              border: '1px solid #e5e3de',
              borderRadius: 8,
              background: '#fafaf8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {main ? (
              <PictureImg picture={main} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <Typography.Text type="secondary" style={{ textAlign: 'center', padding: 16 }}>
                <PictureOutlined style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
                No picture yet — upload one, or paste with Ctrl+V
              </Typography.Text>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {pictures.map(thumb)}
            <Tooltip title="Add a picture (or paste one with Ctrl+V)">
              <Button style={{ width: 64, height: 64 }} icon={<UploadOutlined />} onClick={() => fileInput.current?.click()} />
            </Tooltip>
          </div>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 6 }}>
            Click a picture to make it the main one.
            {pictures.some((p) => p.kind === 'offered') && ' Ticked pictures from the listing are fetched and kept.'}
          </Typography.Paragraph>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              Array.from(e.target.files ?? []).forEach((f) => addLocal(f, f.name));
              e.target.value = '';
            }}
          />

          <Divider style={{ margin: '12px 0' }} />
          <Typography.Text strong style={{ fontSize: 13 }}>
            Surface texture
          </Typography.Text>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '2px 0 6px' }}>
            Optional. A flat, square-on close-up of the tile, stone or wood, laid across surfaces in the 3D view.
          </Typography.Paragraph>
          <Space>
            <div
              style={{ width: 64, height: 64, borderRadius: 6, border: '1px solid #e5e3de', background: '#fafaf8', overflow: 'hidden' }}
            >
              {(swatch.local || storedSwatch) && (
                <img
                  src={swatch.local ? swatch.local.preview : storedSwatch}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
            </div>
            <Button size="small" onClick={() => swatchInput.current?.click()}>
              {swatch.local || swatch.id ? 'Replace' : 'Choose'}
            </Button>
          </Space>
          <input
            ref={swatchInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) addLocal(f, f.name, true);
              e.target.value = '';
            }}
          />
        </Col>

        <Col xs={24} md={15}>
          <Form form={form} layout="vertical" requiredMark={false} size="middle">
            <Row gutter={12}>
              <Col span={10}>
                <Form.Item name="category" label="Category" rules={[{ required: true }]}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={categories.map((c) => ({ value: c.key, label: c.label }))}
                  />
                </Form.Item>
              </Col>
              <Col span={14}>
                <Form.Item name="title" label="Name" rules={[{ required: true, message: 'Give it a name' }]}>
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="brand" label="Brand">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="model_number" label="Model #">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="sku" label="Store item #">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="finish" label="Colour / finish">
                  <Input placeholder="e.g. Brushed Nickel, White Shaker" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="price" label="Price">
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="price_unit" label="Per">
                  <Select options={(meta?.price_units ?? []).map((u) => ({ value: u.key, label: u.label }))} />
                </Form.Item>
              </Col>
            </Row>

            <Typography.Text strong style={{ fontSize: 13 }}>
              Size, inches
            </Typography.Text>
            <Row gutter={12} style={{ marginTop: 4 }}>
              <Col span={6}>
                <Form.Item name="width_in" label="Width">
                  <InputNumber min={0} step={0.25} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="depth_in" label="Depth">
                  <InputNumber min={0} step={0.25} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="height_in" label="Height">
                  <InputNumber min={0} step={0.25} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              {priceUnit === 'box' && (
                <Col span={6}>
                  <Form.Item name="box_sf" label="Sq ft per box">
                    <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              )}
            </Row>
            {TILED.has(category) && (
              <Row gutter={12}>
                <Col span={6}>
                  <Form.Item name="tile_width_in" label="Piece width">
                    <InputNumber min={0} step={0.25} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item name="tile_length_in" label="Piece length">
                    <InputNumber min={0} step={0.25} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            )}

            <Typography.Text strong style={{ fontSize: 13 }}>
              How it looks, for the drawings
            </Typography.Text>
            <Row gutter={12} style={{ marginTop: 4 }}>
              <Col span={6}>
                <Form.Item
                  name={['look', 'color']}
                  label="Colour"
                  getValueFromEvent={(color) => color?.toHexString?.() ?? null}
                >
                  <ColorPicker
                    allowClear
                    format="hex"
                    showText={(color) => (color.cleared ? <span style={{ color: '#a3a19c' }}>Not set</span> : color.toHexString())}
                  />
                </Form.Item>
              </Col>
              <Col span={9}>
                <Form.Item name={['look', 'material']} label="Material">
                  <Select allowClear options={(lookOptions.material ?? []).map((m) => ({ value: m, label: words(m) }))} />
                </Form.Item>
              </Col>
              {styleKeys.map((key) => (
                <Col span={9} key={key}>
                  <Form.Item name={['look', key]} label={STYLE_LABELS[key]}>
                    <Select allowClear options={(lookOptions[key] ?? []).map((m) => ({ value: m, label: words(m) }))} />
                  </Form.Item>
                </Col>
              ))}
              {category === 'kitchen_sink' && (
                <Col span={6}>
                  <Form.Item name={['look', 'bowls']} label="Bowls">
                    <Select allowClear options={[1, 2].map((n) => ({ value: n, label: n }))} />
                  </Form.Item>
                </Col>
              )}
            </Row>

            <Form.Item
              name="source_url"
              label={
                <Space size={6}>
                  Where it's sold
                  {sourceUrl && (
                    <a href={sourceUrl} target="_blank" rel="noreferrer">
                      <LinkOutlined /> {retailerLabel}
                    </a>
                  )}
                </Space>
              }
            >
              <Input placeholder="https://…" />
            </Form.Item>
            <Form.Item name="description" label="Notes">
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
            </Form.Item>
          </Form>
          {!product && (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              <StarOutlined /> Read off the listing — check the size and price before saving; a remodel option is priced from them.
            </Typography.Paragraph>
          )}
        </Col>
      </Row>
    </Modal>
  );
};

export default ProductEditor;
