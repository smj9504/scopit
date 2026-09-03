/**
 * Scopit - Folder Import Modal
 * Upload a local folder or Google Drive folder to auto-create rooms from subfolders.
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Modal, Button, Checkbox, message, Progress, Tooltip } from 'antd';
import {
  FolderOpenOutlined,
  CloudOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { colors, fonts, borderRadius } from '@/styles/theme';
import type { PhotoRoom, FolderRoom } from './types';
import { fileToResizedBase64, resizeDataUrl, dataUrlToBase64 } from './photoResize';

// ── Constants ────────────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.tiff', '.tif',
]);

const MAX_PHOTOS_PER_ROOM = 6;

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Parse a FileList from webkitdirectory input into grouped room folders.
 * Path format: "ParentFolder/SubFolder/image.jpg"
 * - Index 0 = parent folder (ignored)
 * - Index 1 = subfolder = room name
 * - Files at root level (no subfolder) are skipped
 */
function groupFilesBySubfolder(files: FileList): FolderRoom[] {
  const groups = new Map<string, File[]>();

  for (const file of Array.from(files)) {
    if (!isImageFile(file)) continue;
    const path = (file as any).webkitRelativePath as string;
    if (!path) continue;

    const parts = path.split('/');
    // Need at least 3 parts: parent/subfolder/file
    if (parts.length < 3) continue;

    const roomName = parts[1];
    if (!roomName) continue;

    const existing = groups.get(roomName) || [];
    existing.push(file);
    groups.set(roomName, existing);
  }

  return Array.from(groups.entries())
    .map(([name, files]) => ({ name, files, selected: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Detect floor from room/section name */
function detectFloor(name: string): PhotoRoom['floor'] {
  const lower = name.toLowerCase();
  if (/\bbasement\b|\bbsmt\b|\blower\s*level\b/.test(lower)) return 'basement';
  if (/\b4th|\b4th\s*floor|\bfourth\s*floor|\b5th|\b6th/.test(lower)) return '4th+';
  if (/\b3rd|\b3rd\s*floor|\bthird\s*floor/.test(lower)) return '3rd';
  if (/\b2nd|\b2nd\s*floor|\bsecond\s*floor|\bupstairs\b/.test(lower)) return '2nd';
  if (/\b1st|\b1st\s*floor|\bfirst\s*floor|\bmain\s*(floor|level)\b|\bground\b/.test(lower)) return '1st';
  return '1st';
}

function defaultPhotoRoom(roomName: string): PhotoRoom {
  return {
    id: generateId(),
    room_name: roomName,
    floor: detectFloor(roomName),
    density: 'normal',
    contamination: 'clean',
    photos: [],
    photo_keys: [],
    items: [],
    low_confidence_items: [],
    dismissed_items: [],
    analyzed: false,
    analyzing: false,
    field_notes: [],
    special_items: [],
    custom_special_items: [],
    usePreset: false,
    hints: [],
    hint_volume: {},
    hint_qty: {},
  };
}

function resolveNameCollisions(names: string[], existing: string[]): string[] {
  const used = new Set(existing.map((n) => n.toLowerCase()));
  return names.map((name) => {
    let resolved = name;
    let counter = 2;
    while (used.has(resolved.toLowerCase())) {
      resolved = `${name} (${counter})`;
      counter++;
    }
    used.add(resolved.toLowerCase());
    return resolved;
  });
}

// ── Props ────────────────────────────────────────────────────────────────────

interface FolderImportModalProps {
  open: boolean;
  onClose: () => void;
  onRoomsCreated: (rooms: PhotoRoom[]) => void;
  existingRoomNames: string[];
  // Google Drive integration (optional)
  gDrive?: {
    isAvailable: boolean;
    isAuthenticated: boolean;
    isLoading: boolean;
    authenticate: () => Promise<void>;
    pickFolder: () => Promise<{ name: string; files: { id: string; name: string; mimeType: string }[] }[]>;
    downloadAsBase64: (fileId: string) => Promise<string>;
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export const FolderImportModal: React.FC<FolderImportModalProps> = ({
  open,
  onClose,
  onRoomsCreated,
  existingRoomNames,
  gDrive,
}) => {
  const [folderRooms, setFolderRooms] = useState<(FolderRoom & { _driveFiles?: any[] })[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [rootFileCount, setRootFileCount] = useState(0);
  const [driveMode, setDriveMode] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const selectedRooms = useMemo(() => folderRooms.filter((r) => r.selected), [folderRooms]);
  const getPhotoCount = useCallback((r: typeof folderRooms[0]) => {
    return (r as any)._driveFiles?.length || r.files.length;
  }, []);
  const totalPhotos = useMemo(
    () => selectedRooms.reduce((sum, r) => sum + getPhotoCount(r), 0),
    [selectedRooms, getPhotoCount],
  );
  const oversizedRooms = useMemo(
    () => selectedRooms.filter((r) => getPhotoCount(r) > MAX_PHOTOS_PER_ROOM),
    [selectedRooms, getPhotoCount],
  );

  const handleReset = useCallback(() => {
    setFolderRooms([]);
    setRootFileCount(0);
    setImportProgress({ current: 0, total: 0 });
    setDriveMode(false);
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  // ── Local Folder Selection ───────────────────────────────────────────

  const handleFolderSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const rooms = groupFilesBySubfolder(files);

      // Count root-level photos (those not in subfolders)
      let rootCount = 0;
      for (const file of Array.from(files)) {
        if (!isImageFile(file)) continue;
        const path = (file as any).webkitRelativePath as string;
        if (path && path.split('/').length < 3) rootCount++;
      }

      setRootFileCount(rootCount);
      setFolderRooms(rooms);
      e.target.value = '';
    },
    [],
  );

  const toggleRoom = useCallback((name: string) => {
    setFolderRooms((prev) =>
      prev.map((r) => (r.name === name ? { ...r, selected: !r.selected } : r)),
    );
  }, []);

  // ── Import ───────────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (selectedRooms.length === 0) return;
    setImporting(true);
    setImportProgress({ current: 0, total: selectedRooms.length });

    try {
      const resolvedNames = resolveNameCollisions(
        selectedRooms.map((r) => r.name),
        existingRoomNames,
      );

      const newRooms: PhotoRoom[] = [];
      const failedFiles: string[] = [];

      for (let i = 0; i < selectedRooms.length; i++) {
        const folderRoom = selectedRooms[i] as FolderRoom & { _driveFiles?: any[] };
        setImportProgress({ current: i + 1, total: selectedRooms.length });

        const base64List: string[] = [];

        if (driveMode && folderRoom._driveFiles && gDrive) {
          // Google Drive: download files via Drive API
          const driveFiles = folderRoom._driveFiles.slice(0, MAX_PHOTOS_PER_ROOM);
          for (const df of driveFiles) {
            try {
              const b64 = await gDrive.downloadAsBase64(df.id);
              const resized = await resizeDataUrl(`data:image/jpeg;base64,${b64}`);
              base64List.push(dataUrlToBase64(resized));
            } catch (err) {
              console.error(`Drive download failed for "${df.name}"`, err);
              failedFiles.push(df.name);
            }
          }
        } else {
          // Local folder: read each file one at a time and downscale it
          // immediately. Reading a room's photos concurrently used to hold
          // every original *and* its base64 string in memory at once, which
          // large PNG screenshots could push past what the tab can allocate.
          // Sequential reads keep peak memory at roughly one photo.
          const filesToConvert = folderRoom.files.slice(0, MAX_PHOTOS_PER_ROOM);
          for (const file of filesToConvert) {
            try {
              base64List.push(await fileToResizedBase64(file));
            } catch (err) {
              // One unreadable file must not discard the whole import — the
              // rest of the folder is still perfectly usable. Collect the
              // name so the user learns which file to look at.
              console.error(`Could not read "${file.name}"`, err);
              failedFiles.push(file.name);
            }
          }
        }

        if (base64List.length === 0) continue;

        const room = defaultPhotoRoom(resolvedNames[i]);
        room.photos = base64List;
        newRooms.push(room);
      }

      const failureSummary = (max: number) => {
        const shown = failedFiles.slice(0, max).join(', ');
        const rest = failedFiles.length - Math.min(max, failedFiles.length);
        return rest > 0 ? `${shown} and ${rest} more` : shown;
      };

      if (newRooms.length === 0) {
        message.warning(
          failedFiles.length > 0
            ? `No photos could be imported. Could not read: ${failureSummary(3)}`
            : 'No photos could be imported.',
        );
        return;
      }

      onRoomsCreated(newRooms);
      const roomLabel = `${newRooms.length} room${newRooms.length !== 1 ? 's' : ''}`;
      const source = driveMode ? 'Google Drive' : 'folder';
      if (failedFiles.length > 0) {
        // Partial success: the rooms are usable, but say plainly what was
        // left out so the user isn't left wondering about a missing photo.
        message.warning(
          `Imported ${roomLabel} from ${source}, but skipped ` +
            `${failedFiles.length} photo${failedFiles.length !== 1 ? 's' : ''} ` +
            `that could not be read: ${failureSummary(3)}`,
          8,
        );
      } else {
        message.success(`Imported ${roomLabel} from ${source}`);
      }
      handleClose();
    } catch (err) {
      console.error('Folder import failed', err);
      message.error(
        `Failed to process folder: ${(err as Error)?.message || 'unknown error'}`,
      );
    } finally {
      setImporting(false);
    }
  }, [selectedRooms, existingRoomNames, onRoomsCreated, handleClose, driveMode, gDrive]);

  // ── Source Selection View ────────────────────────────────────────────

  const hasWebkitDirectory = useMemo(
    () => 'webkitdirectory' in document.createElement('input'),
    [],
  );

  const renderSourceSelector = () => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {/* Local Folder */}
      <Tooltip title={!hasWebkitDirectory ? 'Folder upload not supported in this browser' : ''}>
        <div
          onClick={() => hasWebkitDirectory && folderInputRef.current?.click()}
          style={{
            flex: '1 1 200px',
            padding: '24px 16px',
            border: `1.5px dashed ${colors.border}`,
            borderRadius: borderRadius.lg,
            textAlign: 'center',
            cursor: hasWebkitDirectory ? 'pointer' : 'not-allowed',
            opacity: hasWebkitDirectory ? 1 : 0.5,
            background: colors.bgWhite,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!hasWebkitDirectory) return;
            (e.currentTarget as HTMLDivElement).style.borderColor = colors.primary;
            (e.currentTarget as HTMLDivElement).style.background = colors.primary + '06';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = colors.border;
            (e.currentTarget as HTMLDivElement).style.background = colors.bgWhite;
          }}
          role="button"
          tabIndex={hasWebkitDirectory ? 0 : -1}
          onKeyDown={(e) => e.key === 'Enter' && hasWebkitDirectory && folderInputRef.current?.click()}
        >
          <FolderOpenOutlined style={{ fontSize: 28, color: colors.textSecondary, display: 'block', marginBottom: 8 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, fontFamily: fonts.heading }}>
            My Computer
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
            Select a folder from your device
          </div>
        </div>
      </Tooltip>

      {/* Google Drive */}
      <div
        onClick={async () => {
          if (!gDrive?.isAvailable) {
            message.info('Set VITE_GOOGLE_CLIENT_ID to enable Google Drive.');
            return;
          }
          try {
            // Authenticate if needed
            if (!gDrive.isAuthenticated) {
              await gDrive.authenticate();
            }
            // Pick folder and list contents
            const driveRooms = await gDrive.pickFolder();
            if (driveRooms.length === 0) {
              message.warning('No subfolders with images found in selected folder.');
              return;
            }
            // Convert to FolderRoom format (download happens at import time)
            setFolderRooms(
              driveRooms.map((r) => ({
                name: r.name,
                files: [] as File[], // Will use Drive download instead
                selected: true,
                _driveFiles: r.files, // Stash Drive file refs
              })) as any,
            );
            setDriveMode(true);
          } catch (err: any) {
            if (err?.message === 'CANCELLED') return;
            message.error(err?.message || 'Google Drive error');
          }
        }}
        style={{
          flex: '1 1 200px',
          padding: '24px 16px',
          border: `1.5px dashed ${colors.border}`,
          borderRadius: borderRadius.lg,
          textAlign: 'center',
          cursor: gDrive?.isAvailable ? 'pointer' : 'default',
          opacity: gDrive?.isAvailable ? 1 : 0.5,
          background: colors.bgWhite,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (!gDrive?.isAvailable) return;
          (e.currentTarget as HTMLDivElement).style.borderColor = colors.primary;
          (e.currentTarget as HTMLDivElement).style.background = colors.primary + '06';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = colors.border;
          (e.currentTarget as HTMLDivElement).style.background = colors.bgWhite;
        }}
        role="button"
        tabIndex={gDrive?.isAvailable ? 0 : -1}
      >
        {gDrive?.isLoading ? (
          <LoadingOutlined style={{ fontSize: 28, color: colors.textSecondary, display: 'block', marginBottom: 8 }} />
        ) : (
          <CloudOutlined style={{ fontSize: 28, color: colors.textSecondary, display: 'block', marginBottom: 8 }} />
        )}
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, fontFamily: fonts.heading }}>
          Google Drive
        </div>
        <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
          {!gDrive?.isAvailable ? 'Not configured' : gDrive.isAuthenticated ? 'Select a folder' : 'Connect & select folder'}
        </div>
      </div>

      {/* Hidden folder input */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={handleFolderSelected}
      />
    </div>
  );

  // ── Folder Preview View ──────────────────────────────────────────────

  const renderFolderPreview = () => (
    <div>
      {/* Room list */}
      <div
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          overflow: 'hidden',
          maxHeight: 320,
          overflowY: 'auto',
        }}
      >
        {folderRooms.map((room) => (
          <div
            key={room.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderBottom: `1px solid ${colors.border}`,
              background: room.selected ? colors.bgWhite : colors.bgLight,
              opacity: room.selected ? 1 : 0.6,
              transition: 'all 0.15s ease',
            }}
          >
            <Checkbox
              checked={room.selected}
              onChange={() => toggleRoom(room.name)}
              aria-label={`Include ${room.name}`}
            />
            <FolderOpenOutlined style={{ fontSize: 16, color: colors.textMuted, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: colors.textPrimary,
                  fontFamily: fonts.heading,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {room.name}
              </div>
            </div>
            <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.body, flexShrink: 0 }}>
              {getPhotoCount(room)} photo{getPhotoCount(room) !== 1 ? 's' : ''}
            </span>
            {getPhotoCount(room) > MAX_PHOTOS_PER_ROOM && (
              <Tooltip title={`Only first ${MAX_PHOTOS_PER_ROOM} photos will be used for analysis`}>
                <ExclamationCircleOutlined style={{ fontSize: 13, color: colors.warning, flexShrink: 0 }} />
              </Tooltip>
            )}
          </div>
        ))}
        {folderRooms.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No subfolders with images found.
          </div>
        )}
      </div>

      {/* Root file warning */}
      {rootFileCount > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: borderRadius.base,
            fontSize: 12,
            color: '#92400e',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <ExclamationCircleOutlined style={{ flexShrink: 0 }} />
          {rootFileCount} photo{rootFileCount !== 1 ? 's' : ''} at root level will be skipped.
          Move them into a subfolder to include them.
        </div>
      )}

      {/* Oversized rooms warning */}
      {oversizedRooms.length > 0 && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: colors.bgLight,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.base,
            fontSize: 12,
            color: colors.textSecondary,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <ExclamationCircleOutlined style={{ flexShrink: 0 }} />
          {oversizedRooms.length} room{oversizedRooms.length !== 1 ? 's have' : ' has'} more than {MAX_PHOTOS_PER_ROOM} photos.
          Only the first {MAX_PHOTOS_PER_ROOM} will be used for analysis.
        </div>
      )}

      {/* Change folder / clear */}
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          type="link"
          size="small"
          onClick={handleReset}
          style={{ fontSize: 12, color: colors.textMuted, padding: 0 }}
        >
          Choose different folder
        </Button>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────

  const hasFolderPreview = folderRooms.length > 0 || rootFileCount > 0;

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={
        <span style={{ fontFamily: fonts.heading, fontWeight: 700, fontSize: 16 }}>
          Import Rooms from Folder
        </span>
      }
      width={520}
      footer={
        hasFolderPreview ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {selectedRooms.length} room{selectedRooms.length !== 1 ? 's' : ''} · {totalPhotos} photos
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={handleClose}>Cancel</Button>
              <Button
                type="primary"
                onClick={handleImport}
                disabled={selectedRooms.length === 0 || importing}
                loading={importing}
                style={{
                  background: selectedRooms.length > 0 ? colors.primary : undefined,
                  borderColor: selectedRooms.length > 0 ? colors.primary : undefined,
                }}
              >
                {importing
                  ? `Importing... (${importProgress.current}/${importProgress.total})`
                  : `Import ${selectedRooms.length} room${selectedRooms.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        ) : null
      }
      destroyOnHidden
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.body }}>
          Each subfolder becomes a room. Photos inside become that room's photos.
        </div>
      </div>

      {hasFolderPreview ? renderFolderPreview() : renderSourceSelector()}
    </Modal>
  );
};
