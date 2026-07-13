import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { JourneyEditorRepository } from '../../data/ports';
import type { JourneyMoment } from '../../domain/model';

interface MomentListProps {
  journeyId: string;
  moments: JourneyMoment[];
  selectedMomentId?: string;
  repository: Pick<JourneyEditorRepository, 'reorderMoments'>;
  onSelect: (momentId: string) => void;
  onBeforeReorder?: () => void | Promise<void>;
  onOrderChange?: (orderedIds: string[]) => void;
  onReordered?: (orderedIds: string[]) => void | Promise<void>;
  headerActions?: ReactNode;
}

interface SortableMomentOptionProps {
  moment: JourneyMoment;
  index: number;
  count: number;
  selected: boolean;
  tabbable: boolean;
  onSelect: () => void;
  onNavigate: (key: OptionNavigationKey) => void;
  onNodeChange: (node: HTMLLIElement | null) => void;
  onMove: (direction: -1 | 1) => void;
}

type OptionNavigationKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

interface ReorderFailure {
  kind: 'persistence' | 'refresh';
  orderedIds: string[];
}

const chineseDigits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function chinesePosition(index: number) {
  const value = index + 1;
  if (value < 10) return `第${chineseDigits[value]}`;
  if (value === 10) return '第十';
  if (value < 20) return `第十${chineseDigits[value - 10]}`;
  if (value < 100) {
    const ones = value % 10;
    return `第${chineseDigits[Math.floor(value / 10)]}十${chineseDigits[ones]}`;
  }
  return `第${value}`;
}

