/** Shared signup / Google country list. Keep in sync with web `utils/countries.js`. */
export const COUNTRY_OPTIONS = [
  { name: 'United States', flag: '🇺🇸' },
  { name: 'United Kingdom', flag: '🇬🇧' },
  { name: 'Canada', flag: '🇨🇦' },
  { name: 'Australia', flag: '🇦🇺' },
  { name: 'Germany', flag: '🇩🇪' },
  { name: 'France', flag: '🇫🇷' },
  { name: 'Italy', flag: '🇮🇹' },
  { name: 'Spain', flag: '🇪🇸' },
  { name: 'Netherlands', flag: '🇳🇱' },
  { name: 'Belgium', flag: '🇧🇪' },
  { name: 'Switzerland', flag: '🇨🇭' },
  { name: 'Austria', flag: '🇦🇹' },
  { name: 'Sweden', flag: '🇸🇪' },
  { name: 'Norway', flag: '🇳🇴' },
  { name: 'Denmark', flag: '🇩🇰' },
  { name: 'Finland', flag: '🇫🇮' },
  { name: 'Poland', flag: '🇵🇱' },
  { name: 'Portugal', flag: '🇵🇹' },
  { name: 'Greece', flag: '🇬🇷' },
  { name: 'Turkey', flag: '🇹🇷' },
  { name: 'Russia', flag: '🇷🇺' },
  { name: 'Japan', flag: '🇯🇵' },
  { name: 'China', flag: '🇨🇳' },
  { name: 'India', flag: '🇮🇳' },
  { name: 'South Korea', flag: '🇰🇷' },
  { name: 'Singapore', flag: '🇸🇬' },
  { name: 'Malaysia', flag: '🇲🇾' },
  { name: 'Thailand', flag: '🇹🇭' },
  { name: 'Indonesia', flag: '🇮🇩' },
  { name: 'Philippines', flag: '🇵🇭' },
  { name: 'Vietnam', flag: '🇻🇳' },
  { name: 'Saudi Arabia', flag: '🇸🇦' },
  { name: 'United Arab Emirates', flag: '🇦🇪' },
  { name: 'Egypt', flag: '🇪🇬' },
  { name: 'Morocco', flag: '🇲🇦' },
  { name: 'Tunisia', flag: '🇹🇳' },
  { name: 'Algeria', flag: '🇩🇿' },
  { name: 'Lebanon', flag: '🇱🇧' },
  { name: 'Jordan', flag: '🇯🇴' },
  { name: 'Iraq', flag: '🇮🇶' },
  { name: 'Kuwait', flag: '🇰🇼' },
  { name: 'Qatar', flag: '🇶🇦' },
  { name: 'Bahrain', flag: '🇧🇭' },
  { name: 'Oman', flag: '🇴🇲' },
  { name: 'Yemen', flag: '🇾🇪' },
  { name: 'Syria', flag: '🇸🇾' },
  { name: 'Palestine', flag: '🇵🇸' },
  { name: 'Brazil', flag: '🇧🇷' },
  { name: 'Argentina', flag: '🇦🇷' },
  { name: 'Mexico', flag: '🇲🇽' },
  { name: 'Chile', flag: '🇨🇱' },
  { name: 'Colombia', flag: '🇨🇴' },
  { name: 'Peru', flag: '🇵🇪' },
  { name: 'Venezuela', flag: '🇻🇪' },
  { name: 'South Africa', flag: '🇿🇦' },
  { name: 'Nigeria', flag: '🇳🇬' },
  { name: 'Kenya', flag: '🇰🇪' },
  { name: 'Ghana', flag: '🇬🇭' },
  { name: 'Ethiopia', flag: '🇪🇹' },
  { name: 'Other', flag: '🌍' },
] as const;

export const COUNTRIES = COUNTRY_OPTIONS.map((c) => c.name);

const FLAG_BY_NAME = new Map(
  COUNTRY_OPTIONS.map((c) => [c.name.toLowerCase(), c.flag] as const),
);

/** O(1) flag lookup. Unknown names get a globe so old/free-text values still show. */
export function getCountryFlagByName(name: string): string {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return '';
  return FLAG_BY_NAME.get(key) || '🌍';
}
