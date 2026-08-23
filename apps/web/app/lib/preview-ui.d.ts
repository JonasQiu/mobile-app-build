export type PreviewCanvas = Readonly<{
  id: "desktop" | "tablet" | "mobile";
  label: string;
  width: number;
  height: number;
}>;

export const PREVIEW_CANVASES: readonly PreviewCanvas[];
export function sanitizeReviewSvg(content: unknown): string | null;
export function previewIndexAfterMove(currentIndex: number, direction: number, length: number): number;
