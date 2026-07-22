import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { experiencePath, useJourneyExperience } from '../../app/JourneyExperienceContext';
import { GuardedLink } from '../../app/navigationGuard';
import { useInvalidateRepositoryQueries, useRepositoryRevision } from '../../data/RepositoryContext';
import type { Journey } from '../../domain/model';

type CountryLoadState =
  | { kind: 'loading'; countryCode: string }
  | { kind: 'ready'; countryCode: string; journeys: Journey[] }
  | { kind: 'error'; countryCode: string };

export function CountryPage() {
  const { countryCode = '' } = useParams();
  const { kind, repository, routePrefix } = useJourneyExperience();
  const repositoryRevision = useRepositoryRevision();
  const invalidateQueries = useInvalidateRepositoryQueries();
  const [loadState, setLoadState] = useState<CountryLoadState>({ kind: 'loading', countryCode });

  useEffect(() => {
    let isCurrent = true;
    setLoadState({ kind: 'loading', countryCode });

    void repository.listJourneysByCountry(countryCode)
      .then((journeys) => {
        if (isCurrent) setLoadState({ kind: 'ready', countryCode, journeys });
      })
      .catch(() => {
        if (isCurrent) setLoadState({ kind: 'error', countryCode });
      });

    return () => { isCurrent = false; };
  }, [countryCode, repository, repositoryRevision]);

  const currentState = loadState.countryCode === countryCode
    ? loadState
    : { kind: 'loading', countryCode } as const;

  if (currentState.kind === 'loading') return <section className="page" aria-label="載入國家旅程" />;
  if (currentState.kind === 'error') {
    return (
      <section className="page empty-state" role="alert">
        <h1>{kind === 'private' ? '無法讀取私人資料' : '無法讀取國家旅程'}</h1>
        <p>請重新讀取後再試一次。</p>
        <button className="secondary-command" type="button" onClick={invalidateQueries}>重新讀取</button>
      </section>
    );
  }

  const { journeys } = currentState;
  if (journeys.length === 0) {
    return <section className="page empty-state"><h1>找不到這個國家的旅程</h1></section>;
  }

  return (
    <section className="page">
      <p className="eyebrow">{journeys.length} 趟旅程</p>
      <h1 className="page-title">{journeys[0].countryName}</h1>
      <div className="journey-list">
        {journeys.map((journey) => (
          <GuardedLink className="journey-row" key={journey.id} to={experiencePath(routePrefix, `/journeys/${journey.id}`)}>
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
