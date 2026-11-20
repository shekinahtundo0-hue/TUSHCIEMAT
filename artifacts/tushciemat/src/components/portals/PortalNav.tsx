import { useState } from 'react';
import { Menu, X, LogOut, BookOpen, LayoutDashboard, ClipboardCheck, TrendingUp, Calendar, Megaphone, User, Bell } from 'lucide-react';
import { useSession } from '@/lib/session';
import { signOut } from '@/lib/auth';

interface PortalNavProps {
  portal: 'learn' | 'teach' | 'admin' | 'family';
  currentRoute: string;
  navigate: (path: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  badge?: number;
}

export function PortalNav({ portal, currentRoute, navigate }: PortalNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { me, school } = useSession();

  const navItems: Record<string, NavItem[]> = {
    learn: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} />, path: '/learn' },
      { id: 'learning', label: 'Learning Centre', icon: <BookOpen size={20} />, path: '/learn/learning' },
      { id: 'assignments', label: 'Assignments', icon: <ClipboardCheck size={20} />, path: '/learn/assignments', badge: 0 },
      { id: 'results', label: 'Results', icon: <TrendingUp size={20} />, path: '/learn/results' },
      { id: 'timetable', label: 'Timetable', icon: <Calendar size={20} />, path: '/learn/timetable' },
      { id: 'announcements', label: 'Announcements', icon: <Megaphone size={20} />, path: '/learn/announcements', badge: 0 },
      { id: 'profile', label: 'Profile', icon: <User size={20} />, path: '/learn/profile' },
    ],
    teach: [
      { id: 'classes', label: 'My Classes', icon: <BookOpen size={20} />, path: '/teach' },
      { id: 'attendance', label: 'Attendance', icon: <ClipboardCheck size={20} />, path: '/teach/attendance' },
      { id: 'learners', label: 'Learners', icon: <User size={20} />, path: '/teach/students' },
      { id: 'announcements', label: 'Announcements', icon: <Megaphone size={20} />, path: '/teach/announcements' },
    ],
    admin: [
      { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={20} />, path: '/admin' },
      { id: 'students', label: 'Students', icon: <User size={20} />, path: '/admin/students' },
      { id: 'classes', label: 'Classes', icon: <BookOpen size={20} />, path: '/admin/classes' },
      { id: 'attendance', label: 'Attendance', icon: <ClipboardCheck size={20} />, path: '/admin/attendance' },
      { id: 'timetable', label: 'Timetable', icon: <Calendar size={20} />, path: '/admin/calendar' },
      { id: 'announcements', label: 'Announcements', icon: <Megaphone size={20} />, path: '/admin/announcements' },
    ],
    family: [
      { id: 'children', label: 'My Children', icon: <User size={20} />, path: '/family' },
      { id: 'announcements', label: 'Announcements', icon: <Megaphone size={20} />, path: '/family/announcements' },
    ],
  };

  const items = navItems[portal] || [];

  const handleLogout = async () => {
    await signOut();
  };

  const isActive = (path: string) => currentRoute === path.split('/').pop();

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden md:flex flex-col h-full w-64 bg-gray-900 text-white">
        {/* Header */}
        <div className="p-6 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Learning Portal</h2>
          <p className="text-xs text-gray-400 mt-2">{school?.schoolName}</p>
          <p className="text-sm font-medium text-white mt-3">{me?.fullName}</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <div className="space-y-1 px-3">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  isActive(item.path)
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                {item.icon}
                <span className="flex-1 text-left font-medium">{item.label}</span>
                {item.badge && item.badge > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 space-y-2">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white transition-all"
          >
            <LogOut size={20} />
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </div>

      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between bg-gray-900 text-white p-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-300">Learning Portal</h2>
          <p className="text-xs text-gray-400">{me?.fullName}</p>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 hover:bg-gray-800 rounded-lg"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 top-16 bg-gray-900 text-white z-40 overflow-y-auto">
          <nav className="p-4 space-y-2">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  navigate(item.path);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  isActive(item.path)
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                {item.icon}
                <span className="flex-1 text-left font-medium">{item.label}</span>
                {item.badge && item.badge > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}

            <div className="border-t border-gray-800 pt-4 mt-4">
              <button
                onClick={() => {
                  handleLogout();
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white transition-all"
              >
                <LogOut size={20} />
                <span className="font-medium">Logout</span>
              </button>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
