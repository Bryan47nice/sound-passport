import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useJourneyRepository } from '../../data/RepositoryContext';
import type { CountrySummary } from '../../domain/model';
import { WorldMap } from './WorldMap';

export function AtlasPage() {
  const repository = useJourneyRepository();
  const navigate = useNavigate();
  const [countries, setCountries] = useState<CountrySummary[]>();

  useEffect(() => {
    let isCurrent = true;

    void repository.listCountrySummaries().then((summaries) => {
      if (isCurrent) setCountries(summaries);
    });

    return () => {
      isCurrent = false;
    };
  }, [repository]);

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
