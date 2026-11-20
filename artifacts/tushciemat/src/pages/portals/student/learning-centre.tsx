import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  downloadResourceFile,
  previewResourceFile,
  useListLearningResources,
  useListRecentResources,
  useListBookmarkedResources,
  useGetLearningResource,
  useToggleBookmark,
  getListBookmarkedResourcesQueryKey,
  type ResourceType,
} from '@workspace/api-client-react';
import { FileLinks } from '@/components/portals/file-links';
import { apiMessage } from '@/lib/api';
import './learning-centre.css';

const TYPE_OPTIONS: Array<{ value: ResourceType; label: string }> = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'DOCX' },
  { value: 'pptx', label: 'PPTX' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'link', label: 'Link' },
  { value: 'other', label: 'Other' },
];

const RESOURCE_ICONS: Record<string, string> = {
  pdf: '📄', pptx: '🎨', docx: '📝', image: '🖼️', video: '🎥', link: '🔗', other: '📦',
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const LearningCentre = () => {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<ResourceType | 'all'>('all');
  const [activeTab, setActiveTab] = useState<'all' | 'recent' | 'bookmarked'>('all');
  const [page, setPage] = useState(1);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const limit = 12;

  const resourcesQuery = useListLearningResources({
    resourceType: selectedType !== 'all' ? selectedType : undefined,
    limit,
    offset: (page - 1) * limit,
  });
  const recentQuery = useListRecentResources({ limit });
  const bookmarksQuery = useListBookmarkedResources();
  const detail = useGetLearningResource(
    viewingId ?? '',
    { query: { enabled: !!viewingId } },
  );
  const toggleBookmark = useToggleBookmark();

  const bookmarkedIds = new Set((bookmarksQuery.data?.data ?? []).map((b) => b.id));
  const totalPages = Math.ceil((resourcesQuery.data?.total ?? 0) / limit);

  const matchesSearch = (title: string, description: string | null) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return title.toLowerCase().includes(term) || (description ?? '').toLowerCase().includes(term);
  };

  const allResources = (resourcesQuery.data?.data ?? []).filter((r) => matchesSearch(r.title, r.description));
  const recentResources = (recentQuery.data?.data ?? []).filter((r) => matchesSearch(r.title, null));
  const bookmarkedResources = (bookmarksQuery.data?.data ?? []).filter((r) => matchesSearch(r.title, r.description));

  const handleToggleBookmark = (resourceId: string) => {
    toggleBookmark.mutate({ resourceId }, {
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListBookmarkedResourcesQueryKey() }); },
    });
  };

  const renderCard = (resource: { id: string; title: string; description?: string | null; resourceType: ResourceType; createdAt?: Date; fileSizeBytes?: number | null }) => (
    <div key={resource.id} className="resource-card">
      <div className="card-header">
        <span className="icon">{RESOURCE_ICONS[resource.resourceType] ?? '📦'}</span>
        <span className="type-badge">{resource.resourceType.toUpperCase()}</span>
        <button
          className={`bookmark-btn ${bookmarkedIds.has(resource.id) ? 'bookmarked' : ''}`}
          onClick={() => handleToggleBookmark(resource.id)}
          disabled={toggleBookmark.isPending || bookmarksQuery.isLoading || bookmarksQuery.isError}
          title={bookmarkedIds.has(resource.id) ? 'Remove bookmark' : 'Bookmark'}
        >
          {bookmarkedIds.has(resource.id) ? '⭐' : '☆'}
        </button>
      </div>
      <div className="card-body">
        <h3>{resource.title}</h3>
        {resource.description && <p>{resource.description}</p>}
      </div>
      <div className="card-meta">
        {resource.createdAt && <span className="date">Added: {new Date(resource.createdAt).toLocaleDateString()}</span>}
        {resource.fileSizeBytes ? <span className="size">{formatBytes(resource.fileSizeBytes)}</span> : null}
      </div>
      <div className="card-actions">
        <button className="btn btn-primary" onClick={() => setViewingId(resource.id)}>View</button>
      </div>
    </div>
  );

  const activeQuery = activeTab === 'all' ? resourcesQuery : activeTab === 'recent' ? recentQuery : bookmarksQuery;
  const visibleResources = activeTab === 'all' ? allResources : activeTab === 'recent' ? recentResources : bookmarkedResources;

  return (
    <div className="learning-centre">
      <div className="page-header">
        <h1>Learning Centre</h1>
        <p>Access learning materials for your class</p>
      </div>

      <div className="filters-section">
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search materials..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            className="search-input"
          />
        </div>
        <div className="filter-controls">
          <select
            value={selectedType}
            onChange={(e) => { setSelectedType(e.target.value as ResourceType | 'all'); setPage(1); }}
            className="filter-select"
          >
            <option value="all">Type: All</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>Type: {t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => { setActiveTab('all'); setPage(1); }}>
          All Materials
        </button>
        <button className={`tab ${activeTab === 'recent' ? 'active' : ''}`} onClick={() => { setActiveTab('recent'); setPage(1); }}>
          Recent
        </button>
        <button className={`tab ${activeTab === 'bookmarked' ? 'active' : ''}`} onClick={() => { setActiveTab('bookmarked'); setPage(1); }}>
          Bookmarked ({bookmarksQuery.data?.data?.length ?? 0})
        </button>
      </div>

      {toggleBookmark.isError && <p role="alert">{apiMessage(toggleBookmark.error, 'Bookmark could not be updated.')}</p>}
      {bookmarksQuery.isError && <p role="alert">{apiMessage(bookmarksQuery.error, 'Bookmarks could not be loaded.')}</p>}
      <div className="resources-grid">
        {activeQuery.isLoading ? (
          <div className="empty-state"><p>Loading materials…</p></div>
        ) : activeQuery.isError ? (
          <div className="empty-state"><p>{apiMessage(activeQuery.error, 'Materials could not be loaded.')}</p></div>
        ) : visibleResources.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📭</span>
            <p>No materials found</p>
          </div>
        ) : (
          visibleResources.map((resource) => renderCard(resource))
        )}
      </div>

      {activeTab === 'all' && totalPages > 1 && (
        <div className="pagination">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="pagination-btn">← Previous</button>
          <span className="page-info">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="pagination-btn">Next →</button>
        </div>
      )}

      {viewingId && (
        <div className="resource-detail-panel" style={{ marginTop: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
          {detail.isLoading ? (
            <p>Loading resource…</p>
          ) : detail.isError || !detail.data ? (
            <p>{apiMessage(detail.error, 'Resource could not be loaded.')}</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>{detail.data.title}</h2>
                <button className="btn" onClick={() => setViewingId(null)}>✕ Close</button>
              </div>
              {detail.data.description && <p>{detail.data.description}</p>}
              {detail.data.learningObjectives.length > 0 && (
                <>
                  <h4>Learning Objectives</h4>
                  <ul>
                    {detail.data.learningObjectives.map((objective, idx) => <li key={idx}>{objective}</li>)}
                  </ul>
                </>
              )}
              {detail.data.files.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <h4>Files</h4>
                  <FileLinks files={detail.data.files} testId={`resource-${detail.data.id}`}
                    link={(fileId, mode) => (mode === 'preview'
                      ? previewResourceFile(viewingId, fileId)
                      : downloadResourceFile(viewingId, fileId))} />
                  <p style={{ color: '#6b7280', fontSize: 12 }}>These are the files your teacher shared with your class, so downloads are limited to this material.</p>
                </div>
              ) : (
                <p style={{ color: '#6b7280', fontSize: 13 }}>This material has no file attached yet.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};