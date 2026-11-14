import { useLayoutEffect } from 'react';

interface Props {
  accessGranted: boolean;
  progress: { text: string; percent: number };
  error?: string | null;
  onBack: () => void;
  errorTitle?: string;
  errorIntro?: string;
  backLabel?: string;
}

/** Update the existing loading screen; never replace its card or inherit app styles. */
export default function StudyLoadingScreen({ accessGranted, progress, error, onBack,
  errorTitle = 'Просмотр пока недоступен',
  errorIntro = 'Откройте исследование заново из личного кабинета.',
  backLabel = 'Вернуться в меню',
}: Props) {
  useLayoutEffect(() => {
    const host = document.getElementById('orbital-study-loader');
    if (!host) return;
    host.hidden = false;
    return () => { host.hidden = true; };
  }, []);

  useLayoutEffect(() => {
    const root = document.getElementById('orbital-study-loader')?.shadowRoot;
    if (!root) return;
    const find = <T extends HTMLElement = HTMLElement,>(selector: string) => root.querySelector<T>(selector);
    const text = (selector: string, value: string) => { find(selector).textContent = value; };
    const percent = Math.max(0, Math.min(100, Number.isFinite(progress.percent) ? progress.percent : 0));
    const detail = !accessGranted
      ? 'Проверяем доступ к исследованию…'
      : progress.text
        .replace(/^Читаем индекс:/, 'Получаем данные:')
        .replace(/^Быстрый путь:/, 'Подготовлено:')
        .replace(/^Поиск индекса:/, 'Поиск файлов:')
        .replace('Проверка готовности сжатой серии', 'Проверяем готовность исследования');

    find('.study-loading-card').setAttribute('aria-busy', String(!error));
    find('.study-loading-processing').hidden = Boolean(error);
    find('.study-loading-problem').hidden = !error;
    find('.study-loading-symbol').classList.toggle('is-error', Boolean(error));
    text('#study-loading-title', error ? errorTitle : 'Загрузка исследования');
    text('.study-loading-intro', error ? errorIntro : 'Готовим снимки для вашей работы');
    text('.study-loading-footnote', error ? 'Ваши исследования — в личном кабинете ORBITAL 3D' : 'Исследование откроется автоматически');
    text('.study-loading-error', error || '');
    find<HTMLButtonElement>('.study-loading-back').onclick = onBack;
    find('.study-loading-back').firstChild.textContent = `${backLabel} `;
    text('.study-loading-progress-heading p', detail);
    text('.study-loading-progress-heading > span', accessGranted ? `${Math.round(percent)}%` : 'Подключение');
    const track = find('.study-loading-track');
    track.classList.toggle('is-indeterminate', !accessGranted);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuetext', detail);
    if (accessGranted) track.setAttribute('aria-valuenow', String(percent));
    else track.removeAttribute('aria-valuenow');
    find('.study-loading-fill').style.width = accessGranted ? `${percent}%` : '';
    const currentStep = !accessGranted ? 0 : percent < 60 ? 1 : 2;
    root.querySelectorAll<HTMLElement>('.study-loading-steps li').forEach((step, index) => {
      step.dataset.state = index < currentStep ? 'done' : index === currentStep ? 'current' : 'pending';
      if (index === currentStep) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
      step.querySelector('.study-loading-step-number').textContent = index < currentStep ? '✓' : `0${index + 1}`;
    });
  });

  return null;
}
