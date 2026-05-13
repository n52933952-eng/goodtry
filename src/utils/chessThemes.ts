/**
 * Board theme presets used by ChessBoard / ChessGameScreen.
 * Persisted in AsyncStorage under `@chess_board_theme` so the user's choice
 * survives app restarts.
 */
export interface ChessBoardTheme {
  id: string;
  nameEn: string;
  nameAr: string;
  light: string; // light square color
  dark: string;  // dark square color
}

export const CHESS_BOARD_THEMES: ChessBoardTheme[] = [
  { id: 'wood',      nameEn: 'Wood',             nameAr: 'خشبي',       light: '#F0D9B5', dark: '#B58863' },
  { id: 'maple',     nameEn: 'Maple',            nameAr: 'قيقب',       light: '#EBC58E', dark: '#A87B4E' },
  { id: 'walnut',    nameEn: 'Walnut',           nameAr: 'جوز',        light: '#D2B48C', dark: '#5D4037' },
  { id: 'blue',      nameEn: 'Blue',             nameAr: 'أزرق',       light: '#DEE3E6', dark: '#8CA2AD' },
  { id: 'blueDeep',  nameEn: 'Tournament Blue',  nameAr: 'أزرق غامق',  light: '#9FB9D1', dark: '#4E7BAF' },
  { id: 'green',     nameEn: 'Green',            nameAr: 'أخضر',       light: '#EEEED2', dark: '#769656' },
  { id: 'mint',      nameEn: 'Mint',             nameAr: 'نعناعي',     light: '#E8F5E9', dark: '#81C784' },
  { id: 'marble',    nameEn: 'Marble',           nameAr: 'رخام',       light: '#D9D6CB', dark: '#9A9286' },
  { id: 'gray',      nameEn: 'Gray',             nameAr: 'رمادي',      light: '#DCDCDC', dark: '#6F6F6F' },
  { id: 'purple',    nameEn: 'Purple',           nameAr: 'أرجواني',    light: '#E0D6F0', dark: '#8A6FB5' },
  { id: 'pink',      nameEn: 'Pink',             nameAr: 'وردي',       light: '#F8D7E0', dark: '#D77F9F' },
  { id: 'canvas',    nameEn: 'Canvas',           nameAr: 'قماش',       light: '#E0E5EC', dark: '#A0A8B0' },
];

export const DEFAULT_CHESS_BOARD_THEME_ID = 'wood';

export const BOARD_THEME_STORAGE_KEY = '@chess_board_theme';

export function getBoardThemeById(id: string | null | undefined): ChessBoardTheme {
  if (!id) return CHESS_BOARD_THEMES[0];
  return CHESS_BOARD_THEMES.find((t) => t.id === id) || CHESS_BOARD_THEMES[0];
}
