export const SCAN_MAX_GAP_MS = 35;

export const SCAN_MIN_BURST = 3;

export const SCAN_QUIET_MS = 90;

export function nextBurstLength(prevLength, gapMs) {
  return gapMs <= SCAN_MAX_GAP_MS ? prevLength + 1 : 1;
}

export function isCompleteScan(burstLength) {
  return burstLength >= SCAN_MIN_BURST;
}

export function appendToBurst(burst, char, gapMs) {
  const length = nextBurstLength(burst.length, gapMs);
  return { text: length === 1 ? char : burst.text + char, length };
}

export function isScanTerminator({ armed, burstLength }) {
  return Boolean(armed) || isCompleteScan(burstLength);
}
