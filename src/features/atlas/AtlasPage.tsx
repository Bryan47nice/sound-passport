import { useCallback, useEffect, useState } from 'react';
import { useGuardedNavigate } from '../../app/navigationGuard';
import { useJourneyRepository, useRepositoryRevision } from '../../data/RepositoryContext';
import type { CountrySummary } from '../../domain/model';
import { JourneyQueryError } from '../../data/storageErrors';
import { WorldMap } from './WorldMap';

export function AtlasPage() {
  const repository = useJourneyRepository();
  const repositoryRevision = useRepositoryRevision();
  const navigate = useGuardedNavigate();
  const [countries, setCountries] = useState<CountrySummary[]>();
  const [loadError, setLoadError] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [retryGeneration, setRetryGeneration] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    setCountries(undefined);
    setLoadError(false);
    setDegraded(false);

    void repository.listCountrySummaries()
      .then((summaries) => {
        if (isCurrent) setCountries(summaries);
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        if (error instanceof JourneyQueryError && Array.isArray(error.fallback)) {
          setCountries(error.fallback as CountrySummary[]);
          setDegraded(true);
        } else {
          setLoadError(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [repository, repositoryRevision, retryGeneration]);

  const selectCountry = useCallback((countryCode: string) => {
    navigate(`/countries/${countryCode}`);
  }, [navigate]);

  const retry = () => setRetryGeneration((current) => current + 1);

  if (loadError) {
    return (
      <section className="page empty-state">
        <h1>無法讀取旅行地圖</h1>
        <button type="button" className="secondary-command" onClick={retry}>重新讀取</button>
      </section>
    );
  }
  if (!countries) return <section className="page map-loading" aria-label="載入旅行地圖" />;
  if (countries.length === 0) {
    return <section className="page empty-state"><h1>還沒有旅行</h1></section>;
  }

  return (
    <section className="page">
      <p className="eyebrow">聽見過的地方</p>
      <h1 className="page-title">我的旅行世界</h1>
      <p className="muted">選一個國家，回到某一次旅程。</p>
      {degraded && (
        <div className="query-warning" role="alert">
          <span>私人旅程暫時無法讀取，目前只顯示示範旅程。</span>
          <button type="button" onClick={retry}>重新讀取</button>
        </div>
      )}
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
