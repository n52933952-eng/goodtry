import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { WebView } from 'react-native-webview';
import YoutubePlayer from 'react-native-youtube-iframe';
import { useNavigation } from '@react-navigation/native';
import { useUser } from '../context/UserContext';
import { usePost } from '../context/PostContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS, COLORS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';

interface PostProps {
  post: any;
  disableNavigation?: boolean; // If true, disable navigation to PostDetail (for PostDetailScreen)
  fromScreen?: string; // Screen name where Post is rendered (e.g., 'UserProfile')
  userProfileParams?: any; // Params to pass when navigating back to UserProfile
}

const Post: React.FC<PostProps> = ({ post, disableNavigation = false, fromScreen, userProfileParams }) => {
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
  const { likePost, unlikePost, deletePost: deletePostContext } = usePost();
  const { colors } = useTheme();
  const showToast = useShowToast();

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

  // Chess game post state
  const isChessPost = !!post?.chessGameData;
  const [chessGameData, setChessGameData] = useState<any>(null);
  
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

  // Check if post has YouTube embed
  const isYouTubeEmbed = post.img && (
    post.img.includes('youtube.com/embed') || 
    post.img.includes('youtu.be')
  );
  
  // Check if this is a channel post (system account with YouTube embed or channel post)
  const channelUsernames = ['Football', 'AlJazeera', 'NBCNews', 'BeinSportsNews', 'SkyNews', 'Cartoonito', 
    'NatGeoKids', 'SciShowKids', 'JJAnimalTime', 'KidsArabic', 'NatGeoAnimals', 'MBCDrama', 'Fox11'];
  const isChannelPost = isYouTubeEmbed || !!post?.channelAddedBy || 
    channelUsernames.includes(post.postedBy?.username);
  
  // Debug log for channel detection
  if (isYouTubeEmbed) {
    console.log('📺 [Post] Detected as channel post (YouTube embed):', post.postedBy?.username);
  }
  
  // Extract YouTube video ID from embed URL
  const getYouTubeVideoId = (embedUrl: string) => {
    if (!embedUrl) return '';
    // Extract video ID from embed URL: https://www.youtube.com/embed/VIDEO_ID?autoplay=1&mute=0
    const embedMatch = embedUrl.match(/youtube\.com\/embed\/([^?&]+)/);
    if (embedMatch) {
      return embedMatch[1];
    }
    // Extract from youtu.be: https://youtu.be/VIDEO_ID
    const shortMatch = embedUrl.match(/youtu\.be\/([^?&]+)/);
    if (shortMatch) {
      return shortMatch[1];
    }
    return '';
  };
  
  const youtubeVideoId = isYouTubeEmbed ? getYouTubeVideoId(post.img) : '';
  
  // Check if post has regular video (mp4, webm, etc.)
  const isVideoPost = post.img && (
    post.img.match(/\.(mp4|webm|ogg|mov)$/i) || 
    post.img.includes('/video/upload/')
  );

  const { width } = Dimensions.get('window');
  const videoHeight = (width - 30) * 0.5625; // 16:9 aspect ratio

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            // If navigation is disabled (PostDetailScreen), don't navigate
            if (disableNavigation) return;
            
            // If this is a channel post, navigate to post page
            const username = post.postedBy?.username;
            const hasChannelAddedBy = !!post?.channelAddedBy;
            const hasYouTubeEmbed = !!isYouTubeEmbed;
            const isInChannelList = channelUsernames.includes(username);
            const isChannelPost = isYouTubeEmbed || hasChannelAddedBy || isInChannelList;
            
            if (isChannelPost && post?._id) {
              console.log('📺 [Post] Channel post - navigating to PostDetail:', post._id);
              navigateToPostDetail(post._id);
            } else if (username) {
              // For regular users, navigate to their profile page
              console.log('👤 [Post] User post - navigating to UserProfile:', username);
              navigation.navigate('Profile', { 
                screen: 'UserProfile', 
                params: { username } 
              });
            }
          }}
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

        <View style={styles.headerInfo}>
          <View style={styles.headerTop}>
            <Text style={[styles.name, { color: colors.text }]}>{post.postedBy?.name || 'Unknown'}</Text>
            {post.isCollaborative && (
              <Text style={styles.collaborativeBadge}>👥</Text>
            )}
            <Text style={[styles.time, { color: colors.textGray }]}>· {formatTime(post.createdAt)}</Text>
          </View>
          <Text style={[styles.username, { color: colors.textGray }]}>@{post.postedBy?.username}</Text>
        </View>

        {isOwner && (
          <TouchableOpacity onPress={handleDelete} disabled={isDeleting}>
            <Text style={styles.deleteButton}>🗑️</Text>
          </TouchableOpacity>
        )}
      </View>

      {disableNavigation ? (
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
      )}

      {post.img && isYouTubeEmbed && youtubeVideoId ? (
        disableNavigation ? (
          <View 
            style={styles.videoContainer}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => false}
          >
            <YoutubePlayer
            height={styles.videoContainer.height}
            videoId={youtubeVideoId}
            play={youtubePlaying}
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
            onError={(error) => {
              console.error('❌ [Post] YouTube player error:', error);
            }}
            onReady={() => {
              console.log('✅ [Post] YouTube player ready - auto-playing');
              setYoutubePlaying(true);
            }}
            onChangeState={(state) => {
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
            mediaPlaybackRequiresUserAction={true}
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
              {/* Show thumbnail if available (for channels or posts with thumbnail) */}
              {post.thumbnail ? (
                <Image
                  source={{ uri: post.thumbnail }}
                  style={styles.videoThumbnail}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.videoContainer, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }]}>
                  <Text style={{ fontSize: 42, color: '#FFFFFF' }}>▶</Text>
                  <Text style={{ color: COLORS.textGray, marginTop: 8 }}>Tap to play</Text>
                </View>
              )}
              {/* Always show play button overlay */}
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

      {post.isFootballPost && (
        <View style={{ marginBottom: 10 }}>
          {/* Debug: Log football post data */}
          {console.log('⚽ [Post] Football post data:', { 
            hasLiveMatches: !!post.liveMatches, 
            liveMatchesLength: post.liveMatches?.length,
            hasMatches: !!post.matches,
            matchesLength: post.matches?.length,
            hasTodayMatches: !!post.todayMatches,
            todayMatchesLength: post.todayMatches?.length,
            hasFootballData: !!post.footballData,
            allKeys: Object.keys(post),
            text: post.text?.substring(0, 100)
          })}
          {/* Check if we have liveMatches array (new format) */}
          {(post.liveMatches && post.liveMatches.length > 0) || (post.matches && post.matches.length > 0) || (post.todayMatches && post.todayMatches.length > 0) ? (
            <>
              {(() => {
                const matchesArray = post.liveMatches || post.matches || post.todayMatches || [];
                const liveMatches = matchesArray.filter((m: any) => m.status === 'IN_PLAY' || m.status === 'LIVE' || m.status === 'PAUSED');
                const hasLive = liveMatches.length > 0;
                
                return (
                  <>
                    {hasLive && (
                      <View style={[styles.footballCard, { backgroundColor: colors.error, marginBottom: 8 }]}>
                        <Text style={[styles.footballTeam, { color: '#FFFFFF', fontWeight: 'bold', textAlign: 'center' }]}>
                          🔴 LIVE MATCHES ({liveMatches.length})
                        </Text>
                      </View>
                    )}
                    {matchesArray.map((match: any, index: number) => {
                      const isLive = match.status === 'IN_PLAY' || match.status === 'LIVE' || match.status === 'PAUSED';
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
                              {match.homeTeam?.name || match.homeTeam} vs {match.awayTeam?.name || match.awayTeam}
                            </Text>
                            {isLive && <Text style={{ color: colors.error, fontSize: 12, fontWeight: 'bold', marginLeft: 8 }}>● LIVE</Text>}
                          </View>
                          <Text style={[styles.footballScore, { color: colors.cardText, fontSize: 24, fontWeight: 'bold' }]}>
                            {match.homeScore !== undefined ? match.homeScore : match.score?.fullTime?.home || 0} - {match.awayScore !== undefined ? match.awayScore : match.score?.fullTime?.away || 0}
                          </Text>
                          <Text style={[styles.footballStatus, { color: colors.cardText }]}>
                            {match.minute ? `${match.minute}' ` : ''}{match.status}
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
            // No matches available
            <View style={[styles.footballCard, { backgroundColor: colors.cardBg }]}>
              <Text style={[styles.footballTeam, { color: colors.cardText, textAlign: 'center' }]}>
                No live matches right now
              </Text>
              <Text style={[styles.footballStatus, { color: colors.cardText, textAlign: 'center', fontSize: 12 }]}>
                Check back during match hours
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
            <View style={[styles.chessLiveBadge, { backgroundColor: colors.error }]}>
              <Text style={styles.chessLiveText}>Live</Text>
            </View>
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

        <TouchableOpacity 
          style={styles.actionButton}
          onPress={(e) => {
            e.stopPropagation();
          }}
        >
          <Text style={styles.actionIcon}>🔄</Text>
        </TouchableOpacity>
      </View>
      
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
  name: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  collaborativeBadge: {
    marginLeft: 5,
    fontSize: 14,
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
  videoThumbnail: {
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
