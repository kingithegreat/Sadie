export interface ResizeOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0..1 for lossy formats like image/jpeg
}

export async function resizeImageFile(file: File, opts: ResizeOptions = {}) {
  const { maxWidth = 1600, maxHeight = 1600, quality = 0.8 } = opts;

  // Read file into an Image
  const dataUrl = await fileToDataURL(file);
  const img = await dataURLToImage(dataUrl);

  // Compute target size preserving aspect ratio
  let { width, height } = img;
  let targetWidth = width;
  let targetHeight = height;

  if (width > maxWidth || height > maxHeight) {
    const widthRatio = maxWidth / width;
    const heightRatio = maxHeight / height;
    const ratio = Math.min(widthRatio, heightRatio);
    targetWidth = Math.round(width * ratio);
    targetHeight = Math.round(height * ratio);
  }

  // Draw to canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to get canvas context');
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Choose output mime type: keep original if PNG and transparency, otherwise JPEG for smaller size
  const hasTransparency = file.type === 'image/png' || file.type === 'image/webp';
  const outputType = hasTransparency ? 'image/png' : 'image/jpeg';

  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, outputType, quality));
  if (!blob) throw new Error('Canvas toBlob returned null');
  const blobFile = new File([blob], file.name, { type: blob.type });
  const resizedDataUrl = await fileToDataURL(blobFile);
  const data = resizedDataUrl.split(',')[1];

  return {
    filename: file.name,
    mimeType: blob.type,
    data,
    url: resizedDataUrl,
    size: blob.size,
  } as const;
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

function dataURLToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
}
