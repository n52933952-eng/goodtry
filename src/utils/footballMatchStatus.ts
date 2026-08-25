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

const EXTRA_TIME_LIVE_SHORT = ['ET', 'P', 'BT'];
const OVERTIME_BREAK_AFTER_KICKOFF_MIN = 95;

const DISPLAY_FINISHED_KICKOFF_MIN = 125;
const DISPLAY_ET_FINISHED_KICKOFF_MIN = 185;
const DISPLAY_PEN_FINISHED_KICKOFF_MIN = 210;

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

function isOvertimePhase(short: string, ageMin: number): boolean {
  if (EXTRA_TIME_LIVE_SHORT.includes(short)) return true;
  if ((short === 'HT' || short === 'PAUSED') && ageMin >= OVERTIME_BREAK_AFTER_KICKOFF_MIN) {
    return true;
  }
  if ((short === '2H' || short === 'IN_PLAY' || short === 'LIVE') && ageMin >= 115) {
    return true;
  }
  return false;
}

function displayFinishedKickoffMin(short: string, ageMin: number): number {
  if (short === 'P') return DISPLAY_PEN_FINISHED_KICKOFF_MIN;
  if (isOvertimePhase(short, ageMin)) return DISPLAY_ET_FINISHED_KICKOFF_MIN;
  return DISPLAY_FINISHED_KICKOFF_MIN;
}

function isEffectivelyFinishedForDisplay(match: MatchLike): boolean {
  const short = String(match.fixture?.status?.short || match.status || '').trim();
  if (FINISHED_STATUS_SHORT.includes(short)) return true;
  if (!LIVE_STATUS_SHORT.includes(short)) return false;

  const ageMin = kickoffAgeMinutes(match);
  return ageMin >= displayFinishedKickoffMin(short, ageMin);
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
  const ageMin = kickoffAgeMinutes(match);
  if (short === 'HT' && ageMin >= OVERTIME_BREAK_AFTER_KICKOFF_MIN) {
    return { kind: 'extratime', label: 'EXTRA TIME', elapsed };
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
  if (short === 'BT') {
    return { kind: 'extratime', label: 'EXTRA TIME', elapsed };
  }
  if ((short === '2H' || short === 'IN_PLAY' || short === 'LIVE') && ageMin >= 115) {
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
