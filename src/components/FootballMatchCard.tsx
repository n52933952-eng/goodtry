import React, { useMemo, type ReactNode } from 'react';
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
  /** Feed only: like/comment row inside the same rounded shell as Football tab (same `matchCard` styles). */
  feedFooter?: ReactNode;
  /** Feed list: last card in the strip — no bottom margin (avoids double gap before the next post). */
  lastInStrip?: boolean;
};

const FootballMatchCard: React.FC<Props> = ({
  match,
  showStatus = true,
  embedded = false,
  feedFooter,
  lastInStrip = false,
}) => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        matchCard: {
          backgroundColor: colors.backgroundLight,
          borderRadius: 8,
          padding: 15,
          marginBottom: 8,
        },
        matchCardEmbedded: {
          marginBottom: 0,
          borderWidth: 0,
          borderRadius: 0,
          backgroundColor: 'transparent',
          overflow: 'hidden',
        },
        /** Feed + footer: same chrome as `matchCard`, padding only on body; footer is full-width below the body. */
        matchCardFeedShell: {
          padding: 0,
          overflow: 'hidden',
        },
        matchCardFeedStripLast: {
          marginBottom: 0,
        },
        matchCardFeedBody: {
          padding: 15,
        },
        leagueRow: {
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 12,
          direction: 'ltr',
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
          direction: 'ltr',
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
          writingDirection: 'ltr',
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
          borderTopWidth: StyleSheet.hairlineWidth,
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
  const isLiveBadge =
    short === '1H' ||
    short === '2H' ||
    short === 'LIVE' ||
    short === 'IN_PLAY' ||
    short === 'PAUSED';

  /** Same chrome as Football tab (`matchCard`); decoupled from `embedded`. */
  const useFeedFooterShell = feedFooter != null;

  const body = (
    <>
      <View style={styles.leagueRow}>
        {match.league?.logo ? (
          <Image source={{ uri: match.league.logo }} style={styles.leagueLogo} />
        ) : null}
        <Text style={styles.leagueName}>{match.league?.name || t('unknownLeague')}</Text>
        {showStatus && isLiveBadge && (
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>🔴 LIVE</Text>
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
          <Text style={styles.teamName} numberOfLines={2}>
            {match.teams?.away?.name || match.awayTeam?.name || t('tbd')}
          </Text>
          {match.teams?.away?.logo ? (
            <Image source={{ uri: match.teams.away.logo }} style={styles.teamLogo} />
          ) : null}
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
    </>
  );

  if (useFeedFooterShell) {
    return (
      <View
        collapsable={false}
        style={[styles.matchCard, styles.matchCardFeedShell, lastInStrip && styles.matchCardFeedStripLast]}
      >
        <View style={styles.matchCardFeedBody}>{body}</View>
        {feedFooter}
      </View>
    );
  }

  return (
    <View style={[styles.matchCard, embedded && styles.matchCardEmbedded]}>
      {body}
    </View>
  );
};

export default FootballMatchCard;
