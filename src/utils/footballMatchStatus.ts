/**
 * Match badge display (aligned with backend `footballStatuses.js`).
 * Recompute live/HT from kickoff age — do not freeze a stale `displayStatus`.
 */

const LIVE_STATUS_SHORT = [
  '1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE', 'IN_PLAY', 'PAUSED',
];

const FINISHED_STATUS_SHORT = [
  'FT', 'FINISHED', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP', 'AWD', 'WO',
];

const EXTRA_TIME_LIVE_SHORT = ['ET', 'P', 'BT'];

/**
 * Cap on how much kickoff delay we credit from `liveStartedAt`. The free tier can flip
 * SCHEDULED → IN_PLAY ~5 minutes late, and trusting that fully started the badge at 1' during a
 * match already at 6'.
 */
const MAX_CREDITED_KICKOFF_DELAY_MIN = 3;

/** Kickoff passed but the API has not flipped the status yet — still show it as live. */
const ASSUME_STARTED_WITHIN_MIN = 20;

const DISPLAY_FINISHED_KICKOFF_MIN = 125;
const DISPLAY_ET_FINISHED_KICKOFF_MIN = 185;
const DISPLAY_PEN_FINISHED_KICKOFF_MIN = 210;

const FIRST_HALF_STOPPAGE_CAP = 48;
const HT_INFER_AFTER_MIN = 51;
const SECOND_HALF_WALL_MIN = 60;
const HT_STUCK_TO_2H_MIN = 62;

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
    liveStartedAt?: string | null;
    status?: { short?: string; elapsed?: number };
  };
  league?: { id?: number | string; name?: string };
  displayStatus?: MatchDisplayStatus;
  status?: string;
};

/**
 * Minutes of actual play, anchored between the scheduled date (slightly early) and the observed
 * live flip (late by the API's status lag). Error stays within ~3 minutes either way.
 */
function kickoffAgeMinutes(match: MatchLike): number {
  const scheduled = match.fixture?.date ? new Date(match.fixture.date).getTime() : NaN;
  if (!Number.isFinite(scheduled)) return 0;

  const observed = match.fixture?.liveStartedAt
    ? new Date(match.fixture.liveStartedAt).getTime()
    : NaN;
  const delayMin = Number.isFinite(observed) ? (observed - scheduled) / (60 * 1000) : 0;
  const creditedDelayMin = Math.min(Math.max(delayMin, 0), MAX_CREDITED_KICKOFF_DELAY_MIN);

  return (Date.now() - scheduled) / (60 * 1000) - creditedDelayMin;
}

/** True when kickoff has passed but the API still reports the match as not started. */
function isStartedButNotYetLive(match: MatchLike): boolean {
  const short = String(match.fixture?.status?.short || match.status || '').trim();
  if (short !== 'NS' && short !== 'SCHEDULED' && short !== 'TIMED') return false;
  if (!match.fixture?.date) return false;

  const ageMin = kickoffAgeMinutes(match);
  return ageMin >= 0 && ageMin <= ASSUME_STARTED_WITHIN_MIN;
}

function inferLiveShort(short: string, ageMin: number): string {
  const s = String(short || '').toUpperCase();
  if (EXTRA_TIME_LIVE_SHORT.includes(s)) return s;
  if (FINISHED_STATUS_SHORT.includes(s)) return s;
  if (s === 'NS' || s === 'SCHEDULED') return s;

  if (s === 'HT' || s === 'PAUSED') {
    if (ageMin >= HT_STUCK_TO_2H_MIN) return '2H';
    return 'HT';
  }

  if (s === '1H' || s === 'LIVE') {
    if (ageMin >= HT_STUCK_TO_2H_MIN) return '2H';
    if (ageMin >= HT_INFER_AFTER_MIN) return 'HT';
    return '1H';
  }

  // Never promote to ET from the clock: league matches have no extra time, and a fake ET label
  // keeps the row "live" for 3+ hours.
  if (s === '2H' || s === 'IN_PLAY') {
    if (ageMin < HT_INFER_AFTER_MIN) return '1H';
    if (ageMin < HT_STUCK_TO_2H_MIN) return 'HT';
    return '2H';
  }

  return s;
}

