import { useCallback, useEffect, useState } from 'react';
import { useGuardedNavigate } from '../../app/navigationGuard';
import { useJourneyRepository, useRepositoryRevision } from '../../data/RepositoryContext';
import type { CountrySummary } from '../../domain/model';
import { WorldMap } from './WorldMap';

export function AtlasPage() {
  const repository = useJourneyRepository();
  const repositoryRevision = useRepositoryRevision();
  const navigate = useGuardedNavigate();
  const [countries, setCountries] = useState<CountrySummary[]>();

  useEffect(() => {
    let isCurrent = true;
    setCountries(undefined);

    void repository.listCountrySummaries().then((summaries) => {
      if (isCurrent) setCountries(summaries);
    });

    return () => {
      isCurrent = false;
    };
  }, [repository, repositoryRevision]);

  const selectCountry = useCallback((countryCode: string) => {
    navigate(`/countries/${countryCode}`);
  }, [navigate]);

  if (!countries) return <section className="page map-loading" aria-label="載入旅行地圖" />;
  if (countries.length === 0) {
    return <section className="page empty-state"><h1>還沒有旅行</h1></section>;
  }

  return (
    <section className="page">
      <p className="eyebrow">聽見過的地方</p>
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
