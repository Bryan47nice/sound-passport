import type { JourneyValidationIssue } from '../../domain/journeyValidation';

function momentNumber(field: string) {
  const index = Number(field.split('.')[1]);
  return Number.isInteger(index) ? index + 1 : 1;
}

export function formatJourneyValidationIssue(issue: JourneyValidationIssue): string {
  if (issue.field === 'title') return '請填寫旅程標題。';
  if (issue.field === 'countryCode') return '請選擇國家。';
  if (issue.field === 'startDate') return '請填寫旅程開始日期。';
  if (issue.field === 'endDate' && issue.code === 'invalid_range') return '結束日期不可早於開始日期。';
  if (issue.field === 'endDate') return '請填寫旅程結束日期。';
  if (issue.field === 'moments') return '請至少加入一個音樂時刻。';

  const number = momentNumber(issue.field);
  if (issue.field.endsWith('.photo')) return `第 ${number} 則時刻需要照片。`;
  if (issue.field.endsWith('.localDate') && issue.code === 'outside_journey_range') {
    return `第 ${number} 則時刻的日期必須在旅程日期範圍內。`;
  }
  if (issue.field.endsWith('.localDate')) return `請填寫第 ${number} 則時刻的日期。`;
  if (issue.field.endsWith('.song.title')) return `請填寫第 ${number} 則時刻的歌名。`;
  if (issue.field.endsWith('.song.artist')) return `請填寫第 ${number} 則時刻的歌手。`;
  return '請補齊旅程的必填資料。';
}
