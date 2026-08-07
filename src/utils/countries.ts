export type CountryOption = {
  name: string;
  code?: string;
};

export const COUNTRIES: CountryOption[] = [
  { name: 'United States', code: 'US' },
  { name: 'United Kingdom', code: 'GB' },
  { name: 'Canada', code: 'CA' },
  { name: 'Australia', code: 'AU' },
  { name: 'Germany', code: 'DE' },
  { name: 'France', code: 'FR' },
  { name: 'Italy', code: 'IT' },
  { name: 'Spain', code: 'ES' },
  { name: 'Netherlands', code: 'NL' },
  { name: 'Belgium', code: 'BE' },
  { name: 'Switzerland', code: 'CH' },
  { name: 'Austria', code: 'AT' },
  { name: 'Sweden', code: 'SE' },
  { name: 'Norway', code: 'NO' },
  { name: 'Denmark', code: 'DK' },
  { name: 'Finland', code: 'FI' },
  { name: 'Poland', code: 'PL' },
  { name: 'Portugal', code: 'PT' },
  { name: 'Greece', code: 'GR' },
  { name: 'Turkey', code: 'TR' },
  { name: 'Russia', code: 'RU' },
  { name: 'Japan', code: 'JP' },
  { name: 'China', code: 'CN' },
  { name: 'India', code: 'IN' },
  { name: 'South Korea', code: 'KR' },
  { name: 'Singapore', code: 'SG' },
  { name: 'Malaysia', code: 'MY' },
  { name: 'Thailand', code: 'TH' },
  { name: 'Indonesia', code: 'ID' },
  { name: 'Philippines', code: 'PH' },
  { name: 'Vietnam', code: 'VN' },
  { name: 'Saudi Arabia', code: 'SA' },
  { name: 'United Arab Emirates', code: 'AE' },
  { name: 'Egypt', code: 'EG' },
  { name: 'Morocco', code: 'MA' },
  { name: 'Tunisia', code: 'TN' },
  { name: 'Algeria', code: 'DZ' },
  { name: 'Lebanon', code: 'LB' },
  { name: 'Jordan', code: 'JO' },
  { name: 'Iraq', code: 'IQ' },
  { name: 'Kuwait', code: 'KW' },
  { name: 'Qatar', code: 'QA' },
  { name: 'Bahrain', code: 'BH' },
  { name: 'Oman', code: 'OM' },
  { name: 'Yemen', code: 'YE' },
  { name: 'Syria', code: 'SY' },
  { name: 'Palestine', code: 'PS' },
  { name: 'Brazil', code: 'BR' },
  { name: 'Argentina', code: 'AR' },
  { name: 'Mexico', code: 'MX' },
  { name: 'Chile', code: 'CL' },
  { name: 'Colombia', code: 'CO' },
  { name: 'Peru', code: 'PE' },
  { name: 'Venezuela', code: 'VE' },
  { name: 'South Africa', code: 'ZA' },
  { name: 'Nigeria', code: 'NG' },
  { name: 'Kenya', code: 'KE' },
  { name: 'Ghana', code: 'GH' },
  { name: 'Ethiopia', code: 'ET' },
  { name: 'Other' },
];

export function countryFlag(code?: string): string {
  if (!code || code.length !== 2) return '🌍';
  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

export function getCountryFlagByName(name?: string | null): string {
  if (!name) return '🌍';
  const match = COUNTRIES.find((c) => c.name === name);
  return countryFlag(match?.code);
}
