import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api';
import { announce } from '../lib/live';

// Keeps every open page current without a refresh.
//
//  * Every POLL_MS it asks the API which topics changed (GET /api/live) and
//    announces them; pages re-fetch only their own data (lib/live.js).
//    Paused while the tab is hidden; checked at once when it is shown again.
//  * Every few polls it reads /version.json, written by each build. When a
//    new version has been deployed, the next move to another page loads it
//    (a full page load at the new address). A page being typed into is never
//    reloaded under the user, and a navigation carrying data (Clone) is let
//    through first.

const POLL_MS = 5000;
const BUILD_EVERY = 3;

// eslint-disable-next-line no-undef
const THIS_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : '';

async function deployedBuild() {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return '';
    const body = await res.json();
    return typeof body?.build === 'string' ? body.build : '';
  } catch {
    return '';
  }
}

const LiveSync = () => {
  const location = useLocation();
  const updateReady = useRef(false);
  const firstPath = useRef(true);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    let busy = false;
    let last = null;
    let polls = 0;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };

    async function poll() {
      if (stopped || busy) return;
      if (document.hidden) { schedule(); return; }
      busy = true;
      try {
        const res = await api.get('/live');
        const versions = res.data?.versions || {};
        if (last) {
          const changed = Object.keys(versions).filter((k) => versions[k] !== last[k]);
          if (changed.length) announce(changed);
        }
        last = versions;
      } catch {  }
      if (import.meta.env.PROD && THIS_BUILD && !updateReady.current && polls % BUILD_EVERY === 0) {
        const deployed = await deployedBuild();
        if (deployed && deployed !== THIS_BUILD) updateReady.current = true;
      }
      polls += 1;
      busy = false;
      schedule();
    }

    const onVisible = () => {
      if (!document.hidden) { clearTimeout(timer); poll(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return; }
    if (updateReady.current && !location.state) window.location.reload();
    // Only a move to another page counts -- not a same-page state clean-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return null;
};

export default LiveSync;
