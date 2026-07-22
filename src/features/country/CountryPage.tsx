import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { experiencePath, useJourneyExperience, type JourneyExperienceValue } from '../../app/JourneyExperienceContext';
import { GuardedLink } from '../../app/navigationGuard';
import { useInvalidateRepositoryQueries, usePrivateStorageError, useRepositoryRevision } from '../../data/RepositoryContext';
import type { Journey } from '../../domain/model';

type CountryLoadState =
  | { kind: 'loading'; countryCode: string; experience: JourneyExperienceValue; repositoryRevision: number }
  | { kind: 'ready'; countryCode: string; experience: JourneyExperienceValue; repositoryRevision: number; journeys: Journey[] }
  | { kind: 'error'; countryCode: string; experience: JourneyExperienceValue; repositoryRevision: number };

export function CountryPage() {
  const { countryCode = '' } = useParams();
  const experience = useJourneyExperience();
  const { kind, repository, routePrefix } = experience;
  const repositoryRevision = useRepositoryRevision();
  const privateStorageError = usePrivateStorageError();
  const invalidateQueries = useInvalidateRepositoryQueries();
  const [loadState, setLoadState] = useState<CountryLoadState>({
    kind: 'loading',
    countryCode,
    experience,
    repositoryRevision,
  });

  useEffect(() => {
    let isCurrent = true;
    setLoadState({ kind: 'loading', countryCode, experience, repositoryRevision });

    void repository.listJourneysByCountry(countryCode)
      .then((journeys) => {
        if (isCurrent) setLoadState({ kind: 'ready', countryCode, experience, repositoryRevision, journeys });
      })
      .catch(() => {
        if (isCurrent) setLoadState({ kind: 'error', countryCode, experience, repositoryRevision });
      });

    return () => { isCurrent = false; };
  }, [countryCode, experience, repository, repositoryRevision]);

  if (kind === 'private' && privateStorageError) {
    return (
      <section className="page empty-state" role="alert">
        <h1>無法讀取私人資料</h1>
        <p>{privateStorageError}</p>
        <p>請重新整理頁面後再試一次。</p>
      </section>
    );
  }

  const currentState = loadState.countryCode === countryCode
    && loadState.experience === experience
    && loadState.repositoryRevision === repositoryRevision
    ? loadState
    : { kind: 'loading' } as const;

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
