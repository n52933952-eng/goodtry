/**
 * Chess piece graphics (Lichess CDN SVGs). Same keys as web (`chessPieceSets.js`).
 * Used by ChessBoard with SvgUri; persisted under `@chess_piece_set`.
 */
export const LICHESS_PIECE_CDN = 'https://lichess1.org/assets/piece'

export interface ChessPieceSet {
  id: string
  nameEn: string
  nameAr: string
}

export const CHESS_PIECE_SETS: ChessPieceSet[] = [
  { id: 'cburnett', nameEn: 'Classic', nameAr: 'كلاسيكي' },
  { id: 'merida', nameEn: 'Merida', nameAr: 'ميريدا' },
  { id: 'alpha', nameEn: 'Alpha', nameAr: 'ألفا' },
  { id: 'pirouetti', nameEn: 'Pirouetti', nameAr: 'بيروتي' },
  { id: 'chessnut', nameEn: 'Chessnut', nameAr: 'تشيسنت' },
  { id: 'fantasy', nameEn: 'Fantasy', nameAr: 'فانتسي' },
  { id: 'spatial', nameEn: 'Spatial', nameAr: 'مكاني' },
  { id: 'california', nameEn: 'California', nameAr: 'كاليفورنيا' },
  { id: 'celtic', nameEn: 'Celtic', nameAr: 'سلتيك' },
  { id: 'dubrovny', nameEn: 'Dubrovny', nameAr: 'دوبروفني' },
]

export const DEFAULT_CHESS_PIECE_SET_ID = 'cburnett'

export const PIECE_SET_STORAGE_KEY = '@chess_piece_set'

export function getPieceSetById(id: string | null | undefined): ChessPieceSet {
  if (!id) return CHESS_PIECE_SETS[0]
  return CHESS_PIECE_SETS.find((s) => s.id === id) || CHESS_PIECE_SETS[0]
}

export function lichessPieceSvgUrl(setId: string, pieceCode: string): string {
  return `${LICHESS_PIECE_CDN}/${setId}/${pieceCode}.svg`
}

/** FEN piece letter → Lichess filename code (e.g. P → wP, n → bN). */
export function fenCharToPieceCode(fenPieceChar: string): string {
  if (!fenPieceChar || typeof fenPieceChar !== 'string') return 'wP'
  const t = fenPieceChar.toLowerCase()
  if (!'pnbrqk'.includes(t)) return 'wP'
  const isWhite = fenPieceChar === fenPieceChar.toUpperCase()
  return `${isWhite ? 'w' : 'b'}${t.toUpperCase()}`
}
