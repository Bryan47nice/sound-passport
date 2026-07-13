import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useOptionalJourneyEditorRepository } from '../../data/RepositoryContext';
import type { Journey, JourneyStatus, JourneyStory } from '../../domain/model';
import { filterJourneysByStudioStatus } from './studioFilters';

type JourneyRow = {
  journey: Journey;
  momentCount: number;
  missingYouTubeCount: number;
};

const tabs: { label: string; status: JourneyStatus }[] = [
  { label: '草稿', status: 'draft' },
  { label: '待整理', status: 'review' },
  { label: '已完成', status: 'complete' },
];

function useMobileStudio() {
  const query = '(max-width: 640px)';
  const [isMobile, setIsMobile] = useState(() => window.matchMedia?.(query).matches ?? false);

  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
}

function createRows(journeys: Journey[], stories: (JourneyStory | undefined)[]): JourneyRow[] {
  return journeys.map((journey, index) => {
    const moments = stories[index]?.moments ?? [];
    return {
      journey,
      momentCount: moments.length,
      missingYouTubeCount: moments.filter((moment) => moment.song.availability === 'needs_link').length,
    };
  });
}

export function StudioPage() {
  const editor = useOptionalJourneyEditorRepository();
  const isMobile = useMobileStudio();
  const [status, setStatus] = useState<JourneyStatus>('draft');
  const [rows, setRows] = useState<JourneyRow[]>();

  useEffect(() => {
    let isCurrent = true;
    if (!editor) return () => { isCurrent = false; };

    void editor.listPrivateJourneys().then(async (journeys) => {
      const stories = await Promise.all(journeys.map((journey) => editor.getPrivateJourneyStory(journey.id)));
      if (isCurrent) setRows(createRows(journeys, stories));
    }).catch(() => {
      if (isCurrent) setRows([]);
    });

    return () => { isCurrent = false; };
  }, [editor]);

  if (isMobile) {
    return (
      <section className="page studio-guidance">
        <p className="eyebrow">整理工作台</p>
        <h1 className="page-title">請使用電腦整理旅程</h1>
        <p className="muted">旅程回顧仍可在此裝置查看。</p>
      </section>
    );
  }

  if (!editor) {
    return (
      <section className="page studio-guidance">
        <p className="eyebrow">整理工作台</p>
        <h1 className="page-title">本機儲存空間暫時無法使用</h1>
        <p className="muted">請確認瀏覽器允許本機儲存後重新開啟；世界地圖的示範旅程仍可使用。</p>
      </section>
    );
  }

  const visibleRows = rows ? filterJourneysByStudioStatus(rows.map((row) => row.journey), status)
    .map((journey) => rows.find((row) => row.journey.id === journey.id)!) : undefined;

  return (
    <section className="page studio-page">
      <div className="studio-heading">
        <div>
          <p className="eyebrow">私人旅程</p>
          <h1 className="page-title">整理旅程</h1>
        </div>
        <div className="studio-toolbar" role="toolbar" aria-label="旅程工具">
          <Link className="primary-command studio-create-command" to="/studio/journeys/new">
            <Plus size={18} aria-hidden="true" />新增旅程
          </Link>
          <button className="icon-command" type="button" disabled title="即將可用" aria-label="匯出備份，即將可用">
            <Download size={18} aria-hidden="true" />
          </button>
          <button className="icon-command" type="button" disabled title="即將可用" aria-label="匯入備份，即將可用">
            <Upload size={18} aria-hidden="true" />
          </button>
          <button className="icon-command" type="button" disabled title="即將可用" aria-label="清除私人資料，即將可用">
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="studio-tabs" role="tablist" aria-label="旅程狀態">
        {tabs.map((tab) => (
          <button
            key={tab.status}
            type="button"
            role="tab"
            aria-selected={status === tab.status}
            className={status === tab.status ? 'is-active' : undefined}
            onClick={() => setStatus(tab.status)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!visibleRows ? <section className="studio-loading" aria-label="載入私人旅程" /> : visibleRows.length === 0 ? (
        <section className="studio-empty">
          <p>這裡還沒有{tabs.find((tab) => tab.status === status)?.label}旅程。</p>
          {status === 'draft' && <Link className="primary-command" to="/studio/journeys/new"><Plus size={18} aria-hidden="true" />新增第一趟旅程</Link>}
        </section>
      ) : (
        <div className="studio-table-wrap">
          <table className="studio-table">
            <thead><tr><th scope="col">旅程</th><th scope="col">國家</th><th scope="col">日期</th><th scope="col">時刻</th><th scope="col">YouTube</th><th scope="col">更新時間</th></tr></thead>
            <tbody>
              {visibleRows.map(({ journey, momentCount, missingYouTubeCount }) => (
                <tr key={journey.id}>
                  <th scope="row"><Link to={`/studio/journeys/${journey.id}`}>{journey.title}</Link></th>
                  <td>{journey.countryName}</td>
                  <td>{journey.startDate} 至 {journey.endDate}</td>
                  <td>{momentCount} 個時刻</td>
                  <td>{missingYouTubeCount} 個 YouTube 待補</td>
                  <td><time dateTime={journey.updatedAt}>{journey.updatedAt.slice(0, 16).replace('T', ' ')}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
