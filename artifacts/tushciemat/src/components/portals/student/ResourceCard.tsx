import { FileText, Download, Bookmark, Eye, File, Music, Image as ImageIcon, Video } from 'lucide-react';
import { formatDate } from '@/lib/api';
import { Button } from '@/components/ui';

interface Resource {
  id: string;
  title: string;
  description?: string;
  resourceType: string;
  subject: string;
  fileSizeBytes?: number;
  downloadUrl?: string;
  createdAt: string;
  fileDownloadable?: boolean;
}

interface ResourceCardProps {
  resource: Resource;
  isBookmarked: boolean;
  onBookmark: () => void;
  onDownload: () => void;
  onView?: () => void;
}

const getResourceIcon = (type: string) => {
  const upperType = type.toUpperCase();
  switch (true) {
    case upperType.includes('VIDEO'):
      return <Video size={32} className="text-red-500" />;
    case upperType.includes('AUDIO'):
    case upperType.includes('MUSIC'):
      return <Music size={32} className="text-purple-500" />;
    case upperType.includes('IMAGE'):
    case upperType.includes('PHOTO'):
      return <ImageIcon size={32} className="text-green-500" />;
    case upperType.includes('PDF'):
      return <FileText size={32} className="text-red-600" />;
    default:
      return <File size={32} className="text-blue-500" />;
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

export function ResourceCard({
  resource,
  isBookmarked,
  onBookmark,
  onDownload,
  onView,
}: ResourceCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow overflow-hidden flex flex-col">
      {/* Resource Header */}
      <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 flex items-start justify-between">
        <div className="flex items-center gap-3 flex-1">
          {getResourceIcon(resource.resourceType)}
          <span className="text-xs font-semibold uppercase text-gray-600 bg-white px-2 py-1 rounded">
            {resource.resourceType}
          </span>
        </div>
        <button
          onClick={onBookmark}
          className={`p-2 rounded-lg transition-colors ${
            isBookmarked
              ? 'bg-yellow-100 text-yellow-600'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Bookmark size={18} fill={isBookmarked ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col">
        <h3 className="font-semibold text-gray-900 line-clamp-2">{resource.title}</h3>
        
        {resource.description && (
          <p className="text-sm text-gray-600 mt-2 line-clamp-3">{resource.description}</p>
        )}

        {/* Meta Information */}
        <div className="mt-4 space-y-2 text-xs text-gray-500">
          <div>
            <span className="font-medium">Subject:</span> {resource.subject}
          </div>
          <div>
            <span className="font-medium">Added:</span> {formatDate(resource.createdAt)}
          </div>
          {resource.fileSizeBytes && (
            <div>
              <span className="font-medium">Size:</span> {formatBytes(resource.fileSizeBytes)}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-gray-200 bg-gray-50 space-y-2">
        {onView && (
          <Button
            onClick={onView}
            className="w-full flex items-center justify-center gap-2 py-2"
          >
            <Eye size={16} />
            View
          </Button>
        )}
        {resource.fileDownloadable && (
          <Button
            onClick={onDownload}
            className="w-full flex items-center justify-center gap-2 py-2"
          >
            <Download size={16} />
            Download
          </Button>
        )}
        {!onView && !resource.fileDownloadable && (
          <p className="text-xs text-gray-500 text-center py-2">
            No actions available
          </p>
        )}
      </div>
    </div>
  );
}
