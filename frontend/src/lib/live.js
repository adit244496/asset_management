import { useEffect, useRef, useState } from 'react';

// Live updates. <LiveSync> polls GET /api/live and, when a topic's change
// counter moves, fires LIVE_EVENT with the topics that changed. Pages listen
// with useLiveTick() and re-fetch what they show. See backend app/live.py.

export const LIVE_EVENT = 'iam:live';

export const TOPIC = Object.freeze({
  assets: 'assets',
  peripherals: 'peripherals',
  softwares: 'softwares',
  verification: 'verification',
  masters: 'masters',
  users: 'users',
  activity: 'activity',
  settings: 'settings',
  assistant: 'assistant',
});

export const REGISTER_TOPICS = [TOPIC.assets, TOPIC.peripherals, TOPIC.softwares];

// The live topic of a register key from lib/registers ('asset' -> 'assets').
export const topicOfRegister = (key) => ({
  asset: TOPIC.assets,
  peripheral: TOPIC.peripherals,
  software: TOPIC.softwares,
}[key] || TOPIC.assets);

export function announce(topics) {
  try {
    window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: { topics } }));
  } catch {  }
}

const asList = (topics) => (Array.isArray(topics) ? topics : [topics]).filter(Boolean);

// Calls handler(changedTopics) whenever one of `topics` changes elsewhere.
export function useLiveEvent(topics, handler) {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  const key = asList(topics).join(',');
  useEffect(() => {
    if (!key) return undefined;
    const wanted = new Set(key.split(','));
    const on = (e) => {
      const changed = (e.detail?.topics || []).filter((t) => wanted.has(t));
      if (changed.length) ref.current?.(changed);
    };
    window.addEventListener(LIVE_EVENT, on);
    return () => window.removeEventListener(LIVE_EVENT, on);
  }, [key]);
}

// A number that goes up when one of `topics` changes. Put it in an effect's
// dependencies to re-fetch. While `paused` (a form or dialog is open), changes
// are held and delivered as one tick when it un-pauses, so nothing reloads
// under someone half-way through typing.
export function useLiveTick(topics, { paused = false } = {}) {
  const [tick, setTick] = useState(0);
  const held = useRef(false);
  const pausedRef = useRef(paused);

  useLiveEvent(topics, () => {
    if (pausedRef.current) held.current = true;
    else setTick((n) => n + 1);
  });

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && held.current) {
      held.current = false;
      setTick((n) => n + 1);
    }
  }, [paused]);

  return tick;
}
