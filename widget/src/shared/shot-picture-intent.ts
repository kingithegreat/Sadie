/** A plain background is deliberate only for the exact picture the user chose. */
export function plainBackgroundAccepted(acknowledged: unknown, pictureSha256: unknown): boolean {
  return typeof pictureSha256 === 'string' && /^[a-f0-9]{64}$/.test(pictureSha256)
    && acknowledged === pictureSha256;
}
