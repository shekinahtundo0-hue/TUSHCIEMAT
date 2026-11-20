import type { FileDeclaration, StoredFileInput, UploadTarget } from '@workspace/api-client-react';

export const MAX_UPLOAD_FILES = 10;
/** Only used to size the copy before the server answers with its own ceiling. */
export const FALLBACK_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const KNOWN_UPLOAD_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png'];
export const ACCEPT_ATTRIBUTE = KNOWN_UPLOAD_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export type PendingUpload = {
  key: string;
  name: string;
  size: number;
  progress: number;
  state: 'uploading' | 'stored' | 'failed';
  error?: string;
  stored?: StoredFileInput;
};

/** Thrown when the learner or teacher cancels a transfer. */
export class UploadAborted extends Error {}

export function isUploadAborted(error: unknown): boolean {
  return error instanceof UploadAborted || (error instanceof DOMException && error.name === 'AbortError');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Instant feedback for picks the API would reject anyway. The server repeats every check. */
export function pickRejection(file: File, allowedTypes: string[], maxFileBytes: number): string | null {
  const extension = extensionOf(file.name);
  const allowed = allowedTypes.length ? allowedTypes : KNOWN_UPLOAD_EXTENSIONS;
  if (!allowed.includes(extension)) {
    return `“${file.name}” is not a supported format. Use ${allowed.join(', ').toUpperCase()}.`;
  }
  if (file.size === 0) return `“${file.name}” is empty. Choose a file with content.`;
  if (file.size > maxFileBytes) return `“${file.name}” is larger than ${formatBytes(maxFileBytes)}.`;
  return null;
}

export function declarationOf(file: File): FileDeclaration {
  return { name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
}

/** The metadata the API confirms against storage before it records the file. */
export function storedOf(target: UploadTarget): StoredFileInput {
  return { id: target.id, path: target.path, name: target.name, size: target.size, type: target.type };
}

/**
 * Streams the bytes straight to storage with progress reporting, which fetch cannot do.
 * The API only ever hands out single-object, short-lived URLs.
 */
export function putToStorage(
  target: UploadTarget,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new UploadAborted());
      return;
    }
    const request = new XMLHttpRequest();
    request.open('PUT', target.uploadUrl, true);
    Object.entries(target.headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error('The file service refused the upload. Please try again.'));
      }
    });
    request.addEventListener('error', () => reject(new Error('The upload could not reach the file service. Check your connection.')));
    request.addEventListener('timeout', () => reject(new Error('The upload timed out. Please try again.')));
    request.addEventListener('abort', () => reject(new UploadAborted()));
    signal.addEventListener('abort', () => request.abort(), { once: true });
    request.send(file);
  });
}

/** Opens the signed URL the API authorised. The link itself is what carries the permission. */
export function openFileUrl(url: string, inline: boolean): void {
  if (inline) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
