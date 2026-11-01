export const GAP = 4;
export const MARGIN = 8;
export const MIN_WIDTH = 160;
export const MAX_HEIGHT = 220;
export const MIN_HEIGHT = 96;

export function placeDropdown(rect, viewport, measuredWidth = 0) {
  const roomBelow = viewport.height - rect.bottom - GAP - MARGIN;
  const roomAbove = rect.top - GAP - MARGIN;

  const flipped = roomBelow < MIN_HEIGHT && roomAbove > roomBelow;
  const maxHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, flipped ? roomAbove : roomBelow));

  const minWidth = Math.max(rect.width, MIN_WIDTH);
  const maxWidth = Math.max(MIN_WIDTH, viewport.width - MARGIN * 2);
  const width = Math.min(maxWidth, Math.max(measuredWidth, minWidth));

  const left = Math.min(
    Math.max(MARGIN, rect.left),
    Math.max(MARGIN, viewport.width - width - MARGIN),
  );

  return {
    left,
    top: flipped ? undefined : rect.bottom + GAP,
    bottom: flipped ? viewport.height - rect.top + GAP : undefined,
    minWidth,
    maxWidth,
    maxHeight,
    flipped,
  };
}
