import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Moment, NormalizedPhotoInput } from '../../domain/model';
import { PhotoNormalizationError } from '../../media/photoNormalizer';
import { PhotoDropzone } from './PhotoDropzone';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function normalized(fileName: string): NormalizedPhotoInput {
  const blob = new Blob([fileName], { type: 'image/webp' });
  return {
    blob,
    contentType: 'image/webp',
    originalFileName: fileName,
    width: 1200,
    height: 800,
    byteSize: blob.size,
  };
}

function moment(id: string, fileName: string, sortOrder: number): Moment {
  return {
    id,
    journeyId: 'journey-1',
    photoAssetId: `photo-${id}`,
    photoAlt: fileName,
    songReferenceId: `song-${id}`,
    localDate: '2026-07-13',
    cityLabel: '台北',
    placeLabel: '',
    caption: '',
    reason: '',
    reasonStatus: 'needs_review',
    sortOrder,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
}

describe('PhotoDropzone', () => {
  afterEach(cleanup);

  it('creates successful photos once in selection order and reports every rejected filename', async () => {
    const first = deferred<NormalizedPhotoInput>();
    const rejected = deferred<NormalizedPhotoInput>();
    const third = deferred<NormalizedPhotoInput>();
    const files = [
      new File(['first'], '第一張.jpg', { type: 'image/jpeg' }),
      new File(['broken'], '無法讀取.heic', { type: 'image/heic' }),
      new File(['third'], '第三張.png', { type: 'image/png' }),
    ];
    const normalize = vi.fn((file: File) => {
      if (file === files[0]) return first.promise;
      if (file === files[1]) return rejected.promise;
      return third.promise;
    });
    const created = [moment('moment-first', files[0].name, 0), moment('moment-third', files[2].name, 1)];
    const addMoments = vi.fn(async () => created);
    const onMomentsAdded = vi.fn();
    const onSelectMoment = vi.fn();
    render(
      <PhotoDropzone
        journeyId="journey-1"
        repository={{ addMoments }}
        normalize={normalize}
        onMomentsAdded={onMomentsAdded}
        onSelectMoment={onSelectMoment}
      />,
    );

    fireEvent.change(screen.getByLabelText('加入照片'), { target: { files } });
    await act(async () => {
      third.resolve(normalized(files[2].name));
      rejected.reject(new PhotoNormalizationError('decode_failed'));
      await Promise.resolve();
    });
    expect(addMoments).not.toHaveBeenCalled();

    await act(async () => {
      first.resolve(normalized(files[0].name));
      await first.promise;
    });

    await waitFor(() => expect(addMoments).toHaveBeenCalledTimes(1));
    expect(addMoments).toHaveBeenCalledWith(
      'journey-1',
      [normalized(files[0].name), normalized(files[2].name)],
    );
    expect(onMomentsAdded).toHaveBeenCalledWith(created);
    expect(onSelectMoment).toHaveBeenCalledWith('moment-first');
    expect(screen.getByText(
      '無法讀取.heic：無法讀取這張照片，請改用其他圖片檔案。',
    )).toBeInTheDocument();
  });

  it('does not call the repository when every selected photo fails', async () => {
    const files = [
      new File(['large'], '過大.jpg', { type: 'image/jpeg' }),
      new File(['bad'], '損壞.png', { type: 'image/png' }),
    ];
    const normalize = vi.fn()
      .mockRejectedValueOnce(new PhotoNormalizationError('too_large'))
      .mockRejectedValueOnce(new PhotoNormalizationError('decode_failed'));
    const addMoments = vi.fn();
    const onSelectMoment = vi.fn();
    render(
      <PhotoDropzone
        journeyId="journey-1"
        repository={{ addMoments }}
        normalize={normalize}
        onMomentsAdded={vi.fn()}
        onSelectMoment={onSelectMoment}
      />,
    );

    fireEvent.change(screen.getByLabelText('加入照片'), { target: { files } });

    expect(await screen.findByText('過大.jpg：照片檔案超過 25 MiB 上限。')).toBeInTheDocument();
    expect(screen.getByText('損壞.png：無法讀取這張照片，請改用其他圖片檔案。')).toBeInTheDocument();
    expect(addMoments).not.toHaveBeenCalled();
    expect(onSelectMoment).not.toHaveBeenCalled();
  });
});
