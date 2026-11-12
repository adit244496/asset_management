import { useEffect, useState } from 'react';
import api from '../api';
import { LIVE_EVENT, TOPIC } from './live';

// Software Serial Numbers (licence keys) come from the server masked as
// XXXX. Profiles a superadmin allows under Admin controls get an eye button
// that fetches one key at a time; each reveal is in the Activity Log.

export const SERIAL_MASK = 'XXXX';
export const isSerialMask = (value) => String(value ?? '').trim().toUpperCase() === SERIAL_MASK;

// One shared answer to "may I reveal?" for the whole page, refreshed when
// a superadmin changes the setting or this account changes (live updates).
let cached = null;
let pending = null;
const listeners = new Set();

function load() {
  if (!pending) {
    pending = api.get('/softwares/serial-access')
      .then((res) => Boolean(res.data?.canReveal))
      .catch(() => false)
      .then((value) => {
        cached = value;
        pending = null;
        listeners.forEach((fn) => fn(value));
        return value;
      });
  }
  return pending;
}

if (typeof window !== 'undefined') {
  window.addEventListener(LIVE_EVENT, (e) => {
    const changed = e.detail?.topics || [];
    if (cached !== null && (changed.includes(TOPIC.settings) || changed.includes(TOPIC.users))) load();
  });
  window.addEventListener('iam:unauthorized', () => { cached = null; });
}

export function useSerialAccess() {
  const [canReveal, setCanReveal] = useState(cached ?? false);
  useEffect(() => {
    listeners.add(setCanReveal);
    if (cached === null) load();  // otherwise the first render already used it
    return () => { listeners.delete(setCanReveal); };
  }, []);
  return canReveal;
}

export async function revealSerial(id) {
  const res = await api.post(`/softwares/${encodeURIComponent(id)}/serial`);
  return res.data?.srl || '';
}
