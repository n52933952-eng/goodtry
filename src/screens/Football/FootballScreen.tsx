import React, { useState, useEffect, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  DeviceEventEmitter,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { ENDPOINTS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { useShowToast } from '../../hooks/useShowToast';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import FootballMatchCard from '../../components/FootballMatchCard';

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
  const { t } = useLanguage();

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

  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        loadingContainer: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        },
        header: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 15,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerTitle: {
          fontSize: 24,
          fontWeight: 'bold',
          color: colors.text,
        },
        headerSubtitle: {
          fontSize: 14,
          color: colors.textGray,
          marginTop: 2,
        },
        followButton: {
          backgroundColor: colors.primary,
          paddingVertical: 8,
          paddingHorizontal: 16,
          borderRadius: 20,
          minWidth: 80,
          alignItems: 'center',
        },
        unfollowButton: {
          backgroundColor: colors.backgroundLight,
          borderWidth: 1,
          borderColor: colors.border,
        },
        followButtonText: {
          color: '#FFFFFF',
          fontSize: 14,
          fontWeight: 'bold',
        },
        followButtonTextMuted: {
          color: colors.text,
        },
        infoBox: {
          backgroundColor: colors.backgroundLight,
          borderRadius: 8,
          padding: 12,
          margin: 15,
          borderWidth: 1,
          borderColor: colors.border,
        },
        infoText: {
          fontSize: 14,
          color: colors.text,
          textAlign: 'center',
        },
        tabsContainer: {
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
        },
        tab: {
          flex: 1,
          paddingVertical: 12,
          alignItems: 'center',
          borderBottomWidth: 2,
          borderBottomColor: 'transparent',
        },
        activeTab: {
          borderBottomColor: colors.primary,
        },
        tabText: {
          fontSize: 14,
          color: colors.textGray,
          fontWeight: '500',
        },
        activeTabText: {
          color: colors.primary,
          fontWeight: 'bold',
        },
        dateSelector: {
          maxHeight: 100,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
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
          backgroundColor: colors.backgroundLight,
          borderWidth: 1,
          borderColor: colors.border,
        },
        selectedDateButton: {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
        },
        dateDayName: {
          fontSize: 9,
          fontWeight: '600',
          color: colors.textGray,
          marginBottom: 2,
          textAlign: 'center',
          includeFontPadding: false,
        },
        dateDayNumber: {
          fontSize: 18,
          fontWeight: 'bold',
          color: colors.text,
          textAlign: 'center',
          includeFontPadding: false,
        },
        dateMonthName: {
          fontSize: 9,
          color: colors.textGray,
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
          color: colors.textGray,
          textAlign: 'center',
        },
      }),
    [colors],
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
      showToast(t('error'), t('footballAccountNotFound'), 'error');
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

        // If user just followed Football, tell FeedScreen to boost Football post to top on next refresh.
        if (!wasFollowing) {
          DeviceEventEmitter.emit('FootballFollowedBoost', { ts: Date.now() });
        }
        
        // Use the opposite of what it was before (since we just toggled)
        showToast(
          t('success'),
          wasFollowing
            ? t('unfollowedFootballChannel')
            : t('followingFootballChannel'),
          'success'
        );
      }
    } catch (error: any) {
      console.error('⚽ [FootballScreen] Error toggling follow:', error);
      showToast(t('error'), t('failedToUpdateFollowStatus'), 'error');
    } finally {
      setFollowLoading(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchMatches();
  };

  // Format time
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
        <ActivityIndicator size="large" color={colors.primary} />
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
              <ActivityIndicator color={isFollowing ? colors.text : '#FFFFFF'} size="small" />
            ) : (
              <Text style={[styles.followButtonText, isFollowing && styles.followButtonTextMuted]}>
                {isFollowing ? t('following') : t('follow')}
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
        renderItem={({ item }) => (
          <FootballMatchCard match={item} showStatus={activeTab !== 'upcoming'} />
        )}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>
              {activeTab === 'live' ? '⚽' : activeTab === 'upcoming' ? '📭' : '🏁'}
            </Text>
            <Text style={styles.emptyText}>
              {activeTab === 'live'
                ? t('noLiveMatches')
                : activeTab === 'upcoming'
                ? t('noUpcomingMatches')
                : t('noFinishedMatches')}
            </Text>
          </View>
        }
      />
    </View>
  );
};

export default FootballScreen;
