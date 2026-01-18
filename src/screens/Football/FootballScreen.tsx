import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';

interface Match {
  _id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  league: string;
  matchTime: string;
  stadium?: string;
}

const FootballScreen = () => {
  const { user } = useUser();
  const showToast = useShowToast();

  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    fetchMatches();
    checkFollowStatus();
  }, []);

  const fetchMatches = async () => {
    try {
      const baseUrl = 'https://media-1-aue5.onrender.com';
      const response = await fetch(`${baseUrl}/api/football/matches`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (response.ok && data.matches) {
        setMatches(data.matches);
      }
    } catch (error) {
      console.error('Error fetching matches:', error);
      showToast('Error', 'Failed to load matches', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const checkFollowStatus = async () => {
    try {
      const baseUrl = 'https://media-1-aue5.onrender.com';
      const response = await fetch(`${baseUrl}/api/user/getUserPro/Football`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (response.ok && data._id && user) {
        setIsFollowing(user.following?.includes(data._id) || false);
      }
    } catch (error) {
      console.error('Error checking follow status:', error);
    }
  };

  const handleFollowToggle = async () => {
    if (followLoading) return;

    setFollowLoading(true);
    try {
      const baseUrl = 'https://media-1-aue5.onrender.com';
      const footballUserRes = await fetch(`${baseUrl}/api/user/getUserPro/Football`, {
        credentials: 'include',
      });
      const footballUser = await footballUserRes.json();

      if (!footballUser._id) {
        showToast('Error', 'Football account not found', 'error');
        return;
      }

      const endpoint = isFollowing
        ? `${baseUrl}/api/user/unfollow/${footballUser._id}`
        : `${baseUrl}/api/user/follow/${footballUser._id}`;

      const response = await fetch(endpoint, {
        method: 'PUT',
        credentials: 'include',
      });

      if (response.ok) {
        setIsFollowing(!isFollowing);
        showToast(
          'Success',
          isFollowing ? 'Unfollowed Football' : '⚽ Following Football!',
          'success'
        );
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
      showToast('Error', 'Failed to update follow status', 'error');
    } finally {
      setFollowLoading(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchMatches();
  };

  const getStatusColor = (status: string) => {
    if (!status) return COLORS.text;
    
    switch (status.toLowerCase()) {
      case 'live':
      case 'in progress':
        return '#4CAF50';
      case 'finished':
      case 'ft':
        return COLORS.textGray;
      case 'scheduled':
      case 'upcoming':
        return COLORS.primary;
      default:
        return COLORS.text;
    }
  };

  const formatMatchTime = (dateString: string) => {
    if (!dateString) return 'TBD';
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'TBD';
    
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderMatch = ({ item }: { item: Match }) => (
    <View style={styles.matchCard}>
      <View style={styles.matchHeader}>
        <Text style={styles.league}>{item.league}</Text>
        <Text style={[styles.status, { color: getStatusColor(item.status) }]}>
          {item.status}
        </Text>
      </View>

      <View style={styles.matchContent}>
        <View style={styles.teamContainer}>
          <Text style={styles.teamName}>{item.homeTeam}</Text>
          <Text style={styles.score}>{item.homeScore ?? '-'}</Text>
        </View>

        <Text style={styles.vs}>VS</Text>

        <View style={styles.teamContainer}>
          <Text style={styles.teamName}>{item.awayTeam}</Text>
          <Text style={styles.score}>{item.awayScore ?? '-'}</Text>
        </View>
      </View>

      <View style={styles.matchFooter}>
        {item.stadium && (
          <Text style={styles.stadium}>📍 {item.stadium}</Text>
        )}
        <Text style={styles.matchTime}>⏰ {formatMatchTime(item.matchTime)}</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>⚽ Football</Text>
          <Text style={styles.headerSubtitle}>Live matches & scores</Text>
        </View>
        <TouchableOpacity
          style={[styles.followButton, isFollowing && styles.unfollowButton]}
          onPress={handleFollowToggle}
          disabled={followLoading}
        >
          {followLoading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.followButtonText}>
              {isFollowing ? 'Unfollow' : 'Follow'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={matches}
        renderItem={renderMatch}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>⚽</Text>
            <Text style={styles.emptyText}>No matches available</Text>
            <Text style={styles.emptySubtext}>
              Check back later for live matches and scores
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
  matchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  league: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  status: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  matchContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  teamContainer: {
    flex: 1,
    alignItems: 'center',
  },
  teamName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  score: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  vs: {
    fontSize: 14,
    color: COLORS.textGray,
    fontWeight: 'bold',
    marginHorizontal: 10,
  },
  matchFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  stadium: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  matchTime: {
    fontSize: 12,
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
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 10,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textGray,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default FootballScreen;
