import { ImagePlus } from 'lucide-react';
import { type ChangeEvent, type DragEvent, useState } from 'react';
import type { JourneyEditorRepository } from '../../data/ports';
import { storageWriteFailureMessage } from '../../data/storageErrors';
import type { Moment, NormalizedPhotoInput } from '../../domain/model';
import {
  normalizePhoto,
  PhotoNormalizationError,
} from '../../media/photoNormalizer';
import { PHOTO_LIMITS } from '../../media/photoLimits';

interface PhotoFailure {
  fileName: string;
  reason: string;
}

interface PhotoDropzoneProps {
  journeyId: string;
  repository: Pick<JourneyEditorRepository, 'addMoments'>;
  normalize?: (file: File) => Promise<NormalizedPhotoInput>;
  onMomentsCommitted?: (moments: Moment[]) => void;
  onMomentsAdded: (moments: Moment[]) => void | Promise<void>;
  onSelectMoment: (momentId: string) => void;
}

function localizedFailure(error: unknown) {
  if (error instanceof PhotoNormalizationError) return error.message;
  return '無法處理這張照片，請稍後再試。';
}

async function boundedMap<Input, Output>(
  values: readonly Input[],
  worker: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const output = new Array<Output>(values.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await worker(values[index], index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(PHOTO_LIMITS.normalizationConcurrency, values.length) },
    run,
  ));
  return output;
}

export function PhotoDropzone({
  journeyId,
  repository,
  normalize = normalizePhoto,
  onMomentsCommitted,
  onMomentsAdded,
  onSelectMoment,
}: PhotoDropzoneProps) {
  const [failures, setFailures] = useState<PhotoFailure[]>([]);
  const [batchError, setBatchError] = useState('');
  const [refreshFailure, setRefreshFailure] = useState<Moment[] | undefined>(undefined);
  const [processing, setProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const processFiles = async (files: File[]) => {
    if (files.length === 0 || processing || refreshFailure) return;
    setBatchError('');
    setFailures([]);
    if (files.length > PHOTO_LIMITS.maxBatchPhotoCount) {
      setBatchError(`一次最多加入 ${PHOTO_LIMITS.maxBatchPhotoCount} 張照片。`);
      return;
    }
    const totalInputBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalInputBytes > PHOTO_LIMITS.maxBatchInputBytes) {
      setBatchError('這批照片合計超過 250 MiB 上限。');
      return;
    }
    setProcessing(true);

    const results = await boundedMap(files, async (file) => {
      try {
        return { kind: 'success' as const, photo: await normalize(file) };
      } catch (error) {
        return {
          kind: 'failure' as const,
          failure: { fileName: file.name, reason: localizedFailure(error) },
        };
      }
    });
    const nextFailures = results.flatMap((result) => (
      result.kind === 'failure' ? [result.failure] : []
    ));
    const photos = results.flatMap((result) => (
      result.kind === 'success' ? [result.photo] : []
    ));
    setFailures(nextFailures);

    if (photos.length === 0) {
      setProcessing(false);
      return;
    }

    let created: Moment[];
    try {
      created = await repository.addMoments(journeyId, photos);
    } catch (error) {
      setBatchError(storageWriteFailureMessage(error, '無法加入照片，請稍後再試。'));
      setProcessing(false);
      return;
    }

    onMomentsCommitted?.(created);
    if (created[0]) onSelectMoment(created[0].id);
    try {
      await onMomentsAdded(created);
      setRefreshFailure(undefined);
    } catch {
      setRefreshFailure(created);
    } finally {
      setProcessing(false);
    }
  };

  const retryRefresh = async () => {
    const created = refreshFailure;
    if (!created || processing) return;
    setProcessing(true);
    try {
      await onMomentsAdded(created);
      setRefreshFailure(undefined);
    } catch {
      setRefreshFailure(created);
    } finally {
      setProcessing(false);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    void processFiles(files).finally(() => { input.value = ''; });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void processFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="photo-upload-control">
      <div
        className={`photo-dropzone${dragActive ? ' is-drag-active' : ''}`}
        aria-busy={processing}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        <label title="加入照片">
          <ImagePlus size={17} aria-hidden="true" />
          <span>{processing ? '處理照片中' : '加入照片'}</span>
          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            disabled={processing || refreshFailure !== undefined}
            aria-label="加入照片"
            data-validation-field="moments"
            onChange={handleChange}
          />
        </label>
      </div>
      {failures.length > 0 && (
        <ul className="photo-upload-failures" aria-label="未加入的照片" role="alert">
          {failures.map((failure, index) => (
            <li key={`${failure.fileName}:${index}`}>{failure.fileName}：{failure.reason}</li>
          ))}
        </ul>
      )}
      {batchError && <p className="field-error" role="alert">{batchError}</p>}
      {refreshFailure && (
        <div className="photo-refresh-error" role="alert">
          <span>照片已加入但重新載入失敗。</span>
          <button type="button" disabled={processing} onClick={() => void retryRefresh()}>重新載入</button>
        </div>
      )}
    </div>
  );
}
