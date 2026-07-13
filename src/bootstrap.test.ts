import { describe, expect, it, vi } from 'vitest';
import { fixtureJourneyRepository } from './data/fixtureJourneyRepository';
import type { IndexedDbJourneyRepository } from './data/indexedDbJourneyRepository';
import type { JourneyRepository } from './data/ports';
import type { RepositoryServices } from './data/RepositoryContext';
import { bootstrapRepositoryServices } from './bootstrap';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createPrivateRepository(): IndexedDbJourneyRepository {
  return {
    ...fixtureJourneyRepository,
    listCountrySummaries: vi.fn(async () => []),
    listJourneysByCountry: vi.fn(async () => []),
    getJourneyStory: vi.fn(async () => undefined),
    listPrivateJourneys: vi.fn(),
    createJourney: vi.fn(),
    updateJourney: vi.fn(),
    deleteJourney: vi.fn(),
    getPrivateJourneyStory: vi.fn(),
    addMoments: vi.fn(),
    updateMoment: vi.fn(),
    deleteMoment: vi.fn(),
    reorderMoments: vi.fn(),
    setJourneyStatus: vi.fn(),
    getPhotoAsset: vi.fn(),
    exportSnapshot: vi.fn(),
    importSnapshot: vi.fn(),
    clearPrivateData: vi.fn(),
    get: vi.fn(),
    listByJourney: vi.fn(),
    adopt: vi.fn(),
    put: vi.fn(),
    compareAndDelete: vi.fn(),
  } as IndexedDbJourneyRepository;
}

describe('bootstrapRepositoryServices', () => {
  it('renders fixture queries synchronously before the database opens', () => {
    const database = deferred<object>();
    const renderServices = vi.fn<(services: RepositoryServices) => void>();

    void bootstrapRepositoryServices({
      fixtureRepository: fixtureJourneyRepository,
      renderServices,
      openDatabase: vi.fn(() => database.promise),
      createPrivateRepository: vi.fn(),
    });

    expect(renderServices).toHaveBeenCalledTimes(1);
    expect(renderServices).toHaveBeenLastCalledWith({ query: fixtureJourneyRepository });
  });

  it('upgrades query and private services after a successful open', async () => {
    const database = {};
    const privateRepository = createPrivateRepository();
    const renderServices = vi.fn<(services: RepositoryServices) => void>();

    await bootstrapRepositoryServices({
      fixtureRepository: fixtureJourneyRepository,
      renderServices,
      openDatabase: vi.fn(async () => database),
      createPrivateRepository: vi.fn(() => privateRepository),
    });

    const upgraded = renderServices.mock.calls[1][0];
    expect(renderServices).toHaveBeenCalledTimes(2);
    expect(upgraded.editor).toBe(privateRepository);
    expect(upgraded.outbox).toBe(privateRepository);
    expect(upgraded.photos).toBe(privateRepository);
    expect(upgraded.privateData).toBe(privateRepository);
    expect(await upgraded.query.listCountrySummaries()).toEqual(
      await fixtureJourneyRepository.listCountrySummaries(),
    );
    expect(upgraded.query).not.toBe(fixtureJourneyRepository);
    expect(upgraded.query).not.toBe(privateRepository as JourneyRepository);
  });

  it('keeps fixture services after a rejected open', async () => {
    const renderServices = vi.fn<(services: RepositoryServices) => void>();

    await bootstrapRepositoryServices({
      fixtureRepository: fixtureJourneyRepository,
      renderServices,
      openDatabase: vi.fn(async () => { throw new Error('IndexedDB unavailable'); }),
      createPrivateRepository: vi.fn(),
    });

    expect(renderServices).toHaveBeenCalledTimes(1);
    expect(renderServices).toHaveBeenLastCalledWith({ query: fixtureJourneyRepository });
  });

  it('opens the database exactly once', async () => {
    const openDatabase = vi.fn(async () => ({}));

    await bootstrapRepositoryServices({
      fixtureRepository: fixtureJourneyRepository,
      renderServices: vi.fn(),
      openDatabase,
      createPrivateRepository: vi.fn(() => createPrivateRepository()),
    });

    expect(openDatabase).toHaveBeenCalledTimes(1);
  });
});
