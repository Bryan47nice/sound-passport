import { Plus, X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { listCountries } from '../../domain/countryCatalog';
import type { Journey } from '../../domain/model';
import type { JourneyUserPatch } from './journeyPatch';

interface JourneyDetailsFormProps {
  draft: Journey;
  dateError: string;
  onTextChange: (patch: JourneyUserPatch) => void;
  onImmediateChange: (patch: JourneyUserPatch) => void;
  onDateChange: (field: 'startDate' | 'endDate', value: string) => void;
}

export function JourneyDetailsForm({
  draft,
  dateError,
  onTextChange,
  onImmediateChange,
  onDateChange,
}: JourneyDetailsFormProps) {
  const [cityInput, setCityInput] = useState('');

  const addCity = () => {
    const city = cityInput.trim();
    if (!city || draft.cityLabels.includes(city)) {
      setCityInput('');
      return;
    }
    onImmediateChange({ cityLabels: [...draft.cityLabels, city] });
    setCityInput('');
  };

  const handleCityKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addCity();
  };

  return (
    <form className="journey-details-form" onSubmit={(event) => event.preventDefault()}>
      <label>旅程標題
        <input value={draft.title} onChange={(event) => onTextChange({ title: event.target.value })} />
      </label>
      <label>國家
        <select
          value={draft.countryCode}
          onChange={(event) => {
            const country = listCountries().find((option) => option.code === event.target.value);
            if (!country) return;
            onImmediateChange({
              countryCode: country.code,
              countryName: country.name,
              countryCoordinates: [...country.coordinates] as [number, number],
            });
          }}
        >
          {listCountries().map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
        </select>
      </label>
      <div className="journey-date-fields">
        <label>開始日期
          <input
            type="date"
            value={draft.startDate}
            aria-describedby={dateError ? 'journey-date-error' : undefined}
            aria-invalid={dateError ? true : undefined}
            onChange={(event) => onDateChange('startDate', event.target.value)}
          />
        </label>
        <label>結束日期
          <input
            type="date"
            value={draft.endDate}
            aria-describedby={dateError ? 'journey-date-error' : undefined}
            aria-invalid={dateError ? true : undefined}
            onChange={(event) => onDateChange('endDate', event.target.value)}
          />
        </label>
      </div>
      {dateError && <p className="field-error" id="journey-date-error">{dateError}</p>}
      <div className="journey-city-editor">
        <label>城市
          <input value={cityInput} onChange={(event) => setCityInput(event.target.value)} onKeyDown={handleCityKeyDown} />
        </label>
        <button className="icon-command" type="button" onClick={addCity} title="新增城市" aria-label="新增城市">
          <Plus size={17} aria-hidden="true" />
        </button>
      </div>
      {draft.cityLabels.length > 0 && (
        <ul className="city-chips">
          {draft.cityLabels.map((city) => (
            <li key={city} aria-label={city}>{city}
              <button
                type="button"
                title={`移除城市 ${city}`}
                aria-label={`移除城市 ${city}`}
                onClick={() => onImmediateChange({ cityLabels: draft.cityLabels.filter((item) => item !== city) })}
              ><X size={14} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="journey-summary-field">旅程總文（選填）
        <textarea rows={7} value={draft.summary} onChange={(event) => onTextChange({ summary: event.target.value })} />
      </label>
    </form>
  );
}