function estimateLiveElapsed(short: string, ageMin: number): number | null {
  const inferred = inferLiveShort(short, ageMin);
  const wall = Math.max(0, Math.floor(ageMin));

  if (inferred === 'P') return 120;
  if (inferred === 'HT') return 45;
  if (inferred === '1H') return Math.min(wall, FIRST_HALF_STOPPAGE_CAP);
  if (inferred === '2H') {
    const approx = 45 + Math.max(0, wall - SECOND_HALF_WALL_MIN);
    return Math.min(Math.max(approx, 45), 95);
  }
  if (inferred === 'ET' || inferred === 'BT') {
    const approx = 90 + Math.max(0, wall - 105);
    return Math.min(Math.max(approx, 90), 120);
  }
  return null;
}

/** Only the API's own ET/BT/P counts as overtime — never a guess from kickoff age. */
function isOvertimePhase(short: string): boolean {
  return EXTRA_TIME_LIVE_SHORT.includes(short);
}

const EXTRA_TIME_CAPABLE_LEAGUE_IDS = [2001];
const EXTRA_TIME_CAPABLE_NAME_HINTS = ['champions league', 'cup', 'copa', 'coppa', 'pokal'];

/**
 * True when this competition can play extra time / penalties. A knockout tie only reports ET once
 * the API updates, so the regulation cut-off would otherwise show FINISHED during extra time.
 */
function canPlayExtraTime(match: MatchLike): boolean {
  const league = match.league || {};
  if (EXTRA_TIME_CAPABLE_LEAGUE_IDS.includes(Number(league.id))) return true;
  if (String(league.id || '').toUpperCase() === 'CL') return true;

  const name = String(league.name || '').toLowerCase();
  return EXTRA_TIME_CAPABLE_NAME_HINTS.some(hint => name.includes(hint));
}

function displayFinishedKickoffMin(short: string, match: MatchLike): number {
  if (short === 'P') return DISPLAY_PEN_FINISHED_KICKOFF_MIN;
  if (isOvertimePhase(short) || canPlayExtraTime(match)) return DISPLAY_ET_FINISHED_KICKOFF_MIN;
  return DISPLAY_FINISHED_KICKOFF_MIN;
}

function isEffectivelyFinishedForDisplay(match: MatchLike): boolean {
  const short = String(match.fixture?.status?.short || match.status || '').trim();
  if (FINISHED_STATUS_SHORT.includes(short)) return true;
  if (!LIVE_STATUS_SHORT.includes(short)) return false;

  return kickoffAgeMinutes(match) >= displayFinishedKickoffMin(short, match);
}

export function getMatchDisplayStatus(match: MatchLike): MatchDisplayStatus {
  const rawShort = String(match.fixture?.status?.short || match.status || '').trim();

  if (FINISHED_STATUS_SHORT.includes(rawShort) && match.displayStatus?.kind === 'finished') {
    return match.displayStatus;
  }
  if (rawShort === 'NS' || rawShort === 'SCHEDULED' || rawShort === 'TIMED') {
    if (isStartedButNotYetLive(match)) {
      return { kind: 'live', label: 'LIVE', elapsed: null };
    }
    return match.displayStatus?.kind === 'scheduled'
      ? match.displayStatus
      : { kind: 'scheduled', label: rawShort, elapsed: null };
  }

  if (isEffectivelyFinishedForDisplay(match)) {
    return { kind: 'finished', label: 'FINISHED', elapsed: 90 };
  }

  const ageMin = kickoffAgeMinutes(match);
  const short = inferLiveShort(rawShort, ageMin);
  const elapsed = estimateLiveElapsed(rawShort, ageMin);

  if (short === 'HT') {
    return { kind: 'halftime', label: 'HALF TIME', elapsed: elapsed ?? 45 };
  }
  if (short === 'ET') {
    return { kind: 'extratime', label: 'EXTRA TIME', elapsed };
  }
  if (short === 'BT') {
    return { kind: 'extratime', label: 'EXTRA TIME', elapsed };
  }
  if (short === 'P') {
    return { kind: 'penalties', label: 'PENALTIES', elapsed };
  }
  if (LIVE_STATUS_SHORT.includes(short) || LIVE_STATUS_SHORT.includes(rawShort)) {
    return { kind: 'live', label: 'LIVE', elapsed };
  }
  return { kind: 'other', label: short || '—', elapsed };
}
