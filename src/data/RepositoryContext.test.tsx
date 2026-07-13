import { renderHook } from '@testing-library/react';
import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';
import { fixtureJourneyRepository } from './fixtureJourneyRepository';
import type { JourneyEditorRepository, PhotoAssetRepository, PrivateDataPort } from './ports';
import {
  RepositoryProvider,
  useJourneyEditorRepository,
  useJourneyRepository,
  useOptionalJourneyEditorRepository,
  usePhotoAssetRepository,
  usePrivateDataPort,
} from './RepositoryContext';

type ProviderProps = ComponentProps<typeof RepositoryProvider>;
type HasLegacyRepositoryProp = 'repository' extends keyof ProviderProps ? true : false;
type ServicesAreRequired = {} extends Pick<ProviderProps, 'services'> ? false : true;

const providerHasNoLegacyRepositoryProp: false = false as HasLegacyRepositoryProp;
const providerRequiresServices: true = true as ServicesAreRequired;
void providerHasNoLegacyRepositoryProp;
void providerRequiresServices;

const editor = {} as JourneyEditorRepository;
const photos = {} as PhotoAssetRepository;
const privateData = {} as PrivateDataPort;

function AllServicesProvider({ children }: PropsWithChildren) {
  return (
    <RepositoryProvider services={{
      query: fixtureJourneyRepository,
      editor,
      photos,
      privateData,
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
    expect(renderHook(usePhotoAssetRepository, { wrapper: AllServicesProvider }).result.current)
      .toBe(photos);
    expect(renderHook(usePrivateDataPort, { wrapper: AllServicesProvider }).result.current)
      .toBe(privateData);
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
  });

  it('throws the exact photo-service error when photos are absent', () => {
    expect(() => renderHook(usePhotoAssetRepository, { wrapper: QueryOnlyProvider }))
      .toThrowError(/^PhotoAssetRepository is not available$/);
  });

  it('throws the exact private-data error when private data is absent', () => {
    expect(() => renderHook(usePrivateDataPort, { wrapper: QueryOnlyProvider }))
      .toThrowError(/^PrivateDataPort is not available$/);
  });
});
