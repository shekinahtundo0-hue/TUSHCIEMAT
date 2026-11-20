import { useState } from 'react';
import { Download, Eye, LoaderCircle, Paperclip } from 'lucide-react';
import type { FileDownload, StoredFile } from '@workspace/api-client-react';
import { apiMessage } from '@/lib/api';
import { extensionOf, formatBytes, openFileUrl } from '@/lib/uploads';
import './file-links.css';

const PREVIEWABLE = ['pdf', 'jpg', 'jpeg', 'png'];

export function isPreviewableFile(file: StoredFile): boolean {
  return PREVIEWABLE.includes(extensionOf(file.name)) || file.type.startsWith('image/') || file.type === 'application/pdf';
}

/**
 * Every link is minted by the API at click time, so a broken permission or a missing object
 * shows a real message instead of opening an empty tab.
 */
export function FileLinks({ files, link, allowPreview = true, testId, emptyLabel = 'No files attached' }: {
  files: StoredFile[];
  link: (fileId: string, mode: 'download' | 'preview') => Promise<FileDownload>;
  /** Only where the API can hand back an inline link. */
  allowPreview?: boolean;
  testId?: string;
  emptyLabel?: string;
}) {
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState('');

  async function open(file: StoredFile, mode: 'download' | 'preview') {
    setNotice('');
    setPending(`${file.id}:${mode}`);
    try {
      const grant = await link(file.id, mode);
      openFileUrl(grant.url, mode === 'preview');
    } catch (error) {
      setNotice(apiMessage(error, `${file.name} could not be opened. Please try again.`));
    } finally {
      setPending('');
    }
  }

  if (!files.length) return <p className="file-link-empty"><Paperclip size={13} /> {emptyLabel}</p>;
  return <ul className="file-links" data-testid={testId}>
    {files.map((file) => <li key={file.id} className="file-link">
      <span className="file-link-name" title={file.name}>{file.name}</span>
      <span className="file-link-size">{formatBytes(file.size)}</span>
      {allowPreview && isPreviewableFile(file) && <button type="button" className="file-link-action" disabled={pending !== ''}
        onClick={() => { void open(file, 'preview'); }} aria-label={`Preview ${file.name}`} data-testid={`${testId ? `${testId}-` : 'file'}preview-${file.id}`}>
        {pending === `${file.id}:preview` ? <LoaderCircle size={14} className="subtle-spin" /> : <Eye size={14} />}<span>Preview</span></button>}
      <button type="button" className="file-link-action" disabled={pending !== ''}
        onClick={() => { void open(file, 'download'); }} aria-label={`Download ${file.name}`} data-testid={`${testId ? `${testId}-` : 'file'}download-${file.id}`}>
        {pending === `${file.id}:download` ? <LoaderCircle size={14} className="subtle-spin" /> : <Download size={14} />}<span>Download</span></button>
    </li>)}
    {notice && <li className="file-link-error" role="alert">{notice}</li>}
  </ul>;
}
