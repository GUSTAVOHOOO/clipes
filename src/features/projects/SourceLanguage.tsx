import { useContext } from 'react';
import { LanguageContext } from '@/lib/i18n';

const CODES = [
  'pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'nl', 'pl', 'tr', 'uk',
  'af', 'am', 'as', 'az', 'ba', 'be', 'bg', 'bn', 'bo', 'br', 'bs', 'ca', 'cs', 'cy', 'da', 'el',
  'et', 'eu', 'fa', 'fi', 'fo', 'gl', 'gu', 'ha', 'he', 'hr', 'ht', 'hu', 'hy', 'id', 'is', 'jw',
  'ka', 'kk', 'km', 'kn', 'la', 'lb', 'ln', 'lo', 'lt', 'lv', 'mg', 'mi', 'mk', 'ml', 'mn', 'mr',
  'ms', 'mt', 'my', 'ne', 'nn', 'no', 'oc', 'pa', 'ps', 'ro', 'sa', 'sd', 'si', 'sk', 'sl', 'sn',
  'so', 'sq', 'sr', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'tk', 'tl', 'tt', 'ur', 'uz', 'vi',
  'yi', 'yo',
] as const;

const FALLBACK_NAMES: Record<string, { 'pt-BR': string; en: string }> = {
  jw: { 'pt-BR': 'javanês', en: 'Javanese' },
};

export function languageLabel(code: string, uiLang: 'pt-BR' | 'en') {
  const custom = FALLBACK_NAMES[code]?.[uiLang];
  if (custom) return `${custom} (${code})`;
  try {
    const names = new Intl.DisplayNames([uiLang], { type: 'language' });
    const name = names.of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return `${name} (${code})`;
  } catch { /* fallback to code */ }
  return code;
}

export function SourceLanguageSelect({
  id,
  className = 'foco h-8 rounded-md border border-line-strong bg-field px-3 text-fg',
  value,
  disabled,
  onChange,
}: {
  id?: string;
  className?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const uiLang = useContext(LanguageContext);
  return (
    <select
      id={id}
      className={className}
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
    >
      {CODES.map(code => (
        <option key={code} value={code}>
          {languageLabel(code, uiLang)}
        </option>
      ))}
    </select>
  );
}
