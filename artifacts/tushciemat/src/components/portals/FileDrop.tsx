import { useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import type { FileDeclaration, StoredFileInput, UploadTarget } from '@workspace/api-client-react';
import { apiMessage, apiStatus } from '@/lib/api';
import {
  ACCEPT_ATTRIBUTE, FALLBACK_MAX_FILE_BYTES, KNOWN_UPLOAD_EXTENSIONS, MAX_UPLOAD_FILES, declarationOf, formatBytes,
  isUploadAborted, pickRejection, putToStorage, storedOf, type PendingUpload,
} from '@/lib/uploads';
import './file-drop.css';

type TargetResponse = { data: UploadTarget[]; maxFileBytes: number; allowedTypes: string[] };

type Props = {
  /** Mints the single-use upload URLs. Each screen decides which endpoint owns its files. */
  getTargets: (files: FileDeclaration[]) => Promise<TargetResponse>;
  /** The complete attachment set for the record, including files stored on an earlier visit. */
  value: StoredFileInput[];
  onChange: (files: StoredFileInput[]) => void;
  maxFiles?: number;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  testId?: string;
  /** Formats the record will accept (e.g. an assignment's allowedFileTypes), so a wrong pick is refused before any bytes move. */
  allowedExtensions?: string[];
};

const STORAGE_NOTICE = 'File storage is not connected for this school yet, so attachments cannot be uploaded. Ask your school administrator to connect storage.';

export function FileDrop({ getTargets, value, onChange, maxFiles = MAX_UPLOAD_FILES, disabled = false, onBusyChange, testId, allowedExtensions }: Props) {
  const restriction = allowedExtensions?.length ? allowedExtensions : null;
  const inputId = useId();
  const [rows, setRows] = useState<PendingUpload[]>([]);
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const files = useRef(new Map<string, File>());
  const controllers = useRef(new Map<string, AbortController>());
  const limits = useRef({ maxFileBytes: FALLBACK_MAX_FILE_BYTES, allowedTypes: KNOWN_UPLOAD_EXTENSIONS });
  const listed = useRef(value);
  listed.current = value;
  const seeded = useRef<Set<string> | null>(null);
  if (!seeded.current) seeded.current = new Set(value.map((file) => file.id));

  const busy = rows.some((row) => row.state === 'uploading');
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const patch = (key: string, changes: Partial<PendingUpload>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  };

  function discard(key: string) {
    files.current.delete(key);
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    setRows((current) => current.filter((row) => row.key !== key));
  }

  async function uploadOne(key: string, file: File, target: UploadTarget) {
    const controller = new AbortController();
    controllers.current.set(key, controller);
    patch(key, { state: 'uploading', progress: 0, error: undefined });
    try {
      await putToStorage(target, file, (progress) => patch(key, { progress }), controller.signal);
      const stored = storedOf(target);
      listed.current = [...listed.current, stored];
      onChange(listed.current);
      patch(key, { state: 'stored', progress: 100, stored });
    } catch (error) {
      if (isUploadAborted(error)) {
        discard(key);
        return;
      }
      patch(key, {
        state: 'failed',
        error: error instanceof Error ? error.message : 'The upload could not be completed.',
      });
    } finally {
      controllers.current.delete(key);
    }
  }

  async function mintTargets(picked: File[]): Promise<UploadTarget[] | null> {
    try {
      const response = await getTargets(picked.map(declarationOf));
      limits.current = { maxFileBytes: response.maxFileBytes, allowedTypes: response.allowedTypes };
      return response.data;
    } catch (error) {
      // The API validates the whole batch, so nothing was stored. Flag the transfers for retry.
      const message = apiStatus(error) === 503 ? STORAGE_NOTICE : apiMessage(error, 'Upload links could not be prepared.');
      setRows((current) => current.map((row) => (row.state === 'uploading' ? { ...row, state: 'failed', error: message } : row)));
      setNotice(message);
      return null;
    }
  }

  async function accept(picked: File[]) {
    setNotice('');
    if (!picked.length) return;
    const room = Math.max(0, maxFiles - listed.current.length);
    if (room === 0) {
      setNotice(`Attach up to ${maxFiles} files.`);
      return;
    }
    const queue: Array<{ key: string; file: File }> = [];
    const rejected: PendingUpload[] = [];
    const allowed = restriction ?? limits.current.allowedTypes;
    picked.slice(0, room).forEach((file) => {
      const problem = pickRejection(file, allowed, limits.current.maxFileBytes);
      if (problem) {
        rejected.push({ key: crypto.randomUUID(), name: file.name, size: file.size, progress: 0, state: 'failed', error: problem });
        return;
      }
      const key = crypto.randomUUID();
      files.current.set(key, file);
      queue.push({ key, file });
    });
    if (picked.length > room) setNotice(`Only ${room} more file${room === 1 ? '' : 's'} fit here. Remove one and add the rest again.`);
    setRows((current) => [
      ...current,
      ...rejected,
      ...queue.map(({ key, file }) => ({ key, name: file.name, size: file.size, progress: 0, state: 'uploading' as const })),
    ]);
    if (!queue.length) return;

    const targets = await mintTargets(queue.map((entry) => entry.file));
    if (!targets) return;
    // One transfer at a time keeps the progress honest and each request cancellable.
    for (const [index, entry] of queue.entries()) {
      const target = targets[index] ?? targets[0];
      if (target) await uploadOne(entry.key, entry.file, target);
    }
  }

  async function retry(key: string) {
    const file = files.current.get(key);
    if (!file) return;
    setNotice('');
    const targets = await mintTargets([file]);
    const target = targets?.[0];
    if (target) await uploadOne(key, file, target);
  }

  function remove(id: string) {
    listed.current = listed.current.filter((file) => file.id !== id);
    onChange(listed.current);
    setRows((current) => current.filter((row) => row.stored?.id !== id));
  }

  const rowIds = new Set(rows.map((row) => row.stored?.id));

  return <div className="file-drop" data-testid={testId}>
    <div
      className={`file-drop-zone ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}
      onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (disabled) return;
        void accept(Array.from(event.dataTransfer.files));
      }}
    >
      <Upload size={19} />
      <p><b>Drag files here</b> or choose them from this device</p>
      <small>{(restriction ?? KNOWN_UPLOAD_EXTENSIONS).map((extension) => extension.toUpperCase()).join(', ')} · up to {maxFiles} files · {formatBytes(limits.current.maxFileBytes)} each</small>
      <button type="button" className="file-drop-pick" disabled={disabled} onClick={() => inputRef.current?.click()}>Choose files</button>
      <input ref={inputRef} id={inputId} type="file" multiple accept={restriction ? restriction.map((extension) => `.${extension}`).join(',') : ACCEPT_ATTRIBUTE} disabled={disabled} className="sr-only"
        onChange={(event) => {
          const picked = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void accept(picked);
        }} />
    </div>

    {notice && <p className="form-error" role="alert">{notice}</p>}

    {(rows.length > 0 || value.length > 0) && <ul className="file-drop-list">
      {value.filter((file) => !rowIds.has(file.id)).map((file) => <li key={file.id} className="file-row is-stored">
        <Check size={15} />
        <span className="file-row-name">{file.name}</span>
        <span className="file-row-size">{formatBytes(file.size)}</span>
        <span className="file-row-state">{seeded.current?.has(file.id) ? 'Already attached' : 'Uploaded'}</span>
        <button type="button" className="file-row-action" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={() => remove(file.id)}><Trash2 size={14} /></button>
      </li>)}
      {rows.map((row) => <li key={row.key} className={`file-row is-${row.state}`}>
        {row.state === 'uploading' ? <LoaderCircle size={15} className="subtle-spin" /> : row.state === 'failed' ? <X size={15} /> : <Check size={15} />}
        <span className="file-row-name">{row.name}</span>
        <span className="file-row-size">{formatBytes(row.size)}</span>
        {row.state === 'uploading' && <>
          <span className="file-row-bar"><i style={{ width: `${row.progress}%` }} /></span>
          <span className="file-row-state">{row.progress}%</span>
          <button type="button" className="file-row-action" aria-label={`Cancel ${row.name}`} onClick={() => discard(row.key)}><X size={14} /></button>
        </>}
        {row.state === 'stored' && <span className="file-row-state">Uploaded</span>}
        {row.state === 'failed' && <>
          <span className="file-row-error" role="alert">{row.error}</span>
          <button type="button" className="file-row-action" disabled={disabled} aria-label={`Retry ${row.name}`} onClick={() => { void retry(row.key); }}><RefreshCw size={14} /></button>
          <button type="button" className="file-row-action" aria-label={`Remove ${row.name}`} onClick={() => discard(row.key)}><Trash2 size={14} /></button>
        </>}
      </li>)}
    </ul>}
  </div>;
}
