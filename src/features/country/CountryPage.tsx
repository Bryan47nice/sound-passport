import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { GuardedLink } from '../../app/navigationGuard';
import {
  useInvalidateRepositoryQueries,
  useJourneyRepository,
  useRepositoryRevision,
} from '../../data/RepositoryContext';
import { JourneyQueryError } from '../../data/storageErrors';
import type { Journey } from '../../domain/model';

type CountryLoadState =
  | { kind: 'loading'; countryCode: string }
  | { kind: 'ready'; countryCode: string; journeys: Journey[]; degraded: boolean }
  | { kind: 'error'; countryCode: string };

export function CountryPage() {
  const { countryCode = '' } = useParams();
  const repository = useJourneyRepository();
  const repositoryRevision = useRepositoryRevision();
  const invalidateQueries = useInvalidateRepositoryQueries();
  const [loadState, setLoadState] = useState<CountryLoadState>(() => ({
    kind: 'loading',
    countryCode,
  }));

  useEffect(() => {
    let isCurrent = true;
    setLoadState({ kind: 'loading', countryCode });

    void repository.listJourneysByCountry(countryCode)
      .then((journeys) => {
        if (isCurrent) setLoadState({ kind: 'ready', countryCode, journeys, degraded: false });
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        if (error instanceof JourneyQueryError && Array.isArray(error.fallback)) {
          setLoadState({
            kind: 'ready',
            countryCode,
            journeys: error.fallback as Journey[],
            degraded: true,
          });
        } else {
          setLoadState({ kind: 'error', countryCode });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [countryCode, repository, repositoryRevision]);

  const currentState = loadState.countryCode === countryCode
    ? loadState
    : { kind: 'loading', countryCode } as const;

  if (currentState.kind === 'loading') return <section className="page" aria-label="載入國家旅程" />;
  if (currentState.kind === 'error' || (currentState.degraded && currentState.journeys.length === 0)) {
    return (
      <section className="page empty-state" role="alert">
        <h1>無法讀取國家旅程</h1>
        <p>私人旅程暫時無法讀取，請重新讀取。</p>
        <button className="secondary-command" type="button" onClick={invalidateQueries}>重新讀取</button>
      </section>
    );
  }

  const { journeys, degraded } = currentState;
  if (journeys.length === 0) {
    return <section className="page empty-state"><h1>找不到這個國家的旅程</h1></section>;
  }

  return (
    <section className="page">
      <p className="eyebrow">{journeys.length} 趟旅程</p>
      <h1 className="page-title">{journeys[0].countryName}</h1>
      {degraded && (
        <div className="query-warning" role="alert">
          <span>私人旅程暫時無法讀取，目前只顯示示範旅程。</span>
          <button type="button" onClick={invalidateQueries}>重新讀取</button>
        </div>
      )}
      <div className="journey-list">
        {journeys.map((journey) => (
          <GuardedLink className="journey-row" key={journey.id} to={`/journeys/${journey.id}`}>
            <span className="journey-summary">
              <strong>{journey.title}</strong>
              <small>{journey.startDate} 至 {journey.endDate}</small>
            </span>
            <span className="journey-cities">{journey.cityLabels.join('、')}</span>
            <span className="journey-arrow" aria-hidden="true">›</span>
          </GuardedLink>
        ))}
      </div>
    </section>
  );
}
