import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { useGetMyLearnerRecord } from '@workspace/api-client-react';
import { auth, authMessage, useAuth } from '@/lib/auth';
import { useSession } from '@/lib/session';
import './profile.css';

export const StudentProfile = () => {
  const { user } = useAuth();
  const { school } = useSession();
  const { data: student } = useGetMyLearnerRecord();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage('All fields are required');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMessage('Password must be at least 8 characters');
      return;
    }
    const account = auth.currentUser;
    if (!account || !account.email) {
      setPasswordMessage('Password change is only available for email sign-in accounts.');
      return;
    }

    setBusy(true);
    setPasswordMessage('');
    try {
      const credential = EmailAuthProvider.credential(account.email, currentPassword);
      await reauthenticateWithCredential(account, credential);
      await updatePassword(account, newPassword);
      setPasswordMessage('✓ Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordMessage(`✗ ${authMessage(err, 'Failed to update password')}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="student-profile">
      <div className="page-header">
        <h1>My Profile</h1>
        <p>Manage your account information</p>
      </div>

      <div className="profile-card">
        <h2>Personal Information</h2>
        <div className="info-grid">
          <div className="info-item">
            <span className="label">First Name</span>
            <span className="value">{student?.firstName ?? '—'}</span>
          </div>
          <div className="info-item">
            <span className="label">Last Name</span>
            <span className="value">{student?.lastName ?? '—'}</span>
          </div>
          <div className="info-item">
            <span className="label">Email</span>
            <span className="value">{user?.email ?? '—'}</span>
          </div>
        </div>
      </div>

      <div className="profile-card">
        <h2>Academic Information</h2>
        <div className="info-grid">
          <div className="info-item">
            <span className="label">Admission Number</span>
            <span className="value">{student?.admissionNumber ?? '—'}</span>
          </div>
          <div className="info-item">
            <span className="label">School</span>
            <span className="value">{school?.schoolName ?? '—'}</span>
          </div>
          <div className="info-item">
            <span className="label">Current Class</span>
            <span className="value">{student?.className || 'No class assigned'}</span>
          </div>
          <div className="info-item">
            <span className="label">Student Status</span>
            <span className="value">
              <span className={`status-badge ${student?.status ?? ''}`}>
                {student?.status?.toUpperCase() ?? '—'}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="profile-card">
        <h2>Change Password</h2>
        <form onSubmit={(e) => { e.preventDefault(); void handlePasswordChange(); }} className="password-form">
          <div className="form-group">
            <label>Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              className="form-input"
              autoComplete="current-password"
            />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 8 characters)"
              className="form-input"
              autoComplete="new-password"
            />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="form-input"
              autoComplete="new-password"
            />
          </div>
          {passwordMessage && (
            <div className={`message ${passwordMessage.startsWith('✓') ? 'success' : 'error'}`}>
              {passwordMessage}
            </div>
          )}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>

      <div className="profile-card info-box">
        <h2>Privacy Information</h2>
        <p>
          Your personal information is protected by school data protection policies.
          Teachers and administrators can only access information relevant to your education.
          For questions about your data, contact your school administration.
        </p>
      </div>
    </div>
  );
};