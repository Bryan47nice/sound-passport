export interface PhotoDimensions {
  readonly width: number;
  readonly height: number;
}

export type PhotoInspector = (blob: Blob) => Promise<PhotoDimensions>;

export const inspectPhoto: PhotoInspector = async (blob) => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (cause) {
    throw new Error('Photo decode failed.', { cause });
  }

  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
};
