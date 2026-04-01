import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Dimensions,
  ActivityIndicator,
  Linking,
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import YoutubePlayer from 'react-native-youtube-iframe';
import { useNavigation } from '@react-navigation/native';
import { useUser } from '../context/UserContext';
import { usePost } from '../context/PostContext';
import { useTheme } from '../context/ThemeContext';
import { useSocket } from '../context/SocketContext';
import { apiService } from '../services/api';
import { ENDPOINTS, COLORS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';
import { useLanguage } from '../context/LanguageContext';
import VideoFeedPreview from './VideoFeedPreview';
import AddContributorModal from './AddContributorModal';
import ManageContributorsModal from './ManageContributorsModal';
import EditPostModal from './EditPostModal';
import StoryAvatarRing from './StoryAvatarRing';
import StoryOrProfileSheet from './StoryOrProfileSheet';
import { navigateToMainStack } from '../utils/navigationHelpers';

interface PostProps {
  post: any;
  disableNavigation?: boolean; // If true, disable navigation to PostDetail (for PostDetailScreen)
  fromScreen?: string; // Screen name where Post is rendered (e.g., 'UserProfile')
  userProfileParams?: any; // Params to pass when navigating back to UserProfile
  autoPlayMedia?: boolean; // Force media autoplay (used in PostDetail)
  /** When the post is updated in-place (e.g. contributors), parent can sync local state (Post detail). */
  onPostUpdated?: (updated: any) => void;
  /** Feed: active story for this author (for ring + tap menu). */
  storyRing?: { storyId: string; hasUnviewed: boolean } | null;
  /** Bumps on feed focus — restarts story ring fill animation */
  storyRingReplayKey?: number;
}

const Post: React.FC<PostProps> = ({
  post,
  disableNavigation = false,
  fromScreen,
  userProfileParams,
  autoPlayMedia = false,
  onPostUpdated,
  storyRing,
  storyRingReplayKey = 0,
}) => {
  const navigation = useNavigation<any>();
  
  // Helper function to navigate to PostDetail (ensures tab bar is visible)
  const navigateToPostDetail = (postId: string) => {
    // When navigating from UserProfileScreen, navigate within ProfileStack
    // When navigating from Feed, navigate within FeedStack
    if (fromScreen === 'UserProfile') {
      // Navigate to PostDetail within ProfileStack (tab bar will be visible)
      navigation.navigate('PostDetail', {
        postId,
        fromScreen,
        userProfileParams,
      });
    } else {
      // Navigate through Feed tab (for Feed screen and other tab contexts)
      navigation.navigate('Feed', { 
        screen: 'PostDetail', 
        params: { 
          postId,
          fromScreen, // Pass the source screen
          userProfileParams, // Pass params for navigating back
        } 
      });
    }
  };
  const { user } = useUser();
  const {
    likePost,
    unlikePost,
    deletePost: deletePostContext,
    updatePost,
    hideFeedPostFromFeed,
    hideFeedSourceFromFeed,
  } = usePost();
  const { t } = useLanguage();
  const { colors } = useTheme();
  const { socket } = useSocket();
  const showToast = useShowToast();

  const [addContribOpen, setAddContribOpen] = useState(false);
  const [manageContribOpen, setManageContribOpen] = useState(false);
  const [editPostOpen, setEditPostOpen] = useState(false);
  const [storyMenu, setStoryMenu] = useState<{ userId: string; username: string } | null>(null);

  // Contributor hydration: sometimes API/socket returns contributor ids only. Fetch profiles so avatars show without reload.
  const [contribHydrateMap, setContribHydrateMap] = useState<Record<string, any>>({});
  const contribHydrateInFlightRef = useRef<Record<string, boolean>>({});

  const contributorIdsNeedingHydration = useMemo(() => {
    if (!post?.isCollaborative || !Array.isArray(post?.contributors)) return [];
    const ids: string[] = [];
    for (const c of post.contributors) {
      const id =
        typeof c === 'string' || typeof c === 'number'
          ? String(c)
          : c?._id != null
            ? String(c._id)
            : '';
      if (!id) continue;
      const hasPic = typeof c === 'object' && !!c?.profilePic;
      const already = !!contribHydrateMap[id];
      if (!hasPic && !already) ids.push(id);
    }
    return ids.slice(0, 12);
  }, [post?.isCollaborative, post?.contributors, contribHydrateMap]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!contributorIdsNeedingHydration.length) return;
      const todo = contributorIdsNeedingHydration.filter((id) => !contribHydrateInFlightRef.current[id]);
      if (!todo.length) return;
      todo.forEach((id) => (contribHydrateInFlightRef.current[id] = true));
      try {
        const results = await Promise.all(
          todo.map(async (id) => {
            try {
              // Backend supports both username or userId: /api/user/getUserPro/:query
              const data = await apiService.get(`${ENDPOINTS.GET_USER_PROFILE}/${encodeURIComponent(String(id))}`);
              const u = (data as any)?.user ?? data;
              const uid = u?._id != null ? String(u._id) : id;
              return uid ? { id: uid, user: u } : null;
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;
        const next: Record<string, any> = {};
        for (const r of results) {
          if (r?.id && r.user) next[r.id] = r.user;
        }
        if (Object.keys(next).length) {
          setContribHydrateMap((prev) => ({ ...prev, ...next }));
        }
      } finally {
        todo.forEach((id) => (contribHydrateInFlightRef.current[id] = false));
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [contributorIdsNeedingHydration]);

  const [isLiking, setIsLiking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [youtubePlaying, setYoutubePlaying] = useState(true);
  // Local state for optimistic like updates (like web)
  const [localLiked, setLocalLiked] = useState(post.likes?.includes(user?._id));
  const [localLikesCount, setLocalLikesCount] = useState(post.likes?.length || 0);
  
  // Weather post state
  const isWeatherPost = post.postedBy?.username === 'Weather' && post.weatherData;
  const [weatherDataArray, setWeatherDataArray] = useState<any[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);

  // Football post detection - log all posts to debug
  const isFootballPost = post.isFootballPost || post.postedBy?.username === 'Football';
  if (isFootballPost || post.postedBy?.username === 'Football') {
    console.log('⚽ [Post] Football post detected:', {
      isFootballPost: post.isFootballPost,
      username: post.postedBy?.username,
      hasLiveMatches: !!post.liveMatches,
      hasMatches: !!post.matches,
      hasTodayMatches: !!post.todayMatches,
      hasFootballData: !!post.footballData,
      allKeys: Object.keys(post),
      allKeysFull: Object.keys(post).join(', '), // Show all keys as string
      text: post.text?.substring(0, 50),
      fullPost: post // Log entire post structure
    });
  }

  // Chess game post state
  const isChessPost = !!post?.chessGameData;
  const [chessGameData, setChessGameData] = useState<any>(null);

  // Football post state - fetch matches from API
  const [footballMatches, setFootballMatches] = useState<any[]>([]);
  const [footballLoading, setFootballLoading] = useState(false);
  
  // Parse chess game data
  useEffect(() => {
    if (isChessPost && post.chessGameData) {
      try {
        const parsed = typeof post.chessGameData === 'string' 
          ? JSON.parse(post.chessGameData) 
          : post.chessGameData;
        setChessGameData(parsed);
      } catch (e) {
        console.error('❌ [Post] Error parsing chessGameData:', e);
        setChessGameData(null);
      }
    } else {
      setChessGameData(null);
    }
  }, [isChessPost, post?.chessGameData]);

  // Do not auto-navigate from the feed into ChessGame — it caused false opens after cancel/reconnect
  // and duplicated AppNavigator's acceptChessChallenge handling. Players open the game from the modal / socket.

  // Fetch football matches for football posts (reusable function)
  const fetchFootballMatches = React.useCallback(async (silent = false) => {
    if (!isFootballPost) return;

    try {
      if (!silent) {
        setFootballLoading(true);
        console.log('⚽ [Post] Starting to fetch matches...');
      }
      
      const today = new Date().toISOString().split('T')[0];
      
      // Fetch ONLY live matches (today) - no upcoming matches in feed
      const liveData = await apiService.get(
        `${ENDPOINTS.GET_MATCHES}?status=live&date=${today}`
      );
      const liveMatches = liveData.matches || [];
      
      // Only set live matches (no upcoming matches in feed)
      setFootballMatches(liveMatches);
      
      if (!silent) {
        console.log('⚽ [Post] Fetched LIVE matches only:', {
          live: liveMatches.length,
          total: liveMatches.length,
          liveMatches: liveMatches
        });
      }
    } catch (error: any) {
      console.error('⚽ [Post] Error fetching football matches:', error);
    } finally {
      if (!silent) {
        setFootballLoading(false);
      }
    }
  }, [isFootballPost]);

  // Initial fetch on mount
  useEffect(() => {
    console.log('⚽ [Post] useEffect triggered:', { isFootballPost, username: post.postedBy?.username });
    if (!isFootballPost) {
      console.log('⚽ [Post] Skipping fetch - not a football post');
      return;
    }

    fetchFootballMatches();
  }, [isFootballPost, fetchFootballMatches]);

  // Listen for real-time match updates via socket
  useEffect(() => {
    if (!isFootballPost || !socket) return;

    const handleFootballMatchUpdate = () => {
      console.log('⚽ [Post] Match update received via socket, refreshing matches silently...');
      fetchFootballMatches(true); // Silent refresh (no loading spinner)
    };

    const handleFootballPageUpdate = (data: any) => {
      console.log('⚽ [Post] Page update received via socket:', {
        live: data.live?.length || 0,
        upcoming: data.upcoming?.length || 0,
        finished: data.finished?.length || 0
      });
      fetchFootballMatches(true); // Silent refresh
    };

    socket.on('footballMatchUpdate', handleFootballMatchUpdate);
    socket.on('footballPageUpdate', handleFootballPageUpdate);

    return () => {
      socket.off('footballMatchUpdate', handleFootballMatchUpdate);
      socket.off('footballPageUpdate', handleFootballPageUpdate);
    };
  }, [isFootballPost, socket, fetchFootballMatches]);

  // Handle chess post click - navigate to watch game
  const handleChessPostClick = () => {
    if (!chessGameData || !chessGameData.roomId) {
      showToast('Error', 'Invalid chess game data', 'error');
      return;
    }

    const currentUserId = user?._id?.toString();
    const player1Id = chessGameData.player1?._id?.toString();
    const player2Id = chessGameData.player2?._id?.toString();
    const roomId = chessGameData.roomId;

    // Determine opponent ID for navigation
    let opponentId = player1Id;
    if (currentUserId === player1Id) {
      opponentId = player2Id || player1Id;
    } else if (currentUserId === player2Id) {
      opponentId = player1Id || player2Id;
    }

    // Navigate to ChessGame screen as spectator
    console.log('♟️ [Post] Navigating to chess game:', { roomId, opponentId, isSpectator: true });
    navigation.navigate('ChessGame', {
      roomId,
      opponentId: opponentId || player1Id,
      color: 'white', // Spectators view as white by default
      isSpectator: true,
    });
  };

  // Update local state when post prop changes
  useEffect(() => {
    setLocalLiked(post.likes?.includes(user?._id));
    setLocalLikesCount(post.likes?.length || 0);
  }, [post.likes, user?._id]);

  // Ensure media starts playing when opening PostDetail.
  useEffect(() => {
    if (disableNavigation && autoPlayMedia) {
      setYoutubePlaying(true);
    }
  }, [disableNavigation, autoPlayMedia, post?._id]);

  // Load personalized weather data for weather posts
  useEffect(() => {
    if (!isWeatherPost || !post?.weatherData) {
      setWeatherDataArray([]);
      setWeatherLoading(false);
      return;
    }

    const loadPersonalizedWeather = async () => {
      setWeatherLoading(true);
      
      try {
        // Parse weatherData from JSON string
        let allWeatherData: any[] = [];
        try {
          const parsed = typeof post.weatherData === 'string' 
            ? JSON.parse(post.weatherData) 
            : post.weatherData;
          allWeatherData = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          console.error('❌ [Post] Error parsing weatherData:', e);
          setWeatherLoading(false);
          return;
        }

        console.log(`🌤️ [Post] Parsed weather data: ${allWeatherData.length} cities available`);
        console.log(`🌤️ [Post] Available cities:`, allWeatherData.map((w: any) => w.city).slice(0, 10));

        // If user is logged in, fetch their preferences and filter
        if (user?._id) {
          try {
            const prefsRes = await apiService.get(ENDPOINTS.GET_WEATHER_PREFERENCES);
            const prefsData = prefsRes;
            
            console.log(`🌤️ [Post] User preferences response:`, prefsData);
            
            // Get user's selected city names
            const selectedCityNames = prefsData?.selectedCities || prefsData?.cities?.map((c: any) => c.name || c) || [];
            
            console.log(`🌤️ [Post] User selected cities:`, selectedCityNames);
            
            if (selectedCityNames.length > 0) {
              // Filter to show only user's selected cities
              // Use flexible matching: handle "Amman, JO" vs "Amman" or case differences
              const filtered = allWeatherData.filter((w: any) => {
                const weatherCityName = w.city?.toLowerCase().trim() || '';
                // Remove country code if present (e.g., "Amman, JO" -> "amman")
                const weatherCityBase = weatherCityName.split(',')[0].trim();
                
                const matches = selectedCityNames.some((cityName: string) => {
                  const selectedCityName = cityName.toLowerCase().trim();
                  // Check exact match
                  if (weatherCityName === selectedCityName || weatherCityBase === selectedCityName) {
                    console.log(`✅ [Post] Match found: "${w.city}" matches "${cityName}"`);
                    return true;
                  }
                  // Check if weather city contains selected city name (for "Amman, JO" vs "Amman")
                  if (weatherCityBase.includes(selectedCityName) || selectedCityName.includes(weatherCityBase)) {
                    console.log(`✅ [Post] Partial match found: "${w.city}" matches "${cityName}"`);
                    return true;
                  }
                  return false;
                });
                return matches;
              });
              
              console.log(`🌤️ [Post] Filtered weather: ${filtered.length} cities from ${allWeatherData.length} total (user selected: ${selectedCityNames.length})`);
              console.log(`🌤️ [Post] Filtered cities:`, filtered.map((w: any) => w.city));
              
              if (filtered.length === 0) {
                console.warn(`⚠️ [Post] No matches found! Selected: ${selectedCityNames.join(', ')}, Available: ${allWeatherData.map((w: any) => w.city).join(', ')}`);
              }
              
              setWeatherDataArray(filtered);
            } else {
              // No cities selected, show default cities (first 5)
              console.log('🌤️ [Post] No cities selected, showing default cities');
              setWeatherDataArray(allWeatherData.slice(0, 5));
            }
          } catch (error) {
            console.error('❌ [Post] Error fetching weather preferences:', error);
            // Fallback to default cities
            setWeatherDataArray(allWeatherData.slice(0, 5));
          }
        } else {
          // Not logged in, show default cities
          setWeatherDataArray(allWeatherData.slice(0, 5));
        }
      } catch (error) {
        console.error('❌ [Post] Error loading weather:', error);
        setWeatherDataArray([]);
      } finally {
        setWeatherLoading(false);
      }
    };

    loadPersonalizedWeather();
  }, [isWeatherPost, post?.weatherData, user?._id]);

  const isLiked = localLiked; // Use local state for immediate UI update

  const postedById =
    (typeof post.postedBy === 'string' ? post.postedBy : post.postedBy?._id)?.toString?.() ??
    String(typeof post.postedBy === 'string' ? post.postedBy : post.postedBy?._id ?? '');
  const currentUserId = user?._id?.toString?.() ?? (user?._id ? String(user._id) : '');

  const isOwner = !!postedById && !!currentUserId && postedById === currentUserId;
  const isContributor = post.contributors?.some((c: any) => {
    const cId = (typeof c === 'string' ? c : c?._id)?.toString?.() ?? String(typeof c === 'string' ? c : c?._id);
    return !!cId && !!currentUserId && cId === currentUserId;
  });

  const canAddCollaborator =
    !!post.isCollaborative && (isOwner || !!isContributor);
  const canManageContributorsList =
    isOwner &&
    !!post.isCollaborative &&
    Array.isArray(post.contributors) &&
    post.contributors.length > 0;

  const onCollaborativePostUpdated = (updated: any) => {
    if (updated?._id) {
      updatePost(updated._id, updated);
      onPostUpdated?.(updated);
    }
  };

  const handleLike = async () => {
    if (isLiking || !user) return;

    // Optimistic update: Update UI immediately (like web)
    const previousLiked = isLiked;
    const previousCount = localLikesCount;
    
    setLocalLiked(!previousLiked);
    setLocalLikesCount(previousLiked ? previousCount - 1 : previousCount + 1);
    setIsLiking(true);

    try {
      await apiService.put(`${ENDPOINTS.LIKE_POST}/${post._id}`);
      
      // Update context after API call succeeds
      if (previousLiked) {
        unlikePost(post._id, user._id);
      } else {
        likePost(post._id, user._id);
      }
    } catch (error: any) {
      console.error('Error liking post:', error);
      // Revert optimistic update on error
      setLocalLiked(previousLiked);
      setLocalLikesCount(previousCount);
      showToast('Error', 'Failed to like post', 'error');
    } finally {
      setIsLiking(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await apiService.delete(`${ENDPOINTS.DELETE_POST}/${post._id}`);
              deletePostContext(post._id);
              showToast('Success', 'Post deleted', 'success');
            } catch (error: any) {
              console.error('Error deleting post:', error);
              showToast('Error', 'Failed to delete post', 'error');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  // Extract YouTube video ID from many possible URL shapes:
  // embed, watch?v=, youtu.be, shorts, live, and thumbnail /vi/<id>/...
  const getYouTubeVideoId = (url: string) => {
    if (!url) return '';
    const normalized = url.trim();
    const patterns = [
      /youtube\.com\/embed\/([^?&/]+)/i,
      /youtube\.com\/watch\?v=([^?&/]+)/i,
      /youtu\.be\/([^?&/]+)/i,
      /youtube\.com\/shorts\/([^?&/]+)/i,
      /youtube\.com\/live\/([^?&/]+)/i,
      /(?:ytimg\.com|img\.youtube\.com)\/vi\/([^?&/]+)/i,
    ];
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) return match[1];
    }
    return '';
  };

  const youtubeVideoId = getYouTubeVideoId(post.img || '');
  const isYouTubePost = !!youtubeVideoId;

  // Check if this is a channel post (system account with YouTube or channel post)
  const channelUsernames = ['Football', 'AlJazeera', 'NBCNews', 'BeinSportsNews', 'SkyNews', 'Cartoonito', 
    'NatGeoKids', 'SciShowKids', 'JJAnimalTime', 'KidsArabic', 'NatGeoAnimals', 'MBCDrama', 'Fox11'];
  const isChannelPost = isYouTubePost || !!post?.channelAddedBy || 
    channelUsernames.includes(post.postedBy?.username);

  const isCardPost = !!post?.cardGameData;

  const isMyChannelFeedCard =
    !!post?.channelAddedBy && String(post.channelAddedBy) === String(user?._id);
  const showDismissFromFeed =
    (isFootballPost || isWeatherPost || isMyChannelFeedCard) && !isChessPost && !isCardPost;

  const handleDismissFromFeed = () => {
    Alert.alert(
      t('removeFromFeed'),
      t('removeFromFeedHint'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('removeFromFeedConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Channels you add are real DB posts scoped to you (`channelAddedBy`).
              // Deleting them server-side prevents them from "coming back" when you follow Football/refresh feed.
              if (isMyChannelFeedCard && post?._id) {
                await apiService.delete(`${ENDPOINTS.DELETE_POST}/${String(post._id)}`);
                deletePostContext(String(post._id));
              } else {
                // Football/Weather cards are global/system posts; hide only.
                const uname = post?.postedBy?.username;
                if (uname === 'Football' || uname === 'Weather') {
                  hideFeedSourceFromFeed(String(uname));
                } else {
                  hideFeedPostFromFeed(String(post._id));
                }
              }
              showToast(t('success'), t('removedFromFeed'), 'success');
            } catch (e: any) {
              showToast(t('error'), e?.message || 'Failed', 'error');
            }
          },
        },
      ]
    );
  };

  const canEditPostText =
    !!user &&
    !isChannelPost &&
    !isWeatherPost &&
    !isFootballPost &&
    !isChessPost &&
    !isCardPost &&
    !post?.channelAddedBy &&
    (isOwner || (!!post.isCollaborative && isContributor));
  
  // Debug log for channel detection
  if (isYouTubePost) {
    console.log('📺 [Post] Detected as YouTube post:', { username: post.postedBy?.username, youtubeVideoId, img: post.img });
  }
  
  // Check if post has regular video (mp4, webm, etc.)
  const isVideoPost = post.img && (
    post.img.match(/\.(mp4|webm|ogg|mov)$/i) || 
    post.img.includes('/video/upload/')
  );

  const { width } = Dimensions.get('window');
  const videoHeight = (width - 30) * 0.5625; // 16:9 aspect ratio

  const showStoryRing =
    !!storyRing?.storyId &&
    !!postedById &&
    !isChannelPost &&
    !isWeatherPost &&
    !isFootballPost &&
    !isChessPost &&
    !isCardPost;

  const onAvatarPress = (e: any) => {
    e.stopPropagation();
    if (disableNavigation) return;

    const username =
      typeof post.postedBy === 'object' && post.postedBy?.username
        ? String(post.postedBy.username).trim()
        : '';

    if (isChannelPost && post?._id) {
      navigateToPostDetail(post._id);
      return;
    }
    if (!username) return;

    if (showStoryRing && storyRing?.storyId && postedById) {
      setStoryMenu({ userId: postedById, username });
      return;
    }

    navigation.navigate('Profile', {
      screen: 'UserProfile',
      params: { username },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border }]}>
      <View style={styles.header}>
        <StoryAvatarRing
          visible={showStoryRing}
          showAnimatedRedFill={!!storyRing?.storyId && !!storyRing?.hasUnviewed}
          replayKey={storyRingReplayKey}
          ringOuterSize={50}
          avatarSize={45}
          strokeWidth={2}
        >
          <TouchableOpacity
            onPress={onAvatarPress}
            activeOpacity={disableNavigation ? 1 : 0.7}
            disabled={disableNavigation}
          >
          {(() => {
            // Use current user's profilePic if it's own post (for immediate updates)
            const avatarPic = isOwner && user?.profilePic 
              ? user.profilePic 
              : (post.postedBy?.profilePic && !isChannelPost ? post.postedBy.profilePic : null);
            
            return avatarPic ? (
              <Image 
                source={{ uri: avatarPic }} 
                style={styles.avatar}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                <Text style={styles.avatarText}>
                  {(() => {
                    // For channels, use first two letters of username or name
                    const name = post.postedBy?.name || post.postedBy?.username || '';
                    if (isChannelPost && name.length >= 2) {
                      return name.substring(0, 2).toUpperCase();
                    }
                    // For regular users, use first letter
                    return name[0]?.toUpperCase() || '?';
                  })()}
                </Text>
              </View>
            );
          })()}
        </TouchableOpacity>
        </StoryAvatarRing>

        <View style={styles.headerInfo}>
          <View style={styles.headerTop}>
            <Text style={[styles.name, { color: colors.text }]}>{post.postedBy?.name || 'Unknown'}</Text>
            {post.isCollaborative && (
              <Text style={styles.collaborativeBadge}>👥</Text>
            )}
            <Text style={[styles.time, { color: colors.textGray }]}>
              {`· ${formatTime(post.createdAt)}${
                post.editedAt
                  ? ` · ${t('editedPost')} ${formatTime(post.editedAt)}`
                  : ''
              }`}
            </Text>
          </View>
          <Text style={[styles.username, { color: colors.textGray }]}>@{post.postedBy?.username}</Text>
        </View>

        <View style={styles.headerActions}>
          {showDismissFromFeed && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleDismissFromFeed();
              }}
              style={{ padding: 6, marginRight: 2 }}
              accessibilityLabel={t('removeFromFeed')}
            >
              <Text style={{ fontSize: 18, color: colors.textGray }}>✕</Text>
            </TouchableOpacity>
          )}
          {canEditPostText && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                setEditPostOpen(true);
              }}
              style={{ padding: 5, marginRight: 4 }}
            >
              <Text style={styles.editButton}>✏️</Text>
            </TouchableOpacity>
          )}
          {isOwner && (
            <TouchableOpacity onPress={handleDelete} disabled={isDeleting}>
              <Text style={styles.deleteButton}>🗑️</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {post.isCollaborative &&
        Array.isArray(post.contributors) &&
        post.contributors.length > 0 &&
        (() => {
          const ownerId = postedById;
          const displayContributors = post.contributors.filter((c: any) => {
            const cid = (typeof c === 'string' ? c : c?._id)?.toString?.();
            return cid && cid !== ownerId;
          });
          if (displayContributors.length === 0) return null;
          return (
            <View style={{ marginBottom: 10 }}>
              <Text style={[styles.contributorsLabel, { color: colors.textGray }]}>{t('contributors')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 6 }}
                contentContainerStyle={{ alignItems: 'center' }}
              >
                {displayContributors.map((contributor: any, idx: number) => {
                  const cid = (contributor?._id || contributor)?.toString();
                  const hydrated = cid && contribHydrateMap[cid] ? contribHydrateMap[cid] : null;
                  const cObj = hydrated || contributor;
                  const label = cObj?.name || cObj?.username || '?';
                  return (
                    <View key={cid || String(idx)} style={{ marginRight: 8 }}>
                      {cObj?.profilePic ? (
                        <Image source={{ uri: cObj.profilePic }} style={styles.contribAvatar} />
                      ) : (
                        <View
                          style={[
                            styles.contribAvatar,
                            {
                              backgroundColor: colors.avatarBg,
                              justifyContent: 'center',
                              alignItems: 'center',
                            },
                          ]}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700' }}>{label[0]?.toUpperCase()}</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          );
        })()}

      {canAddCollaborator && (
        <View style={styles.collabActions}>
          <TouchableOpacity
            style={{ marginRight: 16 }}
            onPress={(e) => {
              e.stopPropagation();
              setAddContribOpen(true);
            }}
          >
            <Text style={[styles.collabActionText, { color: colors.primary }]}>+ {t('addContributor')}</Text>
          </TouchableOpacity>
          {canManageContributorsList && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                setManageContribOpen(true);
              }}
            >
              <Text style={[styles.collabActionText, { color: colors.text }]}>{t('manageContributors')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Hide post text for football posts if we have matches (from API or post data) */}
      {!(isFootballPost && (footballMatches.length > 0 || post.liveMatches?.length > 0 || post.matches?.length > 0 || post.todayMatches?.length > 0)) && (
        disableNavigation ? (
          <Text style={[styles.text, { color: colors.text }]}>{post.text}</Text>
        ) : (
          <TouchableOpacity 
            onPress={() => {
              // Navigate to PostDetail
              navigateToPostDetail(post._id);
            }}
            activeOpacity={0.9}
          >
            <Text style={[styles.text, { color: colors.text }]}>{post.text}</Text>
          </TouchableOpacity>
        )
      )}

      {post.img && isYouTubePost && youtubeVideoId ? (
        disableNavigation ? (
          <View style={styles.videoContainer}>
            <YoutubePlayer
            height={styles.videoContainer.height}
            videoId={youtubeVideoId}
            play={disableNavigation && autoPlayMedia ? true : youtubePlaying}
            mute={false}
            webViewProps={{
              allowsInlineMediaPlayback: true,
              androidLayerType: 'hardware',
            }}
            initialPlayerParams={{
              controls: true,
              modestbranding: true,
              rel: false,
              autoplay: 1,
              mute: 0,
            }}
            onError={(error: unknown) => {
              console.error('❌ [Post] YouTube player error:', error);
            }}
            onReady={() => {
              console.log('✅ [Post] YouTube player ready - auto-playing');
              setYoutubePlaying(true);
            }}
            onChangeState={(state: string) => {
              console.log('📺 [Post] YouTube state:', state);
              // Update state based on player state
              if (state === 'playing') {
                setYoutubePlaying(true);
              } else if (state === 'paused') {
                setYoutubePlaying(false);
              }
            }}
          />
          </View>
        ) : (
          // FEED OPTIMIZATION: render a lightweight thumbnail instead of mounting YoutubePlayer in a scrolling list
          <TouchableOpacity
            onPress={() => navigateToPostDetail(post._id)}
            activeOpacity={0.9}
          >
            <View style={styles.videoContainer}>
              <Image
                source={{ uri: `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg` }}
                style={styles.youtubeThumbnail}
                resizeMode="cover"
              />
              <View style={styles.youtubeOverlay}>
                <View style={styles.youtubePlayButton}>
                  <Text style={styles.youtubePlayIcon}>▶</Text>
                </View>
                <Text style={styles.youtubeWatchText}>Tap to watch</Text>
              </View>
            </View>
          </TouchableOpacity>
        )
      ) : post.img && isVideoPost ? (
        disableNavigation ? (
          <View style={styles.videoContainer}>
            <WebView
            source={{
              html: `
                <!DOCTYPE html>
                <html>
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
                    <style>
                      * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                        -webkit-tap-highlight-color: transparent;
                      }
                      body {
                        margin: 0;
                        padding: 0;
                        background: #000;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        overflow: hidden;
                        touch-action: manipulation;
                      }
                      video {
                        width: 100%;
                        height: 100%;
                        max-height: 400px;
                        object-fit: contain;
                      }
                      /* Make video controls more accessible */
                      video::-webkit-media-controls {
                        transform: scale(1.3);
                      }
                      video::-webkit-media-controls-panel {
                        background-color: rgba(0, 0, 0, 0.8);
                      }
                      video::-webkit-media-controls-play-button {
                        width: 50px;
                        height: 50px;
                      }
                    </style>
                  </head>
                  <body>
                    <video
                      src="${post.img}"
                      controls
                      autoplay
                      ${autoPlayMedia ? '' : 'muted'}
                      playsinline
                      preload="metadata"
                      controlsList="nodownload"
                    ></video>
                  </body>
                </html>
              `
            }}
            style={styles.videoWebView}
            allowsFullscreenVideo={true}
            mediaPlaybackRequiresUserAction={!(disableNavigation && autoPlayMedia)}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            allowsInlineMediaPlayback={true}
            mixedContentMode="always"
            startInLoadingState={true}
            originWhitelist={['*']}
            renderLoading={() => (
              <View style={styles.videoLoading}>
                <ActivityIndicator size="large" color={COLORS.primary} />
              </View>
            )}
            onError={(syntheticEvent) => {
              const { nativeEvent } = syntheticEvent;
              console.error('❌ [Post] WebView video error:', nativeEvent);
            }}
            onHttpError={(syntheticEvent) => {
              const { nativeEvent } = syntheticEvent;
              console.error('❌ [Post] WebView video HTTP error:', nativeEvent);
            }}
          />
          </View>
        ) : (
          // FEED OPTIMIZATION: render a lightweight placeholder instead of mounting WebView in a scrolling list
          <TouchableOpacity onPress={() => navigateToPostDetail(post._id)} activeOpacity={0.9}>
            <View style={styles.videoContainer}>
              <VideoFeedPreview
                videoUrl={post.img}
                serverThumbnail={post.thumbnail}
                placeholderColor={colors.background}
                spinnerColor={colors.primary}
              />
              <View style={styles.youtubeOverlay}>
                <View style={styles.youtubePlayButton}>
                  <Text style={styles.youtubePlayIcon}>▶</Text>
                </View>
                <Text style={styles.youtubeWatchText}>Tap to play</Text>
              </View>
            </View>
          </TouchableOpacity>
        )
      ) : post.img ? (
        disableNavigation ? (
          <Image 
            source={{ uri: post.img }} 
            style={styles.postImage}
            resizeMode="cover"
          />
        ) : (
          <TouchableOpacity 
            onPress={() => {
              // Navigate to PostDetail
              navigateToPostDetail(post._id);
            }}
            activeOpacity={0.9}
          >
            <Image 
              source={{ uri: post.img }} 
              style={styles.postImage}
              resizeMode="cover"
            />
          </TouchableOpacity>
        )
      ) : null}

      {isWeatherPost && (
        <View style={styles.weatherContainer}>
          {weatherLoading && weatherDataArray.length === 0 ? (
            <View style={styles.weatherLoading}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.weatherLoadingText}>Loading weather...</Text>
            </View>
          ) : weatherDataArray.length > 0 ? (
            weatherDataArray.map((weather: any, index: number) => (
              <View key={index} style={[styles.weatherCard, { backgroundColor: colors.cardBg }]}>
                <View style={styles.weatherHeader}>
                  <Text style={[styles.weatherCity, { color: colors.cardText }]}>
                    {weather.city}{weather.country ? `, ${weather.country}` : ''}
                  </Text>
                  <Text style={[styles.weatherTemp, { color: colors.cardText }]}>
                    {Math.round(weather.temperature)}°C
                  </Text>
                </View>
                <Text style={[styles.weatherDesc, { color: colors.cardText }]}>
                  {weather.description || weather.condition}
                </Text>
                <View style={styles.weatherDetails}>
                  <Text style={[styles.weatherDetail, { color: colors.cardText }]}>💧 {weather.humidity}%</Text>
                  <Text style={[styles.weatherDetail, { color: colors.cardText }]}>💨 {weather.windSpeed?.toFixed(1) || 0} m/s</Text>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.weatherEmpty}>
              <Text style={styles.weatherEmptyText}>No weather data available</Text>
              <Text style={styles.weatherEmptySubtext}>Select cities in Weather screen to see updates</Text>
            </View>
          )}
        </View>
      )}

      {isFootballPost && (
        <View style={{ marginBottom: 10 }}>
          {/* Check if we have matches from API fetch or post data */}
          {footballLoading ? (
            <View style={[styles.footballCard, { backgroundColor: colors.cardBg }]}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.footballStatus, { color: colors.cardText, textAlign: 'center', marginTop: 8 }]}>
                Loading matches...
              </Text>
            </View>
          ) : (footballMatches.length > 0 || (post.liveMatches && post.liveMatches.length > 0) || (post.matches && post.matches.length > 0) || (post.todayMatches && post.todayMatches.length > 0)) ? (
            <>
              {(() => {
                const matchesArray = footballMatches.length > 0 ? footballMatches : (post.liveMatches || post.matches || post.todayMatches || []);
                
                // Filter to ONLY show live matches (no upcoming matches in feed)
                const liveMatches = matchesArray.filter((m: any) => {
                  const status = m.fixture?.status?.short || m.fixture?.status?.long || m.status;
                  return status === 'LIVE' || status === 'IN_PLAY' || status === 'PAUSED' || m.fixture?.status?.elapsed !== null;
                });
                
                console.log('⚽ [Post] Rendering LIVE matches only:', {
                  totalMatches: matchesArray.length,
                  liveMatchesCount: liveMatches.length,
                  liveMatches: liveMatches
                });
                
                const hasLive = liveMatches.length > 0;
                
                // If no live matches, show "No matches" message
                if (!hasLive) {
                  return (
                    <View style={[styles.footballCard, { backgroundColor: colors.cardBg }]}>
                      <Text style={[styles.footballTeam, { color: colors.cardText, textAlign: 'center' }]}>
                        ⚽ No live matches right now
                      </Text>
                      <Text style={[styles.footballStatus, { color: colors.cardText, textAlign: 'center', fontSize: 12 }]}>
                        Check back during match hours
                      </Text>
                    </View>
                  );
                }
                
                return (
                  <>
                    <View style={[styles.footballCard, { backgroundColor: colors.error, marginBottom: 8 }]}>
                      <Text style={[styles.footballTeam, { color: '#FFFFFF', fontWeight: 'bold', textAlign: 'center' }]}>
                        🔴 LIVE MATCHES ({liveMatches.length})
                      </Text>
                    </View>
                    {liveMatches.map((match: any, index: number) => {
                      // Handle MongoDB match structure: teams, goals, fixture
                      const homeTeam = match.teams?.home?.name || match.homeTeam?.name || match.homeTeam || 'Home';
                      const awayTeam = match.teams?.away?.name || match.awayTeam?.name || match.awayTeam || 'Away';
                      const homeScore = match.goals?.home ?? match.score?.fullTime?.home ?? match.homeScore ?? 0;
                      const awayScore = match.goals?.away ?? match.score?.fullTime?.away ?? match.awayScore ?? 0;
                      const status = match.fixture?.status?.short || match.fixture?.status?.long || match.status || 'NS';
                      const minute = match.fixture?.status?.elapsed || match.minute || null;
                      const isLive = status === 'LIVE' || status === 'IN_PLAY' || status === 'PAUSED' || match.fixture?.status?.elapsed !== null;
                      
                      return (
                        <View key={index} style={[
                          styles.footballCard, 
                          { 
                            backgroundColor: isLive ? colors.cardBg : colors.backgroundLight, 
                            marginBottom: 8,
                            borderLeftWidth: isLive ? 4 : 0,
                            borderLeftColor: isLive ? colors.error : 'transparent'
                          }
                        ]}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={[styles.footballTeam, { color: colors.cardText, flex: 1 }]}>
                              {homeTeam} vs {awayTeam}
                            </Text>
                            {isLive && <Text style={{ color: colors.error, fontSize: 12, fontWeight: 'bold', marginLeft: 8 }}>● LIVE</Text>}
                          </View>
                          <Text style={[styles.footballScore, { color: colors.cardText, fontSize: 24, fontWeight: 'bold' }]}>
                            {homeScore} - {awayScore}
                          </Text>
                          <Text style={[styles.footballStatus, { color: colors.cardText }]}>
                            {minute ? `${minute}' ` : ''}{status}
                          </Text>
                        </View>
                      );
                    })}
                  </>
                );
              })()}
            </>
          ) : post.footballData ? (
            // Fallback to old single match format
            <View style={[styles.footballCard, { backgroundColor: colors.cardBg }]}>
              <Text style={[styles.footballTeam, { color: colors.cardText }]}>
                {post.footballData.homeTeam} vs {post.footballData.awayTeam}
              </Text>
              <Text style={[styles.footballScore, { color: colors.cardText }]}>
                {post.footballData.homeScore} - {post.footballData.awayScore}
              </Text>
              <Text style={[styles.footballStatus, { color: colors.cardText }]}>{post.footballData.status}</Text>
            </View>
          ) : (
            // No matches available (neither live nor upcoming)
            <View style={[styles.footballCard, { backgroundColor: colors.cardBg }]}>
              <Text style={[styles.footballTeam, { color: colors.cardText, textAlign: 'center' }]}>
                ⚽ No matches available
              </Text>
              <Text style={[styles.footballStatus, { color: colors.cardText, textAlign: 'center', fontSize: 12 }]}>
                Check back later for live updates
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Chess Game Card Display */}
      {isChessPost && chessGameData && (
        <TouchableOpacity
          style={[styles.chessCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={handleChessPostClick}
          activeOpacity={0.8}
        >
          <View style={styles.chessCardHeader}>
            <View style={styles.chessCardTitle}>
              <Text style={styles.chessIcon}>♟️</Text>
              <View>
                <Text style={[styles.chessTitle, { color: colors.cardText }]}>Playing Chess</Text>
                <Text style={[styles.chessSubtitle, { color: colors.cardText, opacity: 0.6 }]}>Tap to watch</Text>
              </View>
            </View>
            {(chessGameData.gameStatus === 'active' || chessGameData.gameStatus == null) ? (
              <View style={[styles.chessLiveBadge, { backgroundColor: colors.error }]}>
                <Text style={styles.chessLiveText}>Live</Text>
              </View>
            ) : (
              <View style={[styles.chessLiveBadge, { backgroundColor: colors.textGray }]}>
                <Text style={styles.chessLiveText}>Ended</Text>
              </View>
            )}
          </View>
          
          <View style={styles.chessPlayers}>
            {/* Player 1 */}
            <View style={styles.chessPlayer}>
              {chessGameData.player1?.profilePic ? (
                <Image
                  source={{ uri: chessGameData.player1.profilePic }}
                  style={styles.chessPlayerAvatar}
                />
              ) : (
                <View style={[styles.chessPlayerAvatar, styles.chessPlayerAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                  <Text style={styles.chessPlayerAvatarText}>
                    {chessGameData.player1?.name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <Text style={[styles.chessPlayerName, { color: colors.cardText }]} numberOfLines={1}>
                {chessGameData.player1?.name || 'Player 1'}
              </Text>
              <Text style={[styles.chessPlayerUsername, { color: colors.cardText, opacity: 0.6 }]} numberOfLines={1}>
                @{chessGameData.player1?.username || 'player1'}
              </Text>
            </View>

            <Text style={[styles.chessVs, { color: colors.cardText }]}>vs</Text>

            {/* Player 2 */}
            <View style={styles.chessPlayer}>
              {chessGameData.player2?.profilePic ? (
                <Image
                  source={{ uri: chessGameData.player2.profilePic }}
                  style={styles.chessPlayerAvatar}
                />
              ) : (
                <View style={[styles.chessPlayerAvatar, styles.chessPlayerAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                  <Text style={styles.chessPlayerAvatarText}>
                    {chessGameData.player2?.name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <Text style={[styles.chessPlayerName, { color: colors.cardText }]} numberOfLines={1}>
                {chessGameData.player2?.name || 'Player 2'}
              </Text>
              <Text style={[styles.chessPlayerUsername, { color: colors.cardText, opacity: 0.6 }]} numberOfLines={1}>
                @{chessGameData.player2?.username || 'player2'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      <View style={styles.footer} pointerEvents="box-none">
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={(e) => {
            e.stopPropagation();
            handleLike();
          }}
          disabled={isLiking}
        >
          <Text style={styles.actionIcon}>
            {isLiked ? '❤️' : '🤍'}
          </Text>
          <Text style={styles.actionText}>{localLikesCount}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.actionButton}
          onPress={(e) => {
            e.stopPropagation();
            if (!disableNavigation) {
              // Navigate to PostDetail
              navigateToPostDetail(post._id);
            }
          }}
        >
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={styles.actionText}>{post.replies?.length || 0}</Text>
        </TouchableOpacity>

      </View>

      <AddContributorModal
        visible={addContribOpen}
        onClose={() => setAddContribOpen(false)}
        post={post}
        onContributorAdded={onCollaborativePostUpdated}
      />
      <ManageContributorsModal
        visible={manageContribOpen}
        onClose={() => setManageContribOpen(false)}
        post={post}
        onContributorRemoved={onCollaborativePostUpdated}
      />
      <EditPostModal
        visible={editPostOpen}
        onClose={() => setEditPostOpen(false)}
        post={post}
        onSaved={(updated) => {
          onCollaborativePostUpdated(updated);
        }}
      />
      <StoryOrProfileSheet
        visible={!!storyMenu}
        onClose={() => setStoryMenu(null)}
        username={storyMenu?.username}
        onSeeStory={() => {
          if (storyMenu?.userId) {
            navigateToMainStack(navigation, 'StoryViewer', { userId: storyMenu.userId });
          }
        }}
        onGoToProfile={
          storyMenu?.username
            ? () =>
                navigation.navigate('Profile', {
                  screen: 'UserProfile',
                  params: { username: storyMenu.username },
                })
            : undefined
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  avatar: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    marginRight: 10,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerInfo: {
    flex: 1,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  collaborativeBadge: {
    marginLeft: 5,
    fontSize: 14,
  },
  contribAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  collabActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  collabActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  contributorsLabel: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  time: {
    fontSize: 14,
    color: COLORS.textGray,
    marginLeft: 5,
  },
  username: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  deleteButton: {
    fontSize: 18,
    padding: 5,
  },
  editButton: {
    fontSize: 18,
    padding: 5,
  },
  text: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 10,
  },
  postImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 10,
  },
  videoContainer: {
    width: '100%',
    height: (Dimensions.get('window').width - 30) * 0.5625, // 16:9 aspect ratio
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  videoWebView: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  youtubeThumbnail: {
    width: '100%',
    height: '100%',
  },
  youtubeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  youtubePlayButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  youtubePlayIcon: {
    fontSize: 32,
    color: '#FFFFFF',
    marginLeft: 4, // Slight offset for play icon
  },
  youtubeWatchText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  videoLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  weatherContainer: {
    marginBottom: 10,
  },
  weatherCard: {
    backgroundColor: COLORS.backgroundLight,
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  weatherHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  weatherCity: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    flex: 1,
  },
  weatherTemp: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  weatherDesc: {
    fontSize: 14,
    color: COLORS.textGray,
    textTransform: 'capitalize',
    marginBottom: 8,
  },
  weatherDetails: {
    flexDirection: 'row',
    gap: 15,
  },
  weatherDetail: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  weatherLoading: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weatherLoadingText: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textGray,
  },
  weatherEmpty: {
    padding: 20,
    alignItems: 'center',
  },
  weatherEmptyText: {
    fontSize: 14,
    color: COLORS.textGray,
    marginBottom: 4,
  },
  weatherEmptySubtext: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  footballCard: {
    backgroundColor: COLORS.backgroundLight,
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  footballTeam: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  footballScore: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  footballStatus: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionIcon: {
    fontSize: 18,
  },
  actionText: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  chessCard: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chessCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  chessCardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chessIcon: {
    fontSize: 32,
  },
  chessTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  chessSubtitle: {
    fontSize: 12,
    color: COLORS.textGray,
    marginTop: 2,
  },
  chessLiveBadge: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  chessLiveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  chessPlayers: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: 16,
  },
  chessPlayer: {
    alignItems: 'center',
    flex: 1,
  },
  chessPlayerAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 8,
  },
  chessPlayerAvatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chessPlayerAvatarText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  chessPlayerName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 2,
  },
  chessPlayerUsername: {
    fontSize: 12,
    color: COLORS.textGray,
    textAlign: 'center',
  },
  chessVs: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
});

export default Post;
