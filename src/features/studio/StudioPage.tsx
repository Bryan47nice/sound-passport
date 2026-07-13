import { Download, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { GuardedLink } from '../../app/navigationGuard';
import { useOptionalJourneyEditorRepository } from '../../data/RepositoryContext';
import type { JourneyEditorRepository } from '../../data/ports';
import type { Journey, JourneyStatus, JourneyStory } from '../../domain/model';
import { JourneyPhoto } from '../../media/JourneyPhoto';
import { filterJourneysByStudioStatus } from './studioFilters';
import { useMobileStudio } from './useMobileStudio';

type JourneyRow = {
  journey: Journey;
  momentCount: number;
  missingCaptionCount: number;
  missingReasonCount: number;
  missingYouTubeCount: number;
};

type DashboardState =
  | { kind: 'unavailable' }
  | { kind: 'loading'; editor: JourneyEditorRepository }
  | { kind: 'ready'; editor: JourneyEditorRepository; rows: JourneyRow[] }
  | { kind: 'error'; editor: JourneyEditorRepository };

type StudioPageProps = {
  onBootstrapRetry?: () => void;
};

const tabs: { label: string; status: JourneyStatus }[] = [
  { label: '草稿', status: 'draft' },
  { label: '待整理', status: 'review' },
  { label: '已完成', status: 'complete' },
];

function createRows(journeys: Journey[], stories: (JourneyStory | undefined)[]): JourneyRow[] {
  return journeys.map((journey, index) => {
    const moments = stories[index]?.moments ?? [];
    return {
      journey,
      momentCount: moments.length,
      missingCaptionCount: moments.filter((moment) => !moment.caption.trim()).length,
      missingReasonCount: moments.filter((moment) => !moment.reason.trim()).length,
      missingYouTubeCount: moments.filter((moment) => moment.song.availability !== 'available').length,
    };
  });
}

const updatedAtFormatter = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function StudioPage({ onBootstrapRetry = () => window.location.reload() }: StudioPageProps) {
  const editor = useOptionalJourneyEditorRepository();
  const isMobile = useMobileStudio();
  const [status, setStatus] = useState<JourneyStatus>('draft');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [dashboard, setDashboard] = useState<DashboardState>(
    () => editor ? { kind: 'loading', editor } : { kind: 'unavailable' },
  );
  const tabRefs = useRef<Record<JourneyStatus, HTMLButtonElement | null>>({
    draft: null,
    review: null,
    complete: null,
  });

  useEffect(() => {
    let isCurrent = true;
    if (!editor) {
      setDashboard({ kind: 'unavailable' });
      return () => { isCurrent = false; };
    }

    setDashboard({ kind: 'loading', editor });

    void editor.listPrivateJourneys().then(async (journeys) => {
      const stories = await Promise.all(journeys.map((journey) => editor.getPrivateJourneyStory(journey.id)));
      if (isCurrent) setDashboard({ kind: 'ready', editor, rows: createRows(journeys, stories) });
    }).catch(() => {
      if (isCurrent) setDashboard({ kind: 'error', editor });
    });

    return () => { isCurrent = false; };
  }, [editor, loadAttempt]);

  const currentDashboard: DashboardState = !editor
    ? { kind: 'unavailable' }
    : dashboard.kind === 'unavailable' || dashboard.editor !== editor
      ? { kind: 'loading', editor }
      : dashboard;

  if (isMobile) {
    return (
      <section className="page studio-guidance">
        <p className="eyebrow">整理工作台</p>
        <h1 className="page-title">請使用電腦整理旅程</h1>
        <p className="muted">旅程回顧仍可在此裝置查看。</p>
      </section>
    );
  }

  if (currentDashboard.kind === 'unavailable') {
    return (
      <section className="page studio-guidance">
        <p className="eyebrow">整理工作台</p>
        <h1 className="page-title">本機儲存空間暫時無法使用</h1>
        <p className="muted">請確認瀏覽器允許本機儲存後重新開啟；世界地圖的示範旅程仍可使用。</p>
        <button className="secondary-command studio-state-action" type="button" onClick={onBootstrapRetry}>
          <RefreshCw size={17} aria-hidden="true" />重新嘗試
        </button>
      </section>
    );
  }

  const visibleRows = currentDashboard.kind === 'ready'
    ? filterJourneysByStudioStatus(currentDashboard.rows.map((row) => row.journey), status)
      .map((journey) => currentDashboard.rows.find((row) => row.journey.id === journey.id)!)
    : [];

  const selectTab = (nextStatus: JourneyStatus) => {
    setStatus(nextStatus);
    tabRefs.current[nextStatus]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tabStatus: JourneyStatus) => {
    const currentIndex = tabs.findIndex((tab) => tab.status === tabStatus);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    selectTab(tabs[nextIndex].status);
  };

  return (
    <section className="page studio-page">
      <div className="studio-heading">
        <div>
          <p className="eyebrow">私人旅程</p>
          <h1 className="page-title">整理旅程</h1>
        </div>
        <div className="studio-toolbar" role="toolbar" aria-label="旅程工具">
          <GuardedLink className="primary-command studio-create-command" to="/studio/journeys/new">
            <Plus size={18} aria-hidden="true" />新增旅程
          </GuardedLink>
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
            ref={(node) => { tabRefs.current[tab.status] = node; }}
            id={`studio-tab-${tab.status}`}
            type="button"
            role="tab"
            aria-controls="studio-panel"
            aria-selected={status === tab.status}
            tabIndex={status === tab.status ? 0 : -1}
            className={status === tab.status ? 'is-active' : undefined}
            onClick={() => setStatus(tab.status)}
            onKeyDown={(event) => handleTabKeyDown(event, tab.status)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className="studio-panel"
        id="studio-panel"
        role="tabpanel"
        aria-labelledby={`studio-tab-${status}`}
      >
        {currentDashboard.kind === 'loading' ? (
          <section className="studio-loading" aria-live="polite">
            <p>正在載入私人旅程…</p>
          </section>
        ) : currentDashboard.kind === 'error' ? (
          <section className="studio-error" role="alert">
            <h2>無法載入私人旅程</h2>
            <p>讀取本機旅程時發生問題，請重新載入。</p>
            <button
              className="secondary-command studio-state-action"
              type="button"
              onClick={() => {
                setDashboard({ kind: 'loading', editor: currentDashboard.editor });
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              <RefreshCw size={17} aria-hidden="true" />重新載入
            </button>
          </section>
        ) : visibleRows.length === 0 ? (
          <section className="studio-empty">
            <p>這裡還沒有{tabs.find((tab) => tab.status === status)?.label}旅程。</p>
            {status === 'draft' && <GuardedLink className="primary-command" to="/studio/journeys/new"><Plus size={18} aria-hidden="true" />新增第一趟旅程</GuardedLink>}
          </section>
        ) : (
          <div className="studio-table-wrap">
            <table className="studio-table">
              <thead><tr><th scope="col">封面</th><th scope="col">旅程</th><th scope="col">國家</th><th scope="col">日期</th><th scope="col">時刻</th><th scope="col">待補欄位</th><th scope="col">更新時間</th></tr></thead>
              <tbody>
                {visibleRows.map(({ journey, momentCount, missingCaptionCount, missingReasonCount, missingYouTubeCount }) => (
                  <tr key={journey.id}>
                    <td className="studio-cover-cell">
                      <div className="studio-cover-frame">
                        {journey.coverPhotoAssetId ? (
                          <JourneyPhoto
                            alt={`${journey.title}封面`}
                            className="studio-cover-thumb"
                            photoAssetId={journey.coverPhotoAssetId}
                          />
                        ) : (
                          <span className="studio-cover-placeholder" aria-label="尚未設定封面">無封面</span>
                        )}
                      </div>
                    </td>
                    <th scope="row"><GuardedLink to={`/studio/journeys/${journey.id}`}>{journey.title}</GuardedLink></th>
                    <td>{journey.countryName}</td>
                    <td>{journey.startDate} 至 {journey.endDate}</td>
                    <td>{momentCount} 個時刻</td>
                    <td>
                      <div className="studio-missing-badges" aria-label="待補欄位數量">
                        <span>YouTube <strong>{missingYouTubeCount}</strong></span>
                        <span>圖說 <strong>{missingCaptionCount}</strong></span>
                        <span>原因 <strong>{missingReasonCount}</strong></span>
                      </div>
                    </td>
                    <td><time dateTime={journey.updatedAt}>{updatedAtFormatter.format(new Date(journey.updatedAt))}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