function SortableMomentOption({
  moment,
  index,
  count,
  selected,
  tabbable,
  onSelect,
  onNavigate,
  onNodeChange,
  onMove,
}: SortableMomentOptionProps) {
  const position = chinesePosition(index);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: moment.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onNavigate(event.key);
    }
  };
  const stopAndMove = (event: MouseEvent<HTMLButtonElement>, direction: -1 | 1) => {
    event.stopPropagation();
    onMove(direction);
  };

  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        onNodeChange(node);
      }}
      role="option"
      tabIndex={tabbable ? 0 : -1}
      data-id={moment.id}
      aria-selected={selected}
      className={`${selected ? 'is-current' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={style}
      onClick={onSelect}
      onKeyDown={handleOptionKeyDown}
    >
      <button
        className="moment-drag-handle"
        type="button"
        aria-label={`拖曳${position}則`}
        title={`拖曳${position}則`}
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <span className="moment-list-index">{String(index + 1).padStart(2, '0')}</span>
      <div className="moment-list-copy">
        <strong>{moment.song.title || '尚未填寫歌名'}</strong>
        <small>{moment.placeLabel || moment.cityLabel || moment.localDate}</small>
      </div>
      <div className="moment-order-actions">
        <button
          type="button"
          aria-label={`將${position}則上移`}
          title={`將${position}則上移`}
          disabled={index === 0}
          onClick={(event) => stopAndMove(event, -1)}
        >
          <ChevronUp size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`將${position}則下移`}
          title={`將${position}則下移`}
          disabled={index === count - 1}
          onClick={(event) => stopAndMove(event, 1)}
        >
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export function MomentList({
  journeyId,
  moments,
  selectedMomentId,
  repository,
  onSelect,
  onBeforeReorder,
  onOrderChange,
  onReordered,
  headerActions,
}: MomentListProps) {
  const [orderedMoments, setOrderedMoments] = useState(moments);
  const [reorderFailure, setReorderFailure] = useState<ReorderFailure>();
  const orderedMomentsRef = useRef(moments);
  const persistenceTailRef = useRef<Promise<void>>(Promise.resolve());
  const latestGenerationRef = useRef(0);
  const protectedGenerationRef = useRef<number | undefined>(undefined);
  const confirmedGenerationRef = useRef<number | undefined>(undefined);
  const optionNodesRef = useRef(new Map<string, HTMLLIElement>());
  const mountedRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useLayoutEffect(() => {
    let nextMoments = moments;
    if (protectedGenerationRef.current !== undefined) {
      const currentIds = orderedMomentsRef.current.map(({ id }) => id);
      const incomingIds = moments.map(({ id }) => id);
      const confirmed = confirmedGenerationRef.current === protectedGenerationRef.current;
      const carriesProtectedOrder =
        incomingIds.length === currentIds.length &&
        incomingIds.every((id, index) => id === currentIds[index]);
      if (confirmed && carriesProtectedOrder) {
        protectedGenerationRef.current = undefined;
        confirmedGenerationRef.current = undefined;
      } else {
        const momentsById = new Map(moments.map((moment) => [moment.id, moment]));
        const protectedIds = new Set(orderedMomentsRef.current.map(({ id }) => id));
        nextMoments = [
          ...orderedMomentsRef.current.flatMap(({ id }) => {
            const next = momentsById.get(id);
            return next ? [next] : [];
          }),
          ...moments.filter(({ id }) => !protectedIds.has(id)),
        ];
      }
    }
    orderedMomentsRef.current = nextMoments;
    setOrderedMoments(nextMoments);
  }, [moments]);

  const refreshOrder = async (generation: number, orderedIds: string[]) => {
    if (!onReordered) {
      if (generation === latestGenerationRef.current) confirmedGenerationRef.current = generation;
      return;
    }
    try {
      await onReordered(orderedIds);
    } catch {
      if (mountedRef.current && generation === latestGenerationRef.current) {
        setReorderFailure({ kind: 'refresh', orderedIds: [...orderedIds] });
      }
      return;
    }
    if (mountedRef.current && generation === latestGenerationRef.current) {
      confirmedGenerationRef.current = generation;
      setReorderFailure(undefined);
    }
  };

  const enqueuePersistence = (orderedIds: string[]) => {
    const generation = latestGenerationRef.current + 1;
    latestGenerationRef.current = generation;
    protectedGenerationRef.current = generation;
    confirmedGenerationRef.current = undefined;
    setReorderFailure(undefined);

    const persist = async () => {
      try {
        await onBeforeReorder?.();
        await repository.reorderMoments(journeyId, orderedIds);
      } catch {
        if (mountedRef.current && generation === latestGenerationRef.current) {
          setReorderFailure({ kind: 'persistence', orderedIds: [...orderedIds] });
        }
        return;
      }
      if (generation === latestGenerationRef.current) await refreshOrder(generation, orderedIds);
    };
    const queued = persistenceTailRef.current.then(persist, persist);
    persistenceTailRef.current = queued.then(() => undefined, () => undefined);
  };

  const commitOrder = (nextMoments: JourneyMoment[]) => {
    const orderedIds = nextMoments.map((moment) => moment.id);
    orderedMomentsRef.current = nextMoments;
    setOrderedMoments(nextMoments);
    enqueuePersistence(orderedIds);
    onOrderChange?.(orderedIds);
  };

  const move = (momentId: string, direction: -1 | 1) => {
    const currentMoments = orderedMomentsRef.current;
    const index = currentMoments.findIndex(({ id }) => id === momentId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= currentMoments.length) return;
    commitOrder(arrayMove(currentMoments, index, target));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const currentMoments = orderedMomentsRef.current;
    const activeIndex = currentMoments.findIndex((moment) => moment.id === active.id);
    const overIndex = currentMoments.findIndex((moment) => moment.id === over.id);
    if (activeIndex < 0 || overIndex < 0) return;
    commitOrder(arrayMove(currentMoments, activeIndex, overIndex));
  };

  const navigateOption = (momentId: string, key: OptionNavigationKey) => {
    const currentMoments = orderedMomentsRef.current;
    const currentIndex = currentMoments.findIndex(({ id }) => id === momentId);
    if (currentIndex < 0) return;
    let targetIndex = currentIndex;
    if (key === 'ArrowUp') targetIndex = Math.max(0, currentIndex - 1);
    if (key === 'ArrowDown') targetIndex = Math.min(currentMoments.length - 1, currentIndex + 1);
    if (key === 'Home') targetIndex = 0;
    if (key === 'End') targetIndex = currentMoments.length - 1;
    const targetId = currentMoments[targetIndex]?.id;
    if (!targetId) return;
    optionNodesRef.current.get(targetId)?.focus();
    onSelect(targetId);
  };

  const retryPersistence = () => {
    if (reorderFailure?.kind !== 'persistence') return;
    enqueuePersistence(reorderFailure.orderedIds);
  };

  const retryRefresh = () => {
    if (reorderFailure?.kind !== 'refresh') return;
    const generation = latestGenerationRef.current;
    const orderedIds = reorderFailure.orderedIds;
    setReorderFailure(undefined);
    void refreshOrder(generation, orderedIds);
  };

  const renderedIds = orderedMoments.map((moment) => moment.id);
  const selectedExists = orderedMoments.some(({ id }) => id === selectedMomentId);
  const tabStopId = selectedExists ? selectedMomentId : orderedMoments[0]?.id;

  return (
    <section className="journey-moment-list" aria-label="時刻清單">
      <div className="journey-region-heading">
        <h2>時刻</h2>
        <span>{orderedMoments.length}</span>
      </div>
      {headerActions}
      {orderedMoments.length === 0 ? (
        <p className="muted moment-list-empty">尚無時刻</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={renderedIds} strategy={verticalListSortingStrategy}>
            <ol role="listbox" aria-label="時刻排序">
              {orderedMoments.map((moment, index) => (
                <SortableMomentOption
                  key={moment.id}
                  moment={moment}
                  index={index}
                  count={orderedMoments.length}
                  selected={moment.id === selectedMomentId}
                  tabbable={moment.id === tabStopId}
                  onSelect={() => onSelect(moment.id)}
                  onNavigate={(key) => navigateOption(moment.id, key)}
                  onNodeChange={(node) => {
                    if (node) optionNodesRef.current.set(moment.id, node);
                    else optionNodesRef.current.delete(moment.id);
                  }}
                  onMove={(direction) => move(moment.id, direction)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {reorderFailure && (
        <div className="moment-reorder-error field-error" role="alert">
          <span>
            {reorderFailure.kind === 'persistence'
              ? '無法儲存時刻順序，請再試一次。'
              : '順序已儲存，但重新載入失敗。'}
          </span>
          <button
            type="button"
            onClick={reorderFailure.kind === 'persistence' ? retryPersistence : retryRefresh}
          >
            {reorderFailure.kind === 'persistence' ? '重試儲存' : '重新載入'}
          </button>
        </div>
      )}
    </section>
  );
}
