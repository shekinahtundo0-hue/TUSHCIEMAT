import { useState } from 'react';
import './portal-nav.css';

interface Child {
  studentId: string;
  firstName: string;
  lastName: string;
  className: string;
}

interface FamilyPortalNavProps {
  selectedChildId: string | null;
  linkedChildren: Child[];
  onChildChange: (childId: string) => void;
  onNavigate: (path: string) => void;
}

export const FamilyPortalNav = ({
  selectedChildId,
  linkedChildren,
  onChildChange,
  onNavigate,
}: FamilyPortalNavProps) => {
  const [showChildSelector, setShowChildSelector] = useState(false);

  const selectedChild = linkedChildren.find(c => c.studentId === selectedChildId);

  const navItems = [
    { path: '/family', label: '🏠 Dashboard', id: 'dashboard' },
    { path: '/family/academic', label: '📊 Academics', id: 'academic' },
    { path: '/family/attendance', label: '📋 Attendance', id: 'attendance' },
    { path: '/family/assignments', label: '✏️ Assignments', id: 'assignments' },
    { path: '/family/communications', label: '📢 Communications', id: 'communications' },
    { path: '/family/children', label: '👨‍👩‍👧‍👦 My Children', id: 'children' },
  ];

  return (
    <nav className="portal-nav family-portal-nav">
      <div className="nav-header">
        <h3>👨‍👩‍👧 Family Portal</h3>
      </div>

      {/* Child Selector */}
      <div className="child-selector-section">
        <button
          className="child-selector-btn"
          onClick={() => setShowChildSelector(!showChildSelector)}
        >
          <span className="child-icon">👤</span>
          <span className="child-name">
            {selectedChild?.firstName || 'Select Child'}
          </span>
          <span className="toggle-icon">▼</span>
        </button>

        {showChildSelector && (
          <div className="child-dropdown">
            {linkedChildren.map(child => (
              <button
                key={child.studentId}
                className={`child-option ${child.studentId === selectedChildId ? 'selected' : ''}`}
                onClick={() => {
                  onChildChange(child.studentId);
                  setShowChildSelector(false);
                }}
              >
                <span>{child.firstName} {child.lastName}</span>
                <span className="class-label">{child.className}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Navigation */}
      <ul className="nav-list">
        {navItems.map(item => (
          <li key={item.id}>
            <button
              className="nav-link"
              onClick={() => {
                onNavigate(item.path);
              }}
              title={item.label}
            >
              <span className="icon">{item.label.split(' ')[0]}</span>
              <span className="label">{item.label.split(' ').slice(1).join(' ')}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="nav-footer">
        <button className="logout-btn" onClick={() => window.location.href = '/sign-in'}>
          🚪 Logout
        </button>
      </div>
    </nav>
  );
};
