import { useState } from 'react';
import { Eye, EyeOff, Download, User, Mail, Phone, MapPin, Building, Shield } from 'lucide-react';
import { type LearnerSummary } from '@workspace/api-client-react';
import { Card, Button } from '@/components/ui';
import { formatDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSession } from '@/lib/session';

interface ProfileProps {
  studentData: LearnerSummary;
}

export default function Profile({ studentData }: ProfileProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { user } = useAuth();
  const { school } = useSession();

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'All fields are required' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    if (newPassword.length < 8) {
      setPasswordMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }

    setIsChangingPassword(true);
    try {
      // In a real app, this would call an API to change the password
      await new Promise(resolve => setTimeout(resolve, 1000));
      setPasswordMessage({ type: 'success', text: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordMessage({ type: 'error', text: 'Failed to change password. Please try again.' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDownloadRecords = () => {
    // In a real app, this would trigger a download of academic records
    const content = `
ACADEMIC RECORD - ${studentData.firstName} ${studentData.lastName}
========================================================

Personal Information:
- Admission Number: ${studentData.admissionNumber}
- Name: ${studentData.firstName} ${studentData.lastName}
- Class: ${studentData.className}
- School: ${school?.schoolName}

Attendance Summary:
- Present: ${studentData.attendance.present}
- Late: ${studentData.attendance.late}
- Absent: ${studentData.attendance.absent}
- Excused: ${studentData.attendance.excused}
- Since: ${formatDate(new Date(studentData.attendance.sinceDate))}

Generated: ${new Date().toLocaleString()}
    `;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `academic-record-${studentData.admissionNumber}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return (
    <div className="profile-container space-y-6">
      {/* Header */}
      <div className="profile-header">
        <h2 className="text-2xl font-bold text-gray-900">Profile</h2>
        <p className="text-gray-600 mt-1">Manage your personal information and account settings</p>
      </div>

      {/* Personal Information Card */}
      <Card title="Personal Information" icon={User} className="personal-info-card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">First Name</label>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-300 text-gray-900 font-medium">
              {studentData.firstName}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Last Name</label>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-300 text-gray-900 font-medium">
              {studentData.lastName}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-300 text-gray-900 font-medium flex items-center gap-2">
              <Mail size={16} className="text-gray-500" />
              {user?.email || '—'}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-300 text-gray-900 font-medium flex items-center gap-2">
              <Phone size={16} className="text-gray-500" />
              {studentData.phone || '—'}
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-4">
          Contact your school office to update personal information.
        </p>
      </Card>

      {/* Academic Identity Card */}
      <Card title="Academic Identity" icon={Building} className="academic-identity-card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Admission Number</label>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-300 text-gray-900 font-medium">
              {studentData.admissionNumber}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Class</label>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-300 text-gray-900 font-medium">
              {studentData.className || '—'}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">School</label>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-300 text-gray-900 font-medium flex items-center gap-2">
              <Building size={16} className="text-gray-500" />
              {school?.schoolName || '—'}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <div className="px-4 py-3 bg-green-50 rounded-lg border border-green-300 text-green-900 font-medium">
              {studentData.status || 'Active'}
            </div>
          </div>
        </div>
      </Card>

      {/* Contact Information Card */}
      <Card title="Contact Information" icon={Mail} className="contact-info-card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-300 text-gray-900">
              {user?.email}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-300 text-gray-900">
              {studentData.phone || '—'}
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-4">
          These contact details are used for official school communications.
        </p>
      </Card>

      {/* Account Settings Card */}
      <Card title="Account Settings" icon={Shield} className="account-settings-card">
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Change Password</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter your current password"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min. 8 characters)"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-900"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              {passwordMessage && (
                <div
                  className={`p-3 rounded-lg ${
                    passwordMessage.type === 'success'
                      ? 'bg-green-50 text-green-800 border border-green-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {passwordMessage.text}
                </div>
              )}

              <Button
                onClick={handleChangePassword}
                disabled={isChangingPassword}
                className="w-full"
              >
                {isChangingPassword ? 'Changing Password...' : 'Change Password'}
              </Button>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="font-semibold text-gray-900 mb-3">Two-Factor Authentication</h3>
            <p className="text-gray-600 text-sm mb-3">
              Enhance your account security by enabling two-factor authentication.
            </p>
            <Button variant="secondary" disabled className="w-full">
              Coming Soon
            </Button>
          </div>
        </div>
      </Card>

      {/* Emergency Contacts Card */}
      <Card title="Emergency Contacts" className="emergency-contacts-card">
        <div className="space-y-4">
          {studentData.emergencyContacts && studentData.emergencyContacts.length > 0 ? (
            studentData.emergencyContacts.map((contact, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{contact.name || 'Contact Person'}</p>
                    <p className="text-sm text-gray-600">{contact.relationship}</p>
                    <p className="text-sm text-gray-700 mt-2">
                      <Phone size={14} className="inline mr-1" />
                      {contact.phone}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-gray-600 text-sm">
              No emergency contacts on file. Contact your school office to add one.
            </p>
          )}
        </div>
      </Card>

      {/* Download Academic Records */}
      <Card title="Academic Records" icon={Download} className="records-card">
        <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
          <p className="text-gray-700 mb-4">
            Download a copy of your academic record including attendance and assessment summaries.
          </p>
          <Button
            onClick={handleDownloadRecords}
            className="flex items-center gap-2 w-full md:w-auto"
          >
            <Download size={18} />
            Download Academic Record
          </Button>
        </div>
      </Card>

      {/* Privacy Notice */}
      <Card title="Privacy" className="privacy-card">
        <p className="text-sm text-gray-600">
          Your personal information is protected and used only for school-related communications
          and record-keeping. For more information, see our{' '}
          <a href="#" className="text-blue-600 hover:text-blue-900 font-medium">
            Privacy Policy
          </a>
          .
        </p>
      </Card>
    </div>
  );
}
