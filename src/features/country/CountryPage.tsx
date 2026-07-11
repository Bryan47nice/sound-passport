import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useJourneyRepository } from '../../data/RepositoryContext';
import type { Journey } from '../../domain/model';

export function CountryPage() {
  const { countryCode = '' } = useParams();
  const repository = useJourneyRepository();
  const [journeys, setJourneys] = useState<Journey[]>();

  useEffect(() => {
    let isCurrent = true;

    void repository.listJourneysByCountry(countryCode).then((value) => {
      if (isCurrent) setJourneys(value);
    });

    return () => {
      isCurrent = false;
    };
  }, [countryCode, repository]);

  if (!journeys) return <section className="page" aria-label="載入國家旅程" />;
  if (journeys.length === 0) {
    return <section className="page empty-state"><h1>找不到這個國家的旅程</h1></section>;
  }

  return (
    <section className="page">
      <p className="eyebrow">{journeys.length} 趟旅程</p>
      <h1 className="page-title">{journeys[0].countryName}</h1>
      <div className="journey-list">
        {journeys.map((journey) => (
          <Link className="journey-row" key={journey.id} to={`/journeys/${journey.id}`}>
            <span className="journey-summary">
              <strong>{journey.title}</strong>
              <small>{journey.startDate} 至 {journey.endDate}</small>
            </span>
            <span className="journey-cities">{journey.cityLabels.join('、')}</span>
            <span className="journey-arrow" aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
