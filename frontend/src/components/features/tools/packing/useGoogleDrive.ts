/**
 * Scopit - Google Drive Integration Hook
 *
 * Manages Google API script loading, OAuth for Drive scope,
 * and folder content enumeration. Keeps everything client-side.
 *
 * Requires VITE_GOOGLE_CLIENT_ID env var.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface DriveFolderRoom {
  name: string;
  files: DriveFile[];
}

export interface UseGoogleDriveReturn {
  /** Whether VITE_GOOGLE_CLIENT_ID is configured */
  isAvailable: boolean;
  /** Scripts loading or auth in progress */
  isLoading: boolean;
  /** Has valid access token */
  isAuthenticated: boolean;
  /** Trigger OAuth popup for Drive scope */
  authenticate: () => Promise<void>;
  /** Drop the access token */
  disconnect: () => void;
  /** Open Google Picker for folder selection, then enumerate subfolders */
  pickFolder: () => Promise<DriveFolderRoom[]>;
  /** Download a file by ID as base64 */
  downloadAsBase64: (fileId: string) => Promise<string>;
  error: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || '';
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';

const IMAGE_MIMETYPES = [
  'image/jpeg', 'image/png', 'image/gif',
  'image/webp', 'image/bmp', 'image/tiff',
  'image/heic', 'image/heif',
];

// ── Script Loader ────────────────────────────────────────────────────────────

let gapiLoadPromise: Promise<void> | null = null;
let gisLoadPromise: Promise<void> | null = null;

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function loadGapiScript(): Promise<void> {
  if (!gapiLoadPromise) {
    gapiLoadPromise = loadScript('https://apis.google.com/js/api.js', 'gapi-script');
  }
  return gapiLoadPromise;
}

function loadGisScript(): Promise<void> {
  if (!gisLoadPromise) {
    gisLoadPromise = loadScript('https://accounts.google.com/gsi/client', 'gis-script');
  }
  return gisLoadPromise;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useGoogleDrive(): UseGoogleDriveReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenClientRef = useRef<any>(null);
  const gapiInited = useRef(false);

  const isAvailable = Boolean(CLIENT_ID);
  const isAuthenticated = Boolean(accessToken);

  // Initialize gapi client
  const initGapi = useCallback(async () => {
    if (gapiInited.current) return;
    await loadGapiScript();

    await new Promise<void>((resolve) => {
      (window as any).gapi.load('client:picker', resolve);
    });

    await (window as any).gapi.client.init({
      apiKey: API_KEY || undefined,
      discoveryDocs: [DISCOVERY_DOC],
    });

    gapiInited.current = true;
  }, []);

  // ── Authenticate ─────────────────────────────────────────────────────

  const authenticate = useCallback(async () => {
    if (!CLIENT_ID) {
      setError('Google Client ID not configured');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await Promise.all([initGapi(), loadGisScript()]);

      await new Promise<void>((resolve, reject) => {
        const google = (window as any).google;
        if (!google?.accounts?.oauth2) {
          reject(new Error('Google Identity Services not loaded'));
          return;
        }

        tokenClientRef.current = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: (response: any) => {
            if (response.error) {
              reject(new Error(response.error));
              return;
            }
            setAccessToken(response.access_token);
            resolve();
          },
          error_callback: (err: any) => {
            reject(new Error(err?.message || 'OAuth failed'));
          },
        });

        tokenClientRef.current.requestAccessToken();
      });
    } catch (err: any) {
      setError(err?.message || 'Google Drive authentication failed');
    } finally {
      setIsLoading(false);
    }
  }, [initGapi]);

  const disconnect = useCallback(() => {
    if (accessToken) {
      const google = (window as any).google;
      google?.accounts?.oauth2?.revoke?.(accessToken);
    }
    setAccessToken(null);
  }, [accessToken]);

  // ── Folder Picking ───────────────────────────────────────────────────

  const pickFolder = useCallback(async (): Promise<DriveFolderRoom[]> => {
    if (!accessToken) throw new Error('Not authenticated');

    const gapi = (window as any).gapi;
    const google = (window as any).google;

    // Open Picker for folder selection
    const folderId = await new Promise<string>((resolve, reject) => {
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS);
      view.setSelectFolderEnabled(true);
      view.setMimeTypes('application/vnd.google-apps.folder');

      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(API_KEY || undefined)
        .setTitle('Select a folder')
        .setCallback((data: any) => {
          if (data.action === google.picker.Action.PICKED) {
            resolve(data.docs[0].id);
          } else if (data.action === google.picker.Action.CANCEL) {
            reject(new Error('CANCELLED'));
          }
        })
        .build();

      picker.setVisible(true);
    });

    // List subfolders in selected folder
    const subfolderResp = await gapi.client.drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      pageSize: 50,
    });

    const subfolders: DriveFile[] = subfolderResp.result.files || [];

    if (subfolders.length === 0) {
      return [];
    }

    // For each subfolder, list image files
    const rooms: DriveFolderRoom[] = [];
    const mimeFilter = IMAGE_MIMETYPES.map((m) => `mimeType='${m}'`).join(' or ');

    for (const folder of subfolders) {
      const filesResp = await gapi.client.drive.files.list({
        q: `'${folder.id}' in parents and (${mimeFilter}) and trashed=false`,
        fields: 'files(id, name, mimeType)',
        pageSize: 20,
      });

      const files: DriveFile[] = filesResp.result.files || [];
      if (files.length > 0) {
        rooms.push({ name: folder.name, files });
      }
    }

    return rooms.sort((a, b) => a.name.localeCompare(b.name));
  }, [accessToken]);

  // ── File Download ────────────────────────────────────────────────────

  const downloadAsBase64 = useCallback(async (fileId: string): Promise<string> => {
    if (!accessToken) throw new Error('Not authenticated');

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, [accessToken]);

  return {
    isAvailable,
    isLoading,
    isAuthenticated,
    authenticate,
    disconnect,
    pickFolder,
    downloadAsBase64,
    error,
  };
}
