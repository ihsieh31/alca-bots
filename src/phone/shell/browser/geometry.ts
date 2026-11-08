// Where the page sits on the phone's screen: fitted inside the stage, then zoomed and moved by the person's fingers.

export interface Size {
  width: number;
  height: number;
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MAX_ZOOM = 5;
export const TAP_ZOOM = 2.5;

export const fitScale = (page: Size, stage: Size): number => Math.min(stage.width / page.width, stage.height / page.height) || 1;

/** Keeps the page covering the stage where it is big enough to, and centered where it isn't. */
export function clampView(view: View, page: Size, stage: Size): View {
  const fit = fitScale(page, stage);
  const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale));
  const place = (position: number, drawn: number, room: number) => (drawn <= room
    ? (room - drawn) / 2
    : Math.min(0, Math.max(room - drawn, position)));
  return {
    scale,
    x: place(view.x, page.width * fit * scale, stage.width),
    y: place(view.y, page.height * fit * scale, stage.height),
  };
}

export const homeView = (page: Size, stage: Size): View => clampView({ scale: 1, x: 0, y: 0 }, page, stage);

/** Zooms keeping the point under the fingers where it is. */
export function zoomAt(view: View, scale: number, point: { x: number; y: number }): View {
  const ratio = scale / view.scale;
  return { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}

/** The page coordinates under a point on the stage, or null when it's beside the page. */
export function toPage(point: { x: number; y: number }, view: View, page: Size, stage: Size): { x: number; y: number } | null {
  const drawn = fitScale(page, stage) * view.scale;
  const x = (point.x - view.x) / drawn;
  const y = (point.y - view.y) / drawn;
  return x < 0 || y < 0 || x > page.width || y > page.height ? null : { x: Math.round(x), y: Math.round(y) };
}
