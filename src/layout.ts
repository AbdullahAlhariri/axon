export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How many pixels of the view's bottom edge are covered by Obsidian's floating status bar
 * (it sits over the bottom of the right sidebar). 0 when hidden or not overlapping.
 */
export function bottomInset(view: Box, statusBar: Box | null): number {
  if (!statusBar) return 0;
  const overlapsHorizontally = statusBar.left < view.right && statusBar.right > view.left;
  const overlapsVertically = statusBar.top < view.bottom && statusBar.bottom > view.top;
  if (!overlapsHorizontally || !overlapsVertically) return 0;
  return Math.ceil(view.bottom - statusBar.top);
}
