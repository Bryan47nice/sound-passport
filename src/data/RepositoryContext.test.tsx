import { act, renderHook } from '@testing-library/react';
import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';
import { fixtureJourneyRepository } from './fixtureJourneyRepository';
import type {
  JourneyAutosaveOutboxPort,
  JourneyEditorRepository,
  PhotoAssetRepository,
  PrivateDataPort,
} from './ports';
import {
  RepositoryProvider,
  useJourneyAutosaveOutbox,
  useJourneyEditorRepository,
  useJourneyRepository,
  useInvalidateRepositoryQueries,
  useOptionalJourneyAutosaveOutbox,
  useOptionalJourneyEditorRepository,
  usePhotoAssetRepository,
  usePrivateStorageError,
  usePrivateDataPort,
  useRepositoryRevision,
} from './RepositoryContext';

type ProviderProps = ComponentProps<typeof RepositoryProvider>;
type HasLegacyRepositoryProp = 'repository' extends keyof ProviderProps ? true : false;
type ServicesAreRequired = {} extends Pick<ProviderProps, 'services'> ? false : true;

const providerHasNoLegacyRepositoryProp: false = false as HasLegacyRepositoryProp;
const providerRequiresServices: true = true as ServicesAreRequired;
void providerHasNoLegacyRepositoryProp;
void providerRequiresServices;

const editor = {} as JourneyEditorRepository;
const outbox = {} as JourneyAutosaveOutboxPort;
const photos = {} as PhotoAssetRepository;
const privateData = {} as PrivateDataPort;
const privateStorageError = '請關閉其他分頁後重新嘗試';

function AllServicesProvider({ children }: PropsWithChildren) {
  return (
    <RepositoryProvider services={{
      query: fixtureJourneyRepository,
      editor,
      outbox,
      photos,
      privateData,
      privateStorageError,
    }}>
      {children}
    </RepositoryProvider>
  );
}

function QueryOnlyProvider({ children }: PropsWithChildren) {
  return (
    <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
      {children}
    </RepositoryProvider>
  );
}

describe('repository service hooks', () => {
  it('returns each configured service', () => {
    expect(renderHook(useJourneyRepository, { wrapper: AllServicesProvider }).result.current)
      .toBe(fixtureJourneyRepository);
    expect(renderHook(useJourneyEditorRepository, { wrapper: AllServicesProvider }).result.current)
      .toBe(editor);
    expect(renderHook(useJourneyAutosaveOutbox, { wrapper: AllServicesProvider }).result.current)
      .toBe(outbox);
    expect(renderHook(usePhotoAssetRepository, { wrapper: AllServicesProvider }).result.current)
      .toBe(photos);
    expect(renderHook(usePrivateDataPort, { wrapper: AllServicesProvider }).result.current)
      .toBe(privateData);
    expect(renderHook(usePrivateStorageError, { wrapper: AllServicesProvider }).result.current)
      .toBe(privateStorageError);
  });

  it('throws the exact query-service error outside the provider', () => {
    expect(() => renderHook(useJourneyRepository)).toThrowError(/^JourneyRepository is not available$/);
  });

  it('throws the exact editor-service error when editor is absent', () => {
    expect(() => renderHook(useJourneyEditorRepository, { wrapper: QueryOnlyProvider }))
      .toThrowError(/^JourneyEditorRepository is not available$/);
  });

  it('returns undefined from the optional editor hook when local storage is unavailable', () => {
    expect(renderHook(useOptionalJourneyEditorRepository, { wrapper: QueryOnlyProvider }).result.current)
      .toBeUndefined();
    expect(renderHook(usePrivateStorageError, { wrapper: QueryOnlyProvider }).result.current)
      .toBeUndefined();
  });

  it('keeps the outbox unavailable in fixture-only services', () => {
    expect(renderHook(useOptionalJourneyAutosaveOutbox, { wrapper: QueryOnlyProvider }).result.current)
      .toBeUndefined();
    expect(() => renderHook(useJourneyAutosaveOutbox, { wrapper: QueryOnlyProvider }))
      .toThrowError(/^JourneyAutosaveOutboxPort is not available$/);
  });

  it('throws the exact photo-service error when photos are absent', () => {
    expect(() => renderHook(usePhotoAssetRepository, { wrapper: QueryOnlyProvider }))
      .toThrowError(/^PhotoAssetRepository is not available$/);
  });

  it('throws the exact private-data error when private data is absent', () => {
    expect(() => renderHook(usePrivateDataPort, { wrapper: QueryOnlyProvider }))
      .toThrowError(/^PrivateDataPort is not available$/);
  });

  it('advances a provider-local query revision only when a caller invalidates live repository reads', () => {
    const { result } = renderHook(() => ({
      invalidate: useInvalidateRepositoryQueries(),
      revision: useRepositoryRevision(),
    }), { wrapper: AllServicesProvider });

    expect(result.current.revision).toBe(0);
    act(() => result.current.invalidate());
    expect(result.current.revision).toBe(1);
  });
});
