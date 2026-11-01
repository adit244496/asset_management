import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { errorMessage } from '../api';
import { useAuth } from '../context/AuthContext';
import './SetPasswordPage.css';

const SetPasswordPage = () => {
  const { user, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    if (next === current) {
      setError('Choose something different from the password you were given.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(errorMessage(err, 'Could not set your password.'));
      setSaving(false);
    }
  };

  return (
    <div className="setpw-page">
      <form className="setpw-card" onSubmit={submit}>
        <div className="setpw-icon"><KeyRound size={22} /></div>
        <h1>Choose your password</h1>
        <p className="setpw-sub">
          Welcome, <strong>{user?.fullName || user?.username}</strong>. This account was
          created for you with a password that everyone in your batch was given, so it
          has to be replaced before you can use the register.
        </p>

        {error && <div className="banner banner-error">{error}</div>}

        <div className="field">
          <label htmlFor="pwCurrent">The password you were given</label>
          <input
            id="pwCurrent"
            className="field-input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="pwNew">Your new password</label>
          <input
            id="pwNew"
            className="field-input"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="pwConfirm">Type it again</label>
          <input
            id="pwConfirm"
            className="field-input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        <button type="submit" className="btn-primary setpw-submit" disabled={saving}>
          {saving ? 'Saving…' : 'Set password and continue'}
        </button>

        <button type="button" className="setpw-logout" onClick={logout}>
          <LogOut size={13} /> Sign out instead
        </button>
      </form>
    </div>
  );
};

export default SetPasswordPage;
