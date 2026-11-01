import { useCallback, useEffect, useRef, useState } from 'react';

export const LONG_PRESS_MS = 1000;
const MOVE_TOLERANCE_PX = 10;
const CLICK_GUARD_MS = 700;
const HELD_GUARD_MS = 10000;
const FLASH_MS = 850;

// Press-and-hold on touch screens: hold a row for LONG_PRESS_MS to run onLong (e.g. toggle its
// selection). Mouse input is ignored. Moving the finger (a scroll) cancels it, and the tap that
// ends a successful hold clicks nothing -- not the row, and not whatever slid under the finger
// (the selection bar appearing pushes the rows down). `flash` names the row just held, for
// FLASH_MS, so the page can play its "selected" flash.
export function useLongPress(ms = LONG_PRESS_MS) {
  const press = useRef(null);
  const fired = useRef(false);
  const guardUntil = useRef(0);
  const flashTimer = useRef(null);
  const swallow = useRef(null);
  const [pressing, setPressing] = useState(null);
  const [flash, setFlash] = useState(null);

  const stopSwallowing = useCallback(() => {
    if (swallow.current) window.removeEventListener('click', swallow.current, true);
    swallow.current = null;
  }, []);

  const swallowNextClick = useCallback(() => {
    stopSwallowing();
    const onClick = (e) => {
      if (Date.now() < guardUntil.current) {
        e.preventDefault();
        e.stopPropagation();
      }
      guardUntil.current = 0;
      stopSwallowing();
    };
    swallow.current = onClick;
    window.addEventListener('click', onClick, true);
  }, [stopSwallowing]);

  useEffect(() => () => { clearTimeout(flashTimer.current); stopSwallowing(); }, [stopSwallowing]);

  const cancel = useCallback(() => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    setPressing(null);
  }, []);

  const release = useCallback(() => {
    if (fired.current) {
      fired.current = false;
      guardUntil.current = Date.now() + CLICK_GUARD_MS;
      setTimeout(() => { if (Date.now() >= guardUntil.current) stopSwallowing(); }, CLICK_GUARD_MS + 50);
    }
    cancel();
  }, [cancel, stopSwallowing]);

  useEffect(() => cancel, [cancel]);

  const bind = useCallback((key, onLong, enabled = true) => {
    if (!enabled) return {};
    return {
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse' || e.button > 0) return;
        cancel();
        fired.current = false;
        const timer = setTimeout(() => {
          press.current = null;
          setPressing(null);
          fired.current = true;
          guardUntil.current = Date.now() + HELD_GUARD_MS;
          swallowNextClick();
          navigator.vibrate?.(35);
          onLong();
          clearTimeout(flashTimer.current);
          setFlash(key);
          flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
        }, ms);
        press.current = { timer, x: e.clientX, y: e.clientY, key };
        setPressing(key);
      },
      onPointerMove: (e) => {
        const p = press.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE_PX) cancel();
      },
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: release,
      onContextMenu: (e) => {
        if (press.current || Date.now() < guardUntil.current) e.preventDefault();
      },
    };
  }, [cancel, release, swallowNextClick, ms]);

  return { bind, pressing, flash };
}
