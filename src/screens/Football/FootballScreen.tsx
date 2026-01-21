import React, { useState, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  ScrollView,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { API_URL, COLORS, ENDPOINTS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { useShowToast } from '../../hooks/useShowToast';

interface Match {
  _id: string;
  fixture?: {
    date: string;
    status: {
      short: string;
      elapsed?: number;
    };
  };
  teams?: {
    home: {
      name: string;
      logo?: string;
    };
    away: {
      name: string;
      logo?: string;
    };
  };
  goals?: {
    home: number;
    away: number;
  };
  league?: {
    name: string;
    logo?: string;
  };
  events?: Array<{
    type: string;
    player?: string;
    time?: number;
    team?: string;
    detail?: string;
    playerOut?: string;
  }>;
}

const FootballScreen = () => {
  const { user } = useUser();
  const { socket } = useSocket();
  const showToast = useShowToast();

  const [liveMatches, setLiveMatches] = useState<Match[]>([]);
  const [upcomingMatches, setUpcomingMatches] = useState<Match[]>([]);
  const [finishedMatches, setFinishedMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [footballAccountId, setFootballAccountId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'live' | 'upcoming' | 'finished'>('live');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Check if user follows Football account
  const checkFollowStatus = async () => {
    if (!user) return;
    
    try {
      const data = await apiService.get(`${ENDPOINTS.GET_USER_PROFILE}/Football`);
      if (data?._id) {
        setFootballAccountId(data._id);
        // Always use isFollowedByMe from API (queries Follow collection, more reliable)
        if (typeof data?.isFollowedByMe === 'boolean') {
          setIsFollowing(data.isFollowedByMe);
          console.log(`⚽ [FootballScreen] Follow status: ${data.isFollowedByMe ? 'Following' : 'Not following'}`);
        } else {
          // Fallback: check user.following array (less reliable, but better than nothing)
          const fallbackStatus = user.following?.includes(data._id) || false;
          setIsFollowing(fallbackStatus);
          console.warn(`⚠️ [FootballScreen] isFollowedByMe not in response, using fallback: ${fallbackStatus}`);
        }
      }
    } catch (error) {
      console.error('❌ [FootballScreen] Error checking follow status:', error);
    }
  };

  useEffect(() => {
    if (user) {
      checkFollowStatus();
    }
  }, [user]);

  // Re-check follow status when screen comes into focus (e.g., after refresh)
  useFocusEffect(
    React.useCallback(() => {
      if (user) {
        checkFollowStatus();
      }
    }, [user])
  );

  // Fetch matches function (can be called manually or via socket)
  const fetchMatches = async (silent = false) => {
    try {
      if (!silent) {
        console.log('⚽ [FootballScreen] Starting to fetch matches...');
        setLoading(true);
      }

      const today = new Date().toISOString().split('T')[0];

      // Fetch live matches (today)
      if (!silent) console.log('⚽ [FootballScreen] Fetching live matches (today)...');
      const liveData = await apiService.get(
        `${ENDPOINTS.GET_MATCHES}?status=live&date=${today}`
      );
      if (!silent) console.log('⚽ [FootballScreen] Live matches:', liveData.matches?.length || 0);
      setLiveMatches(liveData.matches || []);

      // Fetch upcoming matches (next 7 days)
      if (!silent) console.log('⚽ [FootballScreen] Fetching upcoming matches (next 7 days)');
      const upcomingData = await apiService.get(`${ENDPOINTS.GET_MATCHES}?status=upcoming`);
      if (!silent)
        console.log('⚽ [FootballScreen] Upcoming matches:', upcomingData.matches?.length || 0);
      setUpcomingMatches(upcomingData.matches || []);

      // Fetch finished matches (last 3 days)
      if (!silent) console.log('⚽ [FootballScreen] Fetching finished matches (last 3 days)');
      const finishedData = await apiService.get(`${ENDPOINTS.GET_MATCHES}?status=finished`);
      if (!silent)
        console.log('⚽ [FootballScreen] Finished matches:', finishedData.matches?.length || 0);
      setFinishedMatches(finishedData.matches || []);
    } catch (error: any) {
      console.error('⚽ [FootballScreen] Error fetching matches:', error);
      if (!silent) {
        showToast('Error', 'Failed to load matches', 'error');
      }
    } finally {
      if (!silent) {
        setLoading(false);
        setRefreshing(false);
        console.log('⚽ [FootballScreen] Finished fetching matches');
      }
    }
  };

  // Initial fetch on mount
  useEffect(() => {
    fetchMatches();
  }, []);

  // Listen for real-time match updates via socket
  useEffect(() => {
    if (!socket) return;

    const handleFootballPageUpdate = (data: any) => {
      console.log('📥 [FootballScreen] Update received:', {
        live: data.live?.length || 0,
        upcoming: data.upcoming?.length || 0,
        finished: data.finished?.length || 0,
      });

      // Update state directly - no API calls needed!
      if (data.live !== undefined) {
        setLiveMatches(data.live);
      }
      if (data.upcoming !== undefined) {
        setUpcomingMatches(data.upcoming);
      }
      if (data.finished !== undefined) {
        setFinishedMatches(data.finished);
      }
    };

    const handleFootballMatchUpdate = (data: any) => {
      console.log('⚽ [FootballScreen] Feed post update received, refreshing matches silently...');
      fetchMatches(true); // Silent refresh
    };

    socket.on('footballPageUpdate', handleFootballPageUpdate);
    socket.on('footballMatchUpdate', handleFootballMatchUpdate);

    return () => {
      socket.off('footballPageUpdate', handleFootballPageUpdate);
      socket.off('footballMatchUpdate', handleFootballMatchUpdate);
    };
  }, [socket]);

  // Follow/Unfollow Football account
  const handleFollowToggle = async () => {
    if (!footballAccountId) {
      showToast('Error', 'Football account not found', 'error');
      return;
    }

    const wasFollowing = isFollowing; // Store current state before API call
    
    try {
      setFollowLoading(true);

      // Backend uses POST /api/user/follow/:id (same endpoint for follow/unfollow)
      const response = await apiService.post(`${ENDPOINTS.FOLLOW_USER}/${footballAccountId}`);

      if (response) {
        // Re-check follow status from API to ensure accuracy (don't just toggle)
        await checkFollowStatus();
        
        // Use the opposite of what it was before (since we just toggled)
        showToast(
          'Success',
          wasFollowing
            ? 'Unfollowed Football channel'
            : 'Following Football channel! You\'ll now see updates in your feed',
          'success'
        );
      }
    } catch (error: any) {
      console.error('⚽ [FootballScreen] Error toggling follow:', error);
      showToast('Error', 'Failed to update follow status', 'error');
    } finally {
      setFollowLoading(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchMatches();
  };

  // Format time
  const formatTime = (dateString: string) => {
    if (!dateString) return 'TBD';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'TBD';
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  // Generate next 7 days for date selector
  const getNext7Days = () => {
    const days = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNumber = date.getDate();
      const monthName = date.toLocaleDateString('en-US', { month: 'short' });
      const dateString = date.toISOString().split('T')[0];

      days.push({
        dayName,
        dayNumber,
        monthName,
        dateString,
        isToday: i === 0,
      });
    }

    return days;
  };

  // Filter matches by selected date
  const filterMatchesByDate = (matches: Match[]) => {
    if (!selectedDate) return matches;

    return matches.filter((match) => {
      const matchDate = new Date(match.fixture?.date || '').toISOString().split('T')[0];
      return matchDate === selectedDate;
    });
  };

  // Render match card
  const renderMatchCard = (match: Match, showStatus = true) => (
    <View style={styles.matchCard}>
      {/* League info */}
      <View style={styles.leagueRow}>
        {match.league?.logo && (
          <Image source={{ uri: match.league.logo }} style={styles.leagueLogo} />
        )}
        <Text style={styles.leagueName}>{match.league?.name || 'Unknown League'}</Text>
        {showStatus && match.fixture?.status?.short === '1H' && (
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>
              🔴 LIVE {match.fixture?.status?.elapsed || 0}'
            </Text>
          </View>
        )}
        {showStatus && match.fixture?.status?.short === '2H' && (
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>
              🔴 LIVE {match.fixture?.status?.elapsed || 0}'
            </Text>
          </View>
        )}
        {showStatus && match.fixture?.status?.short === 'HT' && (
          <View style={styles.halfTimeBadge}>
            <Text style={styles.halfTimeBadgeText}>HALF TIME</Text>
          </View>
        )}
      </View>

      {/* Teams and score */}
      <View style={styles.matchContent}>
        {/* Home team */}
        <View style={styles.teamContainer}>
          <Text style={styles.teamName} numberOfLines={2}>
            {match.teams?.home?.name || 'TBD'}
          </Text>
          {match.teams?.home?.logo && (
            <Image source={{ uri: match.teams.home.logo }} style={styles.teamLogo} />
          )}
        </View>

        {/* Score or time */}
        <View style={styles.scoreContainer}>
          {match.fixture?.status?.short === 'NS' ? (
            <Text style={styles.matchTime}>{formatTime(match.fixture?.date || '')}</Text>
          ) : (
            <View style={styles.scoreRow}>
              <Text style={styles.score}>{match.goals?.home ?? 0}</Text>
              <Text style={styles.scoreSeparator}>-</Text>
              <Text style={styles.score}>{match.goals?.away ?? 0}</Text>
            </View>
          )}
        </View>

        {/* Away team */}
        <View style={styles.teamContainer}>
          {match.teams?.away?.logo && (
            <Image source={{ uri: match.teams.away.logo }} style={styles.teamLogo} />
          )}
          <Text style={styles.teamName} numberOfLines={2}>
            {match.teams?.away?.name || 'TBD'}
          </Text>
        </View>
      </View>

      {/* Match events - ONLY for finished matches */}
      {match.fixture?.status?.short === 'FT' && match.events && match.events.length > 0 && (
        <View style={styles.eventsContainer}>
          <Text style={styles.eventsTitle}>MATCH EVENTS</Text>
          {match.events
            .filter((e) => e.type === 'Goal')
            .slice(0, 5)
            .map((event, idx) => (
              <View key={`goal-${idx}`} style={styles.eventRow}>
                <Text style={styles.eventText}>
                  ⚽ {event.player} ({event.time}')
                </Text>
                <Text style={styles.eventTeam}>{event.team}</Text>
              </View>
            ))}
          {match.events
            .filter((e) => e.type === 'Card')
            .slice(0, 3)
            .map((event, idx) => (
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

  // Get current matches based on active tab
  const getCurrentMatches = () => {
    switch (activeTab) {
      case 'live':
        return liveMatches;
      case 'upcoming':
        return filterMatchesByDate(upcomingMatches);
      case 'finished':
        return finishedMatches;
      default:
        return [];
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>⚽ Football Live</Text>
          <Text style={styles.headerSubtitle}>Live scores & updates</Text>
        </View>
        {user && (
          <TouchableOpacity
            style={[styles.followButton, isFollowing && styles.unfollowButton]}
            onPress={handleFollowToggle}
            disabled={followLoading}
          >
            {followLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.followButtonText}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {!user && (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            💡 Follow the Football channel to get live match updates in your feed!
          </Text>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'live' && styles.activeTab]}
          onPress={() => setActiveTab('live')}
        >
          <Text style={[styles.tabText, activeTab === 'live' && styles.activeTabText]}>
            🔴 Live {liveMatches.length > 0 && `(${liveMatches.length})`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'upcoming' && styles.activeTab]}
          onPress={() => setActiveTab('upcoming')}
        >
          <Text style={[styles.tabText, activeTab === 'upcoming' && styles.activeTabText]}>
            📅 Upcoming {upcomingMatches.length > 0 && `(${upcomingMatches.length})`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'finished' && styles.activeTab]}
          onPress={() => setActiveTab('finished')}
        >
          <Text style={[styles.tabText, activeTab === 'finished' && styles.activeTabText]}>
            ✅ Finished {finishedMatches.length > 0 && `(${finishedMatches.length})`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Date selector for upcoming tab */}
      {activeTab === 'upcoming' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.dateSelector}
          contentContainerStyle={styles.dateSelectorContent}
        >
          {getNext7Days().map((day) => (
            <TouchableOpacity
              key={day.dateString}
              style={[
                styles.dateButton,
                selectedDate === day.dateString && styles.selectedDateButton,
              ]}
              onPress={() => setSelectedDate(day.dateString)}
            >
              <Text
                style={[
                  styles.dateDayName,
                  selectedDate === day.dateString && styles.selectedDateText,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {day.dayName}
              </Text>
              <Text
                style={[
                  styles.dateDayNumber,
                  selectedDate === day.dateString && styles.selectedDateText,
                ]}
                numberOfLines={1}
              >
                {day.dayNumber}
              </Text>
              <Text
                style={[
                  styles.dateMonthName,
                  selectedDate === day.dateString && styles.selectedDateText,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {day.monthName}
              </Text>
              {day.isToday && (
                <View style={styles.todayBadge}>
                  <Text style={styles.todayBadgeText} numberOfLines={1}>
                    Today
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Matches list */}
      <FlatList
        data={getCurrentMatches()}
        renderItem={({ item }) => renderMatchCard(item, activeTab !== 'upcoming')}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>
              {activeTab === 'live' ? '⚽' : activeTab === 'upcoming' ? '📭' : '🏁'}
            </Text>
            <Text style={styles.emptyText}>
              {activeTab === 'live'
                ? 'No live matches at the moment'
                : activeTab === 'upcoming'
                ? 'No upcoming matches on this day'
                : 'No finished matches today'}
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textGray,
    marginTop: 2,
  },
  followButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    minWidth: 80,
    alignItems: 'center',
  },
  unfollowButton: {
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.textGray,
  },
  followButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  infoBox: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 8,
    padding: 12,
    margin: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.text,
    textAlign: 'center',
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    fontSize: 14,
    color: COLORS.textGray,
    fontWeight: '500',
  },
  activeTabText: {
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  dateSelector: {
    maxHeight: 100,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  dateSelectorContent: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  dateButton: {
    width: 70,
    minWidth: 70,
    maxWidth: 70,
    flexShrink: 0,
    flexGrow: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectedDateButton: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  dateDayName: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.textGray,
    marginBottom: 2,
    textAlign: 'center',
    includeFontPadding: false,
  },
  dateDayNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
    includeFontPadding: false,
  },
  dateMonthName: {
    fontSize: 9,
    color: COLORS.textGray,
    marginTop: 2,
    textAlign: 'center',
    includeFontPadding: false,
  },
  selectedDateText: {
    color: '#FFFFFF',
  },
  todayBadge: {
    marginTop: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  todayBadgeText: {
    fontSize: 9,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  listContainer: {
    padding: 15,
  },
  matchCard: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    color: COLORS.text,
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
    marginBottom: 12,
  },
  teamContainer: {
    flex: 1,
    alignItems: 'center',
  },
  teamName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  teamLogo: {
    width: 30,
    height: 30,
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
    color: COLORS.text,
  },
  scoreSeparator: {
    fontSize: 18,
    color: COLORS.textGray,
    marginHorizontal: 4,
  },
  matchTime: {
    fontSize: 14,
    color: COLORS.textGray,
    fontWeight: '500',
  },
  eventsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  eventsTitle: {
    fontSize: 11,
    color: COLORS.textGray,
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
    color: COLORS.text,
    fontWeight: '500',
  },
  eventTeam: {
    fontSize: 11,
    color: COLORS.textGray,
  },
  emptyContainer: {
    padding: 60,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textGray,
    textAlign: 'center',
  },
});

export default FootballScreen;
