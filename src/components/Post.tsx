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
  const showToast = useShowToast();

  const [isLiking, setIsLiking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [youtubePlaying, setYoutubePlaying] = useState(true);
  // Local state for optimistic like updates (like web)
  const [localLiked, setLocalLiked] = useState(post.likes?.includes(user?._id));
  const [localLikesCount, setLocalLikesCount] = useState(post.likes?.length || 0);

  // Update local state when post prop changes
  useEffect(() => {
    setLocalLiked(post.likes?.includes(user?._id));
    setLocalLikesCount(post.likes?.length || 0);
  }, [post.likes, user?._id]);

  const isLiked = localLiked; // Use local state for immediate UI update
  const isOwner = post.postedBy?._id === user?._id;
  const isContributor = post.contributors?.some((c: any) => 
    (typeof c === 'string' ? c : c._id) === user?._id
  );

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
    <View style={styles.container}>
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
          {post.postedBy?.profilePic && !isChannelPost ? (
            <Image 
              source={{ uri: post.postedBy.profilePic }} 
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
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
          )}
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <View style={styles.headerTop}>
            <Text style={styles.name}>{post.postedBy?.name || 'Unknown'}</Text>
            {post.isCollaborative && (
              <Text style={styles.collaborativeBadge}>👥</Text>
            )}
            <Text style={styles.time}>· {formatTime(post.createdAt)}</Text>
          </View>
          <Text style={styles.username}>@{post.postedBy?.username}</Text>
        </View>

        {isOwner && (
          <TouchableOpacity onPress={handleDelete} disabled={isDeleting}>
            <Text style={styles.deleteButton}>🗑️</Text>
          </TouchableOpacity>
        )}
      </View>

      {disableNavigation ? (
        <Text style={styles.text}>{post.text}</Text>
      ) : (
        <TouchableOpacity 
          onPress={() => {
            // Navigate to PostDetail
            navigateToPostDetail(post._id);
          }}
          activeOpacity={0.9}
        >
          <Text style={styles.text}>{post.text}</Text>
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
          <TouchableOpacity 
            onPress={() => {
              // Navigate to PostDetail
              navigateToPostDetail(post._id);
            }}
            activeOpacity={0.9}
          >
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
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                      * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
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
                      }
                      video {
                        width: 100%;
                        height: 100%;
                        max-height: 400px;
                        object-fit: contain;
                      }
                    </style>
                  </head>
                  <body>
                    <video
                      src="${post.img}"
                      controls
                      autoplay
                      muted
                      playsinline
                      loop
                      onloadeddata="this.play().catch(e => console.log('Autoplay prevented:', e))"
                    ></video>
                  </body>
                </html>
              `
            }}
            style={styles.videoWebView}
            allowsFullscreenVideo={true}
            mediaPlaybackRequiresUserAction={false}
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
          <TouchableOpacity 
            onPress={() => {
              // Navigate to PostDetail
              navigateToPostDetail(post._id);
            }}
            activeOpacity={0.9}
          >
            <View style={styles.videoContainer}>
              <WebView
                source={{
                  html: `
                    <!DOCTYPE html>
                    <html>
                      <head>
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <style>
                          * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
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
                          }
                          video {
                            width: 100%;
                            height: 100%;
                            max-height: 400px;
                            object-fit: contain;
                          }
                        </style>
                      </head>
                      <body>
                        <video
                          src="${post.img}"
                          controls
                          autoplay
                          muted
                          playsinline
                          loop
                          onloadeddata="this.play().catch(e => console.log('Autoplay prevented:', e))"
                        ></video>
                      </body>
                    </html>
                  `
                }}
                style={styles.videoWebView}
                allowsFullscreenVideo={true}
                mediaPlaybackRequiresUserAction={false}
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

      {post.isWeatherPost && post.weatherData && (
        <View style={styles.weatherCard}>
          <Text style={styles.weatherCity}>{post.weatherData.city}</Text>
          <Text style={styles.weatherTemp}>
            {Math.round(post.weatherData.temperature)}°C
          </Text>
          <Text style={styles.weatherDesc}>{post.weatherData.description}</Text>
        </View>
      )}

      {post.isFootballPost && post.footballData && (
        <View style={styles.footballCard}>
          <Text style={styles.footballTeam}>
            {post.footballData.homeTeam} vs {post.footballData.awayTeam}
          </Text>
          <Text style={styles.footballScore}>
            {post.footballData.homeScore} - {post.footballData.awayScore}
          </Text>
          <Text style={styles.footballStatus}>{post.footballData.status}</Text>
        </View>
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
  weatherCard: {
    backgroundColor: COLORS.backgroundLight,
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  weatherCity: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  weatherTemp: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  weatherDesc: {
    fontSize: 14,
    color: COLORS.textGray,
    textTransform: 'capitalize',
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
});

export default Post;
