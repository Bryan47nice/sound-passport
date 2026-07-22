import { useCallback, useEffect, useState } from 'react';
import { experiencePath, useJourneyExperience } from '../../app/JourneyExperienceContext';
import { GuardedLink, useGuardedNavigate } from '../../app/navigationGuard';
import { useRepositoryRevision } from '../../data/RepositoryContext';
import type { CountrySummary } from '../../domain/model';
import { WorldMap } from './WorldMap';

export function AtlasPage() {
  const { kind, repository, routePrefix } = useJourneyExperience();
  const repositoryRevision = useRepositoryRevision();
  const navigate = useGuardedNavigate();
  const [countries, setCountries] = useState<CountrySummary[]>();
  const [loadError, setLoadError] = useState(false);
  const [retryGeneration, setRetryGeneration] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    setCountries(undefined);
    setLoadError(false);

    void repository.listCountrySummaries()
      .then((summaries) => {
        if (isCurrent) setCountries(summaries);
      })
      .catch(() => {
        if (isCurrent) setLoadError(true);
      });

    return () => { isCurrent = false; };
  }, [repository, repositoryRevision, retryGeneration]);

  const selectCountry = useCallback((countryCode: string) => {
    navigate(experiencePath(routePrefix, `/countries/${countryCode}`));
  }, [navigate, routePrefix]);

  if (loadError) {
    return (
      <section className="page empty-state">
        <h1>{kind === 'private' ? '無法讀取私人資料' : '無法讀取旅行地圖'}</h1>
        <button type="button" className="secondary-command" onClick={() => setRetryGeneration((value) => value + 1)}>重新讀取</button>
      </section>
    );
  }
  if (!countries) return <section className="page map-loading" aria-label="載入旅行地圖" />;
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
