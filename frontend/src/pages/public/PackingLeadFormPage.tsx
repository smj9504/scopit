/**
 * Scopit - Public Packing Estimate Lead Form
 * Route: /packing-estimate (no authentication required)
 *
 * Anonymous visitor submits contact info + per-room photos. On success,
 * routes to the email-verify step, then the result page which polls for
 * the background AI analysis and gates the full result behind signup.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Input, Upload, App } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { PlusOutlined, DeleteOutlined, CameraOutlined } from '@ant-design/icons';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Seo } from '@/components/Seo';
import { usePageSEO } from '@/hooks/usePageSEO';
import { packingLeadService } from '@/services/packingLeadService';
import { getErrorMessage } from '@/services/api';

const MAX_ROOMS = 10;
const MAX_PHOTOS_PER_ROOM = 10;
const CONTACT_EMAIL = 'hello@scopit.work';

interface RoomEntry {
  key: string;
  name: string;
  files: File[];
}

function newRoom(index: number): RoomEntry {
  return { key: `room-${Date.now()}-${index}`, name: '', files: [] };
}

const PackingLeadFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const isMobile = useIsMobile();

  usePageSEO({
    title: 'Free Packing Estimate | Scopit',
    description:
      'Get a free AI-powered packing estimate. Snap a few room photos, verify your email, and see your estimate — free during beta.',
    path: '/packing-estimate',
  });

  // Generated once per form-load so a double-click submit sends the same key.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [rooms, setRooms] = useState<RoomEntry[]>([newRoom(0)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateRoomName = (key: string, name: string) => {
    setRooms((prev) => prev.map((r) => (r.key === key ? { ...r, name } : r)));
  };

  const updateRoomFiles = (key: string, files: File[]) => {
    setRooms((prev) => prev.map((r) => (r.key === key ? { ...r, files } : r)));
  };

  const addRoom = () => {
    if (rooms.length >= MAX_ROOMS) return;
    setRooms((prev) => [...prev, newRoom(prev.length)]);
  };

  const removeRoom = (key: string) => {
    setRooms((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  };

  const validate = (): string | null => {
    if (!contactEmail.trim()) return 'Please enter your email.';
    const hasAnyPhoto = rooms.some((r) => r.files.length > 0);
    if (!hasAnyPhoto) return 'Please add at least one room photo.';
    const unnamed = rooms.find((r) => r.files.length > 0 && !r.name.trim());
    if (unnamed) return 'Please name every room that has photos.';
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      message.error(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const roomsWithPhotos = rooms.filter((r) => r.files.length > 0);
      const { token } = await packingLeadService.submit({
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim() || null,
        companyName: companyName.trim() || null,
        companyPhone: companyPhone.trim() || null,
        companyAddress: companyAddress.trim() || null,
        propertyAddress: propertyAddress.trim() || null,
        idempotencyKey,
        rooms: roomsWithPhotos.map((r) => ({ roomName: r.name.trim(), photos: r.files })),
      });
      navigate(`/packing-estimate/verify/${token}`);
      // Deliberately not re-enabling `submitting` here — success navigates away.
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      message.error(msg);
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgLight, fontFamily: fonts.body }}>
      <Seo
        title="Free Packing Estimate - Scopit"
        description="Get a free packing estimate for your restoration or moving job. Upload photos and receive a fast, itemized estimate — no account required."
        path="/packing-estimate"
      />
      <header
        style={{
          padding: '20px 24px',
          background: colors.bgWhite,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <span
          style={{
            fontFamily: fonts.heading,
            fontSize: 20,
            fontWeight: 700,
            color: colors.primary,
          }}
        >
          Scopit
        </span>
      </header>

      <main style={{ maxWidth: 640, margin: '0 auto', padding: isMobile ? '32px 16px 64px' : '48px 24px 80px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1
            style={{
              fontFamily: fonts.heading,
              fontSize: isMobile ? 26 : 32,
              fontWeight: 700,
              color: colors.textPrimary,
              margin: 0,
              marginBottom: 8,
            }}
          >
            Get your free packing estimate
          </h1>
          <p style={{ color: colors.textSecondary, fontSize: 15, margin: 0 }}>
            Snap a few photos of each room — our AI does the rest. Free during beta.
          </p>
        </div>

        <div
          style={{
            background: colors.bgWhite,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            padding: isMobile ? 20 : 32,
          }}
        >
          <Form layout="vertical" requiredMark={false}>
            <h3 style={{ fontFamily: fonts.heading, fontSize: 15, fontWeight: 700, color: colors.textPrimary, margin: '0 0 12px' }}>
              Your contact info
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: 16,
                marginBottom: 8,
              }}
            >
              <Form.Item label="Email" required style={{ marginBottom: 8 }}>
                <Input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="jane@example.com"
                  type="email"
                  size="large"
                  autoComplete="email"
                />
              </Form.Item>
              <Form.Item label="Phone (optional)" style={{ marginBottom: 8 }}>
                <Input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  size="large"
                  autoComplete="tel"
                />
              </Form.Item>
            </div>

            <div style={{ height: 1, background: colors.border, margin: '20px 0' }} />

            <h3 style={{ fontFamily: fonts.heading, fontSize: 15, fontWeight: 700, color: colors.textPrimary, margin: '0 0 4px' }}>
              Your company
            </h3>
            <p style={{ fontSize: 13, color: colors.textMuted, margin: '0 0 12px' }}>
              Optional — used to brand your estimate once you create an account.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: 16,
                marginBottom: 8,
              }}
            >
              <Form.Item label="Company name (optional)" style={{ marginBottom: 8 }}>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Restoration"
                  size="large"
                  autoComplete="organization"
                />
              </Form.Item>
              <Form.Item label="Company phone (optional)" style={{ marginBottom: 8 }}>
                <Input
                  value={companyPhone}
                  onChange={(e) => setCompanyPhone(e.target.value)}
                  placeholder="(555) 987-6543"
                  size="large"
                  autoComplete="tel"
                />
              </Form.Item>
              <Form.Item label="Company address (optional)" style={{ marginBottom: 8, gridColumn: isMobile ? undefined : '1 / -1' }}>
                <Input
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder="456 Business Ave, Springfield, IL"
                  size="large"
                  autoComplete="street-address"
                />
              </Form.Item>
            </div>

            <div style={{ height: 1, background: colors.border, margin: '20px 0' }} />

            <h3 style={{ fontFamily: fonts.heading, fontSize: 15, fontWeight: 700, color: colors.textPrimary, margin: '0 0 12px' }}>
              Property
            </h3>
            <Form.Item label="Property address (optional)" style={{ marginBottom: 8 }}>
              <Input
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
                placeholder="123 Main St, Springfield, IL"
                size="large"
                autoComplete="street-address"
              />
            </Form.Item>
          </Form>

          <div style={{ height: 1, background: colors.border, margin: '20px 0' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
              Rooms
            </h3>
            <span style={{ fontSize: 12, color: colors.textMuted }}>Up to {MAX_ROOMS} rooms</span>
          </div>

          <p style={{ fontSize: 13, color: colors.textMuted, margin: '4px 0 16px' }}>
            We keep your photos for 14 days after verification (24 hours if unverified) unless you
            create an account to save your estimate.
          </p>

          {rooms.map((room, idx) => (
            <div
              key={room.key}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                padding: 16,
                marginBottom: 12,
                background: colors.bgLight,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <Input
                  value={room.name}
                  onChange={(e) => updateRoomName(room.key, e.target.value)}
                  placeholder={`Room ${idx + 1} name (e.g. Living Room)`}
                  size="large"
                />
                {rooms.length > 1 && (
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => removeRoom(room.key)}
                    aria-label="Remove room"
                  />
                )}
              </div>

              <Upload
                listType="picture-card"
                accept="image/*"
                multiple
                beforeUpload={(file) => {
                  setRooms((prev) =>
                    prev.map((r) =>
                      r.key === room.key && r.files.length < MAX_PHOTOS_PER_ROOM
                        ? { ...r, files: [...r.files, file] }
                        : r
                    )
                  );
                  return false;
                }}
                fileList={room.files.map(
                  (f, i): UploadFile => ({
                    uid: `${room.key}-${i}`,
                    name: f.name,
                    status: 'done',
                    url: URL.createObjectURL(f),
                  })
                )}
                onRemove={(file) => {
                  const idx2 = room.files.findIndex((_, i) => `${room.key}-${i}` === file.uid);
                  if (idx2 >= 0) {
                    updateRoomFiles(room.key, room.files.filter((_, i) => i !== idx2));
                  }
                }}
              >
                {room.files.length < MAX_PHOTOS_PER_ROOM && (
                  <div>
                    <CameraOutlined style={{ fontSize: 18 }} />
                    <div style={{ marginTop: 8, fontSize: 12 }}>Add photos</div>
                  </div>
                )}
              </Upload>
              <p style={{ fontSize: 12, color: colors.textMuted, margin: '8px 0 0' }}>
                Up to {MAX_PHOTOS_PER_ROOM} photos per room.
              </p>
            </div>
          ))}

          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addRoom}
            disabled={rooms.length >= MAX_ROOMS}
            block
            style={{ marginBottom: 24 }}
          >
            Add another room
          </Button>

          {error && (
            <p style={{ color: colors.error, fontSize: 13, marginBottom: 16 }}>{error}</p>
          )}

          <Button
            type="primary"
            size="large"
            block
            loading={submitting}
            disabled={submitting}
            onClick={handleSubmit}
            style={{ fontWeight: 600, background: colors.primary }}
          >
            Get my estimate
          </Button>
        </div>

        <p style={{ textAlign: 'center', marginTop: 24, color: colors.textSecondary, fontSize: 14 }}>
          Need another one?{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: colors.textPrimary, fontWeight: 600 }}>
            Get in touch
          </a>
        </p>
      </main>
    </div>
  );
};

export default PackingLeadFormPage;
