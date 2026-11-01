import { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAuth } from '../context/AuthContext';
import AppLogo from '../components/AppLogo';
import SpaceFlightCanvas from '../components/SpaceFlightCanvas';
import '../components/PageTransition.css';
import './LoginPage.css';

const LoginPage = () => {
  const { setSession } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [showLogo, setShowLogo] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);

  useEffect(() => {
    const handleUp = () => setIsBoosting(false);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    window.addEventListener('blur', handleUp);
    return () => {
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      window.removeEventListener('blur', handleUp);
    };
  }, []);

  const handlePointerDown = (e) => {
    if (e.target.closest('.login-card, .login-corp-above')) return;
    if (e.button && e.button !== 0) return;
    setIsBoosting(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter both username and password.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const res = await api.post('/auth/login', {
        username: username.trim(),
        password,
      });

      setTransitioning(true);
      setRevealing(false);
      setShowLogo(false);

      await new Promise((resolve) => setTimeout(resolve, 1400));

      setShowLogo(true);
      await new Promise((resolve) => setTimeout(resolve, 650));

      setRevealing(true);
      await new Promise((resolve) => setTimeout(resolve, 280));

      setSession(res.data.accessToken, res.data.user);
      setPassword('');
    } catch (err) {
      setTransitioning(false);
      setRevealing(false);
      setShowLogo(false);
      setError(errorMessage(err, 'Login failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`login-container ${isBoosting || transitioning ? 'is-thruster-active' : ''}`}
      onPointerDown={handlePointerDown}
    >
      <SpaceFlightCanvas isWarping={transitioning} isBoosting={isBoosting} />

      {transitioning && showLogo && (
        <div
          className={`page-transition-curtain login-transition-curtain ${revealing ? 'page-transition-revealing' : ''}`}
          aria-hidden="true"
        >
          <div className="page-transition-badge">
            <div className="page-transition-aura" />
            <AppLogo size={58} gradient={true} />
          </div>
        </div>
      )}
      <a
        href="https://www.ambujaneotia.com"
        target="_blank"
        rel="noopener noreferrer"
        className={`login-corp-above ${transitioning ? 'is-launching' : ''}`}
        title="AmbujaNeotia Corporate"
        tabIndex={-1}
      >
        <img
          src="/ambuja-neotia-logo-white.png"
          alt="AmbujaNeotia"
          className="login-corp-above-logo"
        />
      </a>
      <div className={`login-card ${transitioning ? 'is-launching' : ''}`}>
        <div className="login-brand">
          <div className="brand-mark brand-mark-logo">
            <AppLogo size={42} tile={true} />
          </div>
          <div className="brand-text">
            <div className="brand-title login-brand-title">IT Asset Engine</div>
          </div>
        </div>

        <h1 className="login-title">Sign in</h1>

        {error && <div className="banner banner-error">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field login-field">
            <label htmlFor="loginUsername">Username</label>
            <input
              id="loginUsername"
              className="field-input"
              type="text"
              autoComplete="username"
              disabled={busy || transitioning}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="field login-field">
            <label htmlFor="loginPassword">Password</label>
            <div className="login-password-wrap">
              <input
                id="loginPassword"
                className="field-input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                disabled={busy || transitioning}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="login-password-toggle"
                disabled={busy || transitioning}
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className={`btn-primary login-submit ${transitioning ? 'is-launching' : ''}`}
            disabled={busy || transitioning}
          >
            {transitioning ? 'Hyperdrive engaged…' : busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
