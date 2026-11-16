import { useState, useMemo } from 'react';
import { Search, Download, Bookmark, Eye, Filter, X } from 'lucide-react';
import { useListLearningResources, type LearnerSummary } from '@workspace/api-client-react';
import { Card, Input, Select, Button, Badge, Pagination } from '@/components/ui';
import { ResourceCard } from '@/components/portals/student/ResourceCard';

interface LearningCentreProps {
  studentData: LearnerSummary;
}

const RESOURCE_TYPES = ['All', 'PDF', 'Video', 'Document', 'Image', 'Audio', 'Presentation'];
const SORT_OPTIONS = ['Recent', 'Name', 'Size', 'Type'];

export default function LearningCentre({ studentData }: LearningCentreProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('All');
  const [selectedSubject, setSelectedSubject] = useState('All');
  const [sortBy, setSortBy] = useState('Recent');
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState('all');
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set());

  const resources = useListLearningResources({
    query: {
      enabled: true,
      refetchInterval: 60000,
    },
  });

  // Get unique subjects from resources
  const subjects = useMemo(() => {
    if (!resources.data) return [];
    const uniqueSubjects = Array.from(new Set(resources.data.map(r => r.subject)));
    return ['All', ...uniqueSubjects];
  }, [resources.data]);

  // Filter and sort resources
  const filteredResources = useMemo(() => {
    let result = resources.data || [];

    // Text search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(r =>
        r.title.toLowerCase().includes(term) ||
        r.description?.toLowerCase().includes(term)
      );
    }

    // Type filter
    if (selectedType !== 'All') {
      result = result.filter(r => r.resourceType.toUpperCase() === selectedType.toUpperCase());
    }

    // Subject filter
    if (selectedSubject !== 'All') {
      result = result.filter(r => r.subject === selectedSubject);
    }

    // Tab filter
    if (activeTab === 'bookmarked') {
      result = result.filter(r => bookmarked.has(r.id));
    }

    // Sorting
    switch (sortBy) {
      case 'Name':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'Size':
        result.sort((a, b) => (b.fileSizeBytes || 0) - (a.fileSizeBytes || 0));
        break;
      case 'Recent':
      default:
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return result;
  }, [resources.data, searchTerm, selectedType, selectedSubject, sortBy, activeTab, bookmarked]);

  // Pagination
  const itemsPerPage = 12;
  const totalPages = Math.ceil(filteredResources.length / itemsPerPage);
  const paginatedResources = filteredResources.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleBookmark = (resourceId: string) => {
    const newBookmarked = new Set(bookmarked);
    if (newBookmarked.has(resourceId)) {
      newBookmarked.delete(resourceId);
    } else {
      newBookmarked.add(resourceId);
    }
    setBookmarked(newBookmarked);
    // In a real app, this would call an API to persist the bookmark
  };

  const handleDownload = (resource: any) => {
    if (resource.downloadUrl) {
      window.open(resource.downloadUrl, '_blank');
    }
  };

  const handleReset = () => {
    setSearchTerm('');
    setSelectedType('All');
    setSelectedSubject('All');
    setSortBy('Recent');
    setCurrentPage(1);
  };

  const isFiltered = searchTerm || selectedType !== 'All' || selectedSubject !== 'All' || sortBy !== 'Recent';

  return (
    <div className="learning-centre space-y-6">
      {/* Header */}
      <div className="learning-header">
        <h2 className="text-2xl font-bold text-gray-900">Learning Centre</h2>
        <p className="text-gray-600 mt-1">Access all learning materials shared with your class</p>
      </div>

      {/* Search Bar */}
      <div className="search-container">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <Input
            type="text"
            placeholder="Search learning materials..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-10 w-full"
          />
        </div>
      </div>

      {/* Filters */}
      <Card title="Filters" className="filter-card">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
            <Select
              value={selectedSubject}
              onChange={(e) => {
                setSelectedSubject(e.target.value);
                setCurrentPage(1);
              }}
              options={subjects}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
            <Select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                setCurrentPage(1);
              }}
              options={RESOURCE_TYPES}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Sort</label>
            <Select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              options={SORT_OPTIONS}
            />
          </div>
          {isFiltered && (
            <div className="flex items-end">
              <Button
                onClick={handleReset}
                className="flex items-center gap-2 w-full"
              >
                <X size={16} />
                Reset
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Tab Navigation */}
      <Tabs>
        <div className="flex gap-2 border-b">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'all'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            All Materials
          </button>
          <button
            onClick={() => setActiveTab('bookmarked')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'bookmarked'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Bookmarked ({bookmarked.size})
          </button>
        </div>
      </Tabs>

      {/* Resources Grid */}
      {resources.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-gray-500 text-center">
            <div className="animate-spin">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <p className="mt-3">Loading materials...</p>
          </div>
        </div>
      ) : resources.isError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-800">
          <p className="font-semibold">Could not load materials</p>
          <p className="text-sm mt-1">There was an error loading the learning resources. Please try again.</p>
          <Button
            onClick={() => resources.refetch()}
            className="mt-4"
          >
            Retry
          </Button>
        </div>
      ) : paginatedResources.length === 0 ? (
        <div className="bg-gray-50 rounded-lg p-12 text-center">
          <Eye size={48} className="mx-auto text-gray-400 mb-3" />
          <p className="text-gray-900 font-semibold">No materials found</p>
          <p className="text-gray-600 text-sm mt-1">
            {isFiltered ? 'Try adjusting your search or filter criteria.' : 'Materials will appear here once they are shared with your class.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedResources.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                isBookmarked={bookmarked.has(resource.id)}
                onBookmark={() => handleBookmark(resource.id)}
                onDownload={() => handleDownload(resource)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination
              current={currentPage}
              total={totalPages}
              onChange={(page) => {
                setCurrentPage(page);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
