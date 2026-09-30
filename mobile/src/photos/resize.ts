// Android's photo pipeline: longest edge ≤ 1080 px, JPEG quality 75 %. Pure sizing, tested.
export const MAX_EDGE = 1080;
export const JPEG_QUALITY = 0.75;

/** The resize to apply (one side; the other keeps aspect), or null when already small enough. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number } | { height: number } | null {
  if (width <= maxEdge && height <= maxEdge) return null;
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}
