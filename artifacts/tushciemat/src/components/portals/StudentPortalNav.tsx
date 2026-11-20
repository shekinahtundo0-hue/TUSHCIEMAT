import { useLocation } from 'wouter';
import './portal-nav.css';

interface StudentPortalNavProps {
  currentPath: string;
}

export const StudentPortalNav = ({ currentPath }: StudentPortalNavProps) => {
  const [, navigate] = useLocation();

  const navItems = [
    { path: '/learn', label: '🏠 Dashboard', icon: '🏠' },
    { path: '/learn/learning', label: '📚 My Learning', icon: '📚' },
    { path: '/learn/assignments', label: '✏️ Assignments', icon: '✏️' },
    { path: '/learn/results', label: '📈 Results', icon: '📈' },
    { path: '/learn/timetable', label: '📅 Timetable', icon: '📅' },
    { path: '/learn/announcements', label: '📢 Announcements', icon: '📢' },
    { path: '/learn/profile', label: '👤 Profile', icon: '👤' },
  ];

  return (
    <nav className="portal-nav student-portal-nav">
      <div className="nav-header">
        <h3>📖 My Learning</h3>
      </div>

      <ul className="nav-list">
        {navItems.map(item => (
          <li key={item.path}>
            <button
              className={`nav-link ${currentPath === item.path ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
              title={item.label}
            >
              <span className="icon">{item.icon}</span>
              <span className="label">{item.label.split(' ').pop()}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="nav-footer">
        <button className="logout-btn" onClick={() => navigate('/sign-in')}>
          🚪 Logout
        </button>
      </div>
    </nav>
  );
};
