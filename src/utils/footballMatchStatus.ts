/**
 * Match badge display (aligned with backend `footballStatuses.js`).
 * Prefer `match.displayStatus` from API/socket when present.
 */

const LIVE_STATUS_SHORT = [
  '1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE', 'IN_PLAY', 'PAUSED',
];

const FINISHED_STATUS_SHORT = [
  'FT', 'FINISHED', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP', 'AWD', 'WO',
];

const EXTRA_TIME_LIVE_SHORT = ['ET', 'P'];

const DISPLAY_FINISHED_KICKOFF_MIN = 108;
const DISPLAY_ET_FINISHED_KICKOFF_MIN = 138;
const DISPLAY_PEN_FINISHED_KICKOFF_MIN = 168;

export type MatchDisplayKind =
  | 'live'
  | 'halftime'
  | 'extratime'
  | 'penalties'
  | 'finished'
  | 'scheduled'
  | 'other';

export type MatchDisplayStatus = {
  kind: MatchDisplayKind;
  label: string;
  elapsed?: number | null;
};

type MatchLike = {
  fixture?: {
    date?: string;
    status?: { short?: string; elapsed?: number };
  };
  displayStatus?: MatchDisplayStatus;
  status?: string;
};

function kickoffAgeMinutes(match: MatchLike): number {
  const kickoff = match.fixture?.date ? new Date(match.fixture.date).getTime() : NaN;
  if (!Number.isFinite(kickoff)) return 0;
  return (Date.now() - kickoff) / (60 * 1000);
}

function displayFinishedKickoffMin(short: string): number {
  if (short === 'P') return DISPLAY_PEN_FINISHED_KICKOFF_MIN;
  if (short === 'ET') return DISPLAY_ET_FINISHED_KICKOFF_MIN;
  return DISPLAY_FINISHED_KICKOFF_MIN;
}

function isEffectivelyFinishedForDisplay(match: MatchLike): boolean {
  const short = String(match.fixture?.status?.short || match.status || '').trim();
  if (FINISHED_STATUS_SHORT.includes(short)) return true;
  if (!LIVE_STATUS_SHORT.includes(short)) return false;

  const ageMin = kickoffAgeMinutes(match);
  if (ageMin >= displayFinishedKickoffMin(short)) return true;

  if (!EXTRA_TIME_LIVE_SHORT.includes(short)) {
    const elapsed = match.fixture?.status?.elapsed;
    if (typeof elapsed === 'number' && elapsed >= 90 && ageMin >= 105) return true;
  }

  return false;
}

export function getMatchDisplayStatus(match: MatchLike): MatchDisplayStatus {
  if (match.displayStatus?.kind) {
    return match.displayStatus;
  }

  const short = String(match.fixture?.status?.short || match.status || '').trim();
  const elapsed =
    typeof match.fixture?.status?.elapsed === 'number'
      ? match.fixture.status.elapsed
      : null;

  if (FINISHED_STATUS_SHORT.includes(short)) {
    return { kind: 'finished', label: 'FINISHED', elapsed: elapsed ?? 90 };
  }
  if (short === 'NS' || short === 'SCHEDULED') {
    return { kind: 'scheduled', label: short, elapsed: null };
  }
  if (isEffectivelyFinishedForDisplay(match)) {
    return { kind: 'finished', label: 'FINISHED', elapsed: elapsed ?? 90 };
  }
  if (short === 'HT') {
    return { kind: 'halftime', label: 'HALF TIME', elapsed: elapsed ?? 45 };
  }
  if (short === 'ET') {
    return {
      kind: 'extratime',
      label: elapsed != null && elapsed > 90 ? `ET ${elapsed}'` : 'ET',
      elapsed,
    };
  }
  if (short === 'P') {
    return { kind: 'penalties', label: 'PENALTIES', elapsed };
  }
  if (LIVE_STATUS_SHORT.includes(short)) {
    return { kind: 'live', label: 'LIVE', elapsed };
  }
  return { kind: 'other', label: short || '—', elapsed };
}
