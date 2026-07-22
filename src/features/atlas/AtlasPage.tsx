import { useCallback, useEffect, useState } from 'react';
import { experiencePath, useJourneyExperience, type JourneyExperienceValue } from '../../app/JourneyExperienceContext';
import { GuardedLink, useGuardedNavigate } from '../../app/navigationGuard';
import { usePrivateStorageError, useRepositoryRevision } from '../../data/RepositoryContext';
import type { CountrySummary } from '../../domain/model';
import { WorldMap } from './WorldMap';

type AtlasLoadState =
  | { kind: 'loading'; experience: JourneyExperienceValue; repositoryRevision: number; retryGeneration: number }
  | { kind: 'ready'; experience: JourneyExperienceValue; repositoryRevision: number; retryGeneration: number; countries: CountrySummary[] }
  | { kind: 'error'; experience: JourneyExperienceValue; repositoryRevision: number; retryGeneration: number };

export function AtlasPage() {
  const experience = useJourneyExperience();
  const { kind, repository, routePrefix } = experience;
  const repositoryRevision = useRepositoryRevision();
  const privateStorageError = usePrivateStorageError();
  const navigate = useGuardedNavigate();
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [loadState, setLoadState] = useState<AtlasLoadState>(() => ({
    kind: 'loading',
    experience,
    repositoryRevision,
    retryGeneration,
  }));

  useEffect(() => {
    let isCurrent = true;
    setLoadState({ kind: 'loading', experience, repositoryRevision, retryGeneration });

    void repository.listCountrySummaries()
      .then((summaries) => {
        if (isCurrent) {
          setLoadState({
            kind: 'ready',
            experience,
            repositoryRevision,
            retryGeneration,
            countries: summaries,
          });
        }
      })
      .catch(() => {
        if (isCurrent) setLoadState({ kind: 'error', experience, repositoryRevision, retryGeneration });
      });

    return () => { isCurrent = false; };
  }, [experience, repository, repositoryRevision, retryGeneration]);

  const selectCountry = useCallback((countryCode: string) => {
    navigate(experiencePath(routePrefix, `/countries/${countryCode}`));
  }, [navigate, routePrefix]);

  if (kind === 'private' && privateStorageError) {
    return (
      <section className="page empty-state" role="alert">
        <h1>無法讀取私人資料</h1>
        <p>{privateStorageError}</p>
        <p>請重新整理頁面後再試一次。</p>
      </section>
    );
  }

  const currentState = loadState.experience === experience
    && loadState.repositoryRevision === repositoryRevision
    && loadState.retryGeneration === retryGeneration
    ? loadState
    : { kind: 'loading' } as const;

  if (currentState.kind === 'error') {
    return (
      <section className="page empty-state">
        <h1>{kind === 'private' ? '無法讀取私人資料' : '無法讀取旅行地圖'}</h1>
        <button type="button" className="secondary-command" onClick={() => setRetryGeneration((value) => value + 1)}>重新讀取</button>
      </section>
    );
  }
  if (currentState.kind === 'loading') return <section className="page map-loading" aria-label="載入旅行地圖" />;
  const { countries } = currentState;
  if (countries.length === 0 && kind === 'private') {
    return (
      <section className="page empty-state">
        <h1>還沒有私人旅程</h1>
        <GuardedLink className="primary-command" to="/studio/journeys/new">建立第一趟旅程</GuardedLink>
        <GuardedLink className="secondary-command" to="/demo">查看示範</GuardedLink>
      </section>
    );
  }
  if (countries.length === 0) return <section className="page empty-state"><h1>還沒有示範旅程</h1></section>;

  return (
    <section className="page">
      <p className="eyebrow">{kind === 'demo' ? '探索示範' : '旅行地圖'}</p>
      <h1 className="page-title">我的旅行世界</h1>
      <p className="muted">選一個國家，回到某一次旅程。</p>
      <WorldMap countries={countries} onCountrySelect={selectCountry} />
      <div className="country-index">
        {countries.map((country) => (
          <button
            className="country-row"
            key={country.countryCode}
            onClick={() => selectCountry(country.countryCode)}
          >
            <strong>{country.countryName}</strong><br />
            <span>{country.journeyCount} 趟旅程 · {country.latestJourneyTitle}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
