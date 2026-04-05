import React, { useMemo } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

export type FootballMatchCardMatch = {
  _id?: string;
  fixture?: {
    date?: string;
    status?: {
      short?: string;
      elapsed?: number;
    };
  };
  teams?: {
    home?: { name?: string; logo?: string };
    away?: { name?: string; logo?: string };
  };
  goals?: { home?: number; away?: number };
  league?: { name?: string; logo?: string };
  homeTeam?: { name?: string };
  awayTeam?: { name?: string };
  homeScore?: number;
  awayScore?: number;
  score?: { fullTime?: { home?: number; away?: number } };
  status?: string;
  minute?: number;
};

type Props = {
  match: FootballMatchCardMatch;
  /** When false, hide LIVE / half-time badges (e.g. upcoming tab). */
  showStatus?: boolean;
  /** Feed: card sits above a per-match action row — no bottom margin/radius/border. */
  embedded?: boolean;
};

const FootballMatchCard: React.FC<Props> = ({ match, showStatus = true, embedded = false }) => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        matchCard: {
          backgroundColor: colors.backgroundLight,
          borderRadius: 12,
          padding: 15,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: colors.border,
        },
        matchCardEmbedded: {
          marginBottom: 0,
          borderWidth: 0,
          borderRadius: 0,
        },
        leagueRow: {
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 12,
        },
        leagueLogo: {
          width: 20,
          height: 20,
          marginRight: 8,
        },
        leagueName: {
          fontSize: 14,
          fontWeight: '600',
          color: colors.text,
          flex: 1,
        },
        liveBadge: {
          backgroundColor: '#EF4444',
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 4,
        },
        liveBadgeText: {
          color: '#FFFFFF',
          fontSize: 11,
          fontWeight: 'bold',
        },
        halfTimeBadge: {
          backgroundColor: '#F97316',
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 4,
        },
        halfTimeBadgeText: {
          color: '#FFFFFF',
          fontSize: 11,
          fontWeight: 'bold',
        },
        matchContent: {
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 0,
        },
        teamContainer: {
          flex: 1,
          alignItems: 'center',
        },
        teamName: {
          fontSize: 15,
          fontWeight: 'bold',
          color: colors.text,
          textAlign: 'center',
          marginBottom: 8,
        },
        teamLogo: {
          width: 36,
          height: 36,
        },
        scoreContainer: {
          alignItems: 'center',
          marginHorizontal: 10,
        },
        scoreRow: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        score: {
          fontSize: 24,
          fontWeight: 'bold',
          color: colors.text,
        },
        scoreSeparator: {
          fontSize: 18,
          color: colors.textGray,
          marginHorizontal: 4,
        },
        matchTime: {
          fontSize: 14,
          color: colors.textGray,
          fontWeight: '500',
        },
        eventsContainer: {
          marginTop: 12,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        eventsTitle: {
          fontSize: 11,
          color: colors.textGray,
          fontWeight: '600',
          marginBottom: 8,
        },
        eventRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        },
        eventText: {
          fontSize: 12,
          color: colors.text,
          fontWeight: '500',
        },
        eventTeam: {
          fontSize: 11,
          color: colors.textGray,
        },
      }),
    [colors],
  );

  const formatTime = (dateString: string) => {
    if (!dateString) return t('tbd');
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return t('tbd');
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const short = String(match.fixture?.status?.short || match.status || '').trim();
  const events = (match as any).events;
  const elapsed = match.fixture?.status?.elapsed ?? match.minute;
  const isLiveBadge =
    short === '1H' ||
    short === '2H' ||
    short === 'LIVE' ||
    short === 'IN_PLAY' ||
    short === 'PAUSED';

  return (
    <View style={[styles.matchCard, embedded && styles.matchCardEmbedded]}>
      <View style={styles.leagueRow}>
        {match.league?.logo ? (
          <Image source={{ uri: match.league.logo }} style={styles.leagueLogo} />
        ) : null}
        <Text style={styles.leagueName}>{match.league?.name || t('unknownLeague')}</Text>
        {showStatus && isLiveBadge && (
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>
              🔴 LIVE {Number(elapsed) >= 0 ? Number(elapsed) : 0}'
            </Text>
          </View>
        )}
        {showStatus && short === 'HT' && (
          <View style={styles.halfTimeBadge}>
            <Text style={styles.halfTimeBadgeText}>{t('halfTime')}</Text>
          </View>
        )}
      </View>

      <View style={styles.matchContent}>
        <View style={styles.teamContainer}>
          <Text style={styles.teamName} numberOfLines={2}>
            {match.teams?.home?.name || match.homeTeam?.name || t('tbd')}
          </Text>
          {match.teams?.home?.logo ? (
            <Image source={{ uri: match.teams.home.logo }} style={styles.teamLogo} />
          ) : null}
        </View>

        <View style={styles.scoreContainer}>
          {short === 'NS' || short === 'TBD' || short === 'PST' ? (
            <Text style={styles.matchTime}>{formatTime(match.fixture?.date || '')}</Text>
          ) : (
            <View style={styles.scoreRow}>
              <Text style={styles.score}>{match.goals?.home ?? match.score?.fullTime?.home ?? match.homeScore ?? 0}</Text>
              <Text style={styles.scoreSeparator}>-</Text>
              <Text style={styles.score}>{match.goals?.away ?? match.score?.fullTime?.away ?? match.awayScore ?? 0}</Text>
            </View>
          )}
        </View>

        <View style={styles.teamContainer}>
          {match.teams?.away?.logo ? (
            <Image source={{ uri: match.teams.away.logo }} style={styles.teamLogo} />
          ) : null}
          <Text style={styles.teamName} numberOfLines={2}>
            {match.teams?.away?.name || match.awayTeam?.name || t('tbd')}
          </Text>
        </View>
      </View>

      {short === 'FT' && Array.isArray(events) && events.length > 0 && (
        <View style={styles.eventsContainer}>
          <Text style={styles.eventsTitle}>MATCH EVENTS</Text>
          {events
            .filter((e: any) => e.type === 'Goal')
            .slice(0, 5)
            .map((event: any, idx: number) => (
              <View key={`goal-${idx}`} style={styles.eventRow}>
                <Text style={styles.eventText}>
                  ⚽ {event.player} ({event.time}')
                </Text>
                <Text style={styles.eventTeam}>{event.team}</Text>
              </View>
            ))}
          {events
            .filter((e: any) => e.type === 'Card')
            .slice(0, 3)
            .map((event: any, idx: number) => (
              <View key={`card-${idx}`} style={styles.eventRow}>
                <Text
                  style={[
                    styles.eventText,
                    { color: event.detail === 'Red Card' ? '#EF4444' : '#FBBF24' },
                  ]}
                >
                  {event.detail === 'Red Card' ? '🟥' : '🟨'} {event.player} ({event.time}')
                </Text>
                <Text style={styles.eventTeam}>{event.team}</Text>
              </View>
            ))}
        </View>
      )}
    </View>
  );
};

export default FootballMatchCard;
