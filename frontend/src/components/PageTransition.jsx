import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AppLogo from './AppLogo';
import './PageTransition.css';

const PageTransition = ({ children }) => {
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);
  const [transitioning, setTransitioning] = useState(false);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    if (prevPathRef.current === location.pathname) return;
    prevPathRef.current = location.pathname;

    const scrollable = document.querySelector('.page-scroll');
    if (scrollable) scrollable.scrollTop = 0;

    setTransitioning(true);
    setRevealing(false);

    const showTimer = setTimeout(() => {
      setRevealing(true);
    }, 600);

    const doneTimer = setTimeout(() => {
      setTransitioning(false);
      setRevealing(false);
    }, 880);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(doneTimer);
    };
  }, [location.pathname]);

  return (
    <div className="page-transition-wrapper">
      <div
        key={location.pathname}
        className={`page-transition-content ${revealing ? 'is-revealing' : ''}`}
      >
        {children}
      </div>

      {transitioning && (
        <div
          className={`page-transition-curtain ${revealing ? 'page-transition-revealing' : ''}`}
          aria-hidden="true"
        >
          <div className="page-transition-badge">
            <div className="page-transition-aura" />
            <AppLogo size={58} gradient={true} />
          </div>
        </div>
      )}
    </div>
  );
};

export default PageTransition;
