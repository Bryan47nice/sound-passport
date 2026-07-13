import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useJourneyRepository } from '../../data/RepositoryContext';
import { formatLocalDateTime } from '../../domain/dateTime';
import type { JourneyStory } from '../../domain/model';

export function JourneyPage() {
  const { journeyId = '' } = useParams();
  const repository = useJourneyRepository();
  const [story, setStory] = useState<JourneyStory>();
  const [loaded, setLoaded] = useState(false);
  const [resolvedJourneyId, setResolvedJourneyId] = useState<string>();

  useEffect(() => {
    let isCurrent = true;
    setStory(undefined);
    setLoaded(false);

    void repository.getJourneyStory(journeyId).then((value) => {
      if (isCurrent) {
        setStory(value);
        setResolvedJourneyId(journeyId);
        setLoaded(true);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [journeyId, repository]);

  if (!loaded || resolvedJourneyId !== journeyId) return <section className="page" aria-label="載入旅程" />;
  if (!story) return <section className="page empty-state"><h1>找不到這趟旅程</h1></section>;

  return (
    <section className="page">
      <p className="eyebrow">{story.journey.countryName} · {story.journey.startDate}</p>
      <h1 className="page-title">{story.journey.title}</h1>
      <Link className="primary-command" to={`/journeys/${story.journey.id}/play`}>播放這趟旅程</Link>
      <ol className="moment-list">
        {story.moments.map((moment) => (
          <li className="moment-row" key={moment.id}>
            <span className="moment-number">{String(moment.sortOrder + 1).padStart(2, '0')}</span>
            <img className="moment-thumb" src={moment.photoUrl} alt={moment.photoAlt} />
            <span className="moment-details">
              <strong>{moment.cityLabel} · {moment.placeLabel}</strong>
              <small>{formatLocalDateTime(moment.localDate, moment.localTime)} · {moment.song.title} · {moment.song.artist}</small>
            </span>
            <p>{moment.reason || '旅後待補'}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
