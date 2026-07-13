import { Plus, X } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useGuardedNavigate, useRouteCommandGuard } from '../../app/navigationGuard';
import { useOptionalJourneyEditorRepository } from '../../data/RepositoryContext';
import { storageWriteFailureMessage } from '../../data/storageErrors';
import { listCountries, type CountryOption } from '../../domain/countryCatalog';
import { useMobileStudio } from './useMobileStudio';

type FieldName = 'title' | 'country' | 'startDate' | 'endDate';
type ValidationErrors = Partial<Record<FieldName, string>>;

type JourneyCreatePageProps = {
  onBootstrapRetry?: () => void;
};

function fieldError(errors: ValidationErrors, name: FieldName) {
  return errors[name] ? <p className="field-error" id={`${name}-error`}>{errors[name]}</p> : null;
}

export function JourneyCreatePage({ onBootstrapRetry = () => window.location.reload() }: JourneyCreatePageProps) {
  const editor = useOptionalJourneyEditorRepository();
  const navigate = useGuardedNavigate();
  const routeCommand = useRouteCommandGuard();
  const isMobile = useMobileStudio();
  const [title, setTitle] = useState('');
  const [countryInput, setCountryInput] = useState('');
  const [country, setCountry] = useState<CountryOption>();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [cities, setCities] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  if (isMobile) {
    return <section className="page studio-guidance"><h1 className="page-title">請使用電腦整理旅程</h1></section>;
  }

  if (!editor) {
    return (
      <section className="page studio-guidance">
        <h1 className="page-title">本機儲存空間暫時無法使用</h1>
        <button className="secondary-command studio-state-action" type="button" onClick={onBootstrapRetry}>
          重新嘗試
        </button>
      </section>
    );
  }

  const selectCountry = (value: string) => {
    const nextCountry = listCountries().find((option) => option.name === value);
    setCountryInput(value);
    setCountry(nextCountry);
  };

  const addCity = () => {
    const city = cityInput.trim();
    if (city && !cities.includes(city)) setCities((current) => [...current, city]);
    setCityInput('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const nextErrors: ValidationErrors = {};
    if (!title.trim()) nextErrors.title = '請填寫此欄位';
    if (!country) nextErrors.country = '請填寫此欄位';
    if (!startDate) nextErrors.startDate = '請填寫此欄位';
    if (!endDate) nextErrors.endDate = '請填寫此欄位';
    if (startDate && endDate && endDate < startDate) nextErrors.endDate = '結束日期不得早於開始日期';
    setErrors(nextErrors);
    setSubmitError('');
    if (Object.keys(nextErrors).length > 0 || !country) return;

    submittingRef.current = true;
    const command = routeCommand.capture();
    setIsSubmitting(true);
    try {
      const journey = await editor.createJourney({
        title: title.trim(),
        countryCode: country.code,
        countryName: country.name,
        countryCoordinates: [...country.coordinates] as [number, number],
        cityLabels: cities,
        startDate,
        endDate,
        summary: summary.trim(),
      });
      if (routeCommand.isCurrent(command)) navigate(`/studio/journeys/${journey.id}`);
    } catch (error) {
      if (routeCommand.isCurrent(command)) {
        setSubmitError(storageWriteFailureMessage(error, '無法建立旅程，請再試一次'));
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <section className="page journey-create-page">
      <div className="studio-heading">
        <div><p className="eyebrow">私人旅程</p><h1 className="page-title">新增旅程</h1></div>
      </div>
      <form className="journey-create-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="form-field">
          <label htmlFor="journey-title">旅程標題</label>
          <input id="journey-title" value={title} onChange={(event) => setTitle(event.target.value)} aria-describedby={errors.title ? 'title-error' : undefined} />
          {fieldError(errors, 'title')}
        </div>
        <div className="form-field">
          <label htmlFor="journey-country">國家</label>
          <input id="journey-country" value={countryInput} onChange={(event) => selectCountry(event.target.value)} list="country-catalog" aria-describedby={errors.country ? 'country-error' : undefined} />
          <datalist id="country-catalog">{listCountries().map((option) => <option key={option.code} value={option.name}>{option.code}</option>)}</datalist>
          {fieldError(errors, 'country')}
        </div>
        <div className="form-field">
          <label htmlFor="journey-start-date">開始日期</label>
          <input id="journey-start-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-describedby={errors.startDate ? 'startDate-error' : undefined} />
          {fieldError(errors, 'startDate')}
        </div>
        <div className="form-field">
          <label htmlFor="journey-end-date">結束日期</label>
          <input id="journey-end-date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} aria-describedby={errors.endDate ? 'endDate-error' : undefined} />
          {fieldError(errors, 'endDate')}
        </div>
        <div className="city-field">
          <label>城市
            <input value={cityInput} onChange={(event) => setCityInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCity(); } }} />
          </label>
          <button className="secondary-command" type="button" onClick={addCity}>新增城市</button>
          {cities.length > 0 && <ul className="city-chips">{cities.map((city) => <li key={city} aria-label={city}>{city}<button type="button" title={`移除城市 ${city}`} aria-label={`移除城市 ${city}`} onClick={() => setCities((current) => current.filter((item) => item !== city))}><X size={14} aria-hidden="true" /></button></li>)}</ul>}
        </div>
        <label className="form-wide">旅程總文（選填）
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={5} />
        </label>
        {submitError && <p className="form-wide field-error" role="alert">{submitError}</p>}
        <div className="form-wide form-actions">
          <button className="primary-command" type="submit" disabled={isSubmitting}>
            <Plus size={18} aria-hidden="true" />{isSubmitting ? '建立中…' : '建立旅程'}
          </button>
        </div>
      </form>
    </section>
  );
}
