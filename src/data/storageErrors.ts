export const STORAGE_CAPACITY_GUIDANCE =
  '本機儲存空間不足，請先匯出備份並刪除不需要的旅程或照片，再重試。';

export class StorageCapacityError extends Error {
  constructor(cause: unknown) {
    super('Sound Passport does not have enough local storage capacity.', { cause });
    this.name = 'StorageCapacityError';
  }
}

export class JourneyQueryError<T = never> extends Error {
  constructor(message: string, readonly fallback?: T, options?: ErrorOptions) {
    super(message, options);
    this.name = 'JourneyQueryError';
  }
}

export function storageWriteFailureMessage(error: unknown, fallback: string): string {
  return error instanceof StorageCapacityError ? STORAGE_CAPACITY_GUIDANCE : fallback;
}
