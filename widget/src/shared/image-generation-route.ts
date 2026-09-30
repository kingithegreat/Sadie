/** Main-derived disclosure only; these labels never grant paid or Online access. */
export interface ImageGenerationRoute {
  localFirst: boolean;
  onlineAllowed: boolean;
  onlineProvider: { label: string; cost: string; paid: boolean; watermark: string | null } | null;
  paidFallback: { label: string; cost: string } | null;
}
