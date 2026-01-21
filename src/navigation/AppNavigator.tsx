import React, { useRef, useEffect, useState } from 'react';
import { View, Text, DeviceEventEmitter, Platform, AppState, TouchableOpacity } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useUser } from '../context/UserContext';
import { useWebRTC } from '../context/WebRTCContext';
import { COLORS } from '../utils/constants';
import fcmService from '../services/fcmService';
import oneSignalService from '../services/onesignal';
import { getPendingCallData, clearCallData } from '../services/callData';
import { getPendingOneSignalAction, clearOneSignalAction } from '../services/onesignalActionData';

// Auth Screens
import LoginScreen from '../screens/Auth/LoginScreen';
import SignupScreen from '../screens/Auth/SignupScreen';

// Main Screens
import FeedScreen from '../screens/Home/FeedScreen';
import CreatePostScreen from '../screens/Post/CreatePostScreen';
import PostDetailScreen from '../screens/Post/PostDetailScreen';
import UserProfileScreen from '../screens/Profile/UserProfileScreen';
import UpdateProfileScreen from '../screens/Profile/UpdateProfileScreen';
import SearchScreen from '../screens/Search/SearchScreen';
import NotificationsScreen from '../screens/Notifications/NotificationsScreen';
import WeatherScreen from '../screens/Weather/WeatherScreen';
import FootballScreen from '../screens/Football/FootballScreen';
import MessagesScreen from '../screens/Messages/MessagesScreen';
import ChatScreen from '../screens/Messages/ChatScreen';
import CallScreen from '../screens/Call/CallScreen';
import ChessScreen from '../screens/Chess/ChessScreen';
import ChessGameScreen from '../screens/Chess/ChessGameScreen';
import ChessChallengeNotification from '../components/ChessChallengeNotification';
import ActivityScreen from '../screens/Activity/ActivityScreen';
import { useSocket } from '../context/SocketContext';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Auth Stack
const AuthStack = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
      cardStyle: { backgroundColor: COLORS.background },
    }}
  >
    <Stack.Screen name="Login" component={LoginScreen} />
    <Stack.Screen name="Signup" component={SignupScreen} />
  </Stack.Navigator>
);

// Feed Stack (nested stack for Feed tab to include PostDetail)
const FeedStack = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
    }}
  >
    <Stack.Screen name="FeedScreen" component={FeedScreen} />
    <Stack.Screen 
      name="PostDetail" 
      component={PostDetailScreen}
      options={{
        headerShown: true,
        title: 'Post',
        headerStyle: {
          backgroundColor: COLORS.background,
        },
        headerTintColor: COLORS.text,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    />
  </Stack.Navigator>
);

// Main Tab Navigator (after login)
const MainTabs = () => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarShowLabel: false, // Remove text labels below icons
      tabBarStyle: {
        backgroundColor: COLORS.backgroundLight,
        borderTopColor: COLORS.border,
        borderTopWidth: 1,
        height: 60,
        paddingBottom: 0,
        paddingTop: 0,
        paddingHorizontal: 0,
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      tabBarActiveTintColor: COLORS.primary,
      tabBarInactiveTintColor: COLORS.textGray,
      tabBarIconStyle: {
        width: 28,
        height: 28,
      },
      tabBarItemStyle: {
        justifyContent: 'center',
        alignItems: 'center',
        flex: 1,
        paddingVertical: 0,
      },
    }}
    tabBar={(props) => {
      // Filter out hidden tabs (routes with tabBarButton: () => null)
      const visibleRoutes = props.state.routes.filter((route) => {
        const { options } = props.descriptors[route.key];
        return options.tabBarButton === undefined;
      });

      return (
        <View style={{
          flexDirection: 'row',
          backgroundColor: COLORS.backgroundLight,
          borderTopWidth: 1,
          borderTopColor: COLORS.border,
          height: 60,
          width: '100%',
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
        }}>
          {visibleRoutes.map((route) => {
            const { options } = props.descriptors[route.key];
            const routeIndex = props.state.routes.findIndex(r => r.key === route.key);
            const isFocused = props.state.index === routeIndex;
            const color = isFocused ? COLORS.primary : COLORS.textGray;

            const onPress = () => {
              const event = props.navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                props.navigation.navigate(route.name);
              }
            };

            const Icon = options.tabBarIcon;
            
            return (
              <View
                key={route.key}
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: 60,
                  width: '100%',
                }}
                onTouchEnd={onPress}
              >
                {Icon && <Icon color={color} />}
              </View>
            );
          })}
        </View>
      );
    }}
  >
    <Tab.Screen
      name="Feed"
      component={FeedStack}
      options={{
        tabBarLabel: 'Home',
        tabBarIcon: ({ color }) => <HomeIcon color={color} />,
      }}
    />
    <Tab.Screen
      name="Search"
      component={SearchScreen}
      options={{
        tabBarLabel: 'Search',
        tabBarIcon: ({ color }) => <SearchIcon color={color} />,
      }}
    />
    <Tab.Screen
      name="Profile"
      component={ProfileStack}
      initialParams={{ screen: 'UserProfile', params: { username: 'self' } }}
      options={{
        tabBarLabel: 'Profile',
        tabBarIcon: ({ color }) => <ProfileIcon color={color} />,
      }}
    />
    <Tab.Screen
      name="Messages"
      component={MessagesScreen}
      options={{
        tabBarLabel: 'Messages',
        tabBarIcon: ({ color }) => <MessagesIcon color={color} />,
      }}
    />
    {/* Hidden tabs */}
    <Tab.Screen
      name="Notifications"
      component={NotificationsScreen}
      options={{ tabBarButton: () => null }}
    />
    <Tab.Screen
      name="Chess"
      component={ChessScreen}
      options={{ tabBarButton: () => null }}
    />
    <Tab.Screen
      name="Weather"
      component={WeatherScreen}
      options={{ tabBarButton: () => null }}
    />
    <Tab.Screen
      name="Football"
      component={FootballScreen}
      options={{ tabBarButton: () => null }}
    />
  </Tab.Navigator>
);

// Profile Stack (nested stack for Profile tab to include UserProfile and PostDetail)
const ProfileStack = ({ navigation: stackNavigation }: any) => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen 
        name="UserProfile" 
        component={UserProfileScreen}
        options={({ navigation }) => ({
          headerShown: true,
          title: 'Profile',
          headerStyle: {
            backgroundColor: COLORS.background,
          },
          headerTintColor: COLORS.text,
          headerTitleStyle: {
            fontWeight: 'bold',
          },
          headerLeft: () => (
            <TouchableOpacity 
              onPress={() => {
                // Navigate to Feed (home) tab
                const rootNavigation = navigation.getParent()?.getParent();
                if (rootNavigation) {
                  rootNavigation.navigate('MainTabs', { screen: 'Feed' });
                } else {
                  navigation.navigate('Feed');
                }
              }} 
              style={{ marginLeft: 10 }}
            >
              <Text style={{ color: COLORS.text, fontSize: 24 }}>←</Text>
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen 
        name="PostDetail" 
        component={PostDetailScreen}
        options={{
          headerShown: true,
          title: 'Post',
          headerStyle: {
            backgroundColor: COLORS.background,
          },
          headerTintColor: COLORS.text,
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      />
      <Stack.Screen 
        name="UpdateProfile" 
        component={UpdateProfileScreen}
        options={{
          headerShown: false,
        }}
      />
    </Stack.Navigator>
  );
};

// Main Stack with Tabs and Modals
const MainStack = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
      presentation: 'card',
    }}
  >
    <Stack.Screen name="MainTabs" component={MainTabs} />
    <Stack.Screen 
      name="CreatePost" 
      component={CreatePostScreen}
      options={{ presentation: 'modal' }}
    />
    <Stack.Screen name="Activity" component={ActivityScreen} />
    <Stack.Screen name="ChatScreen" component={ChatScreen} />
    <Stack.Screen 
      name="CallScreen" 
      component={CallScreen}
      options={{
        headerShown: false,
        presentation: 'fullScreenModal',
      }}
    />
    <Stack.Screen name="ChessGame" component={ChessGameScreen} />
  </Stack.Navigator>
);

// Simple Icon Components
const HomeIcon = ({ color }: { color: string }) => (
  <Text style={{ fontSize: 24, color }}>🏠</Text>
);

const SearchIcon = ({ color }: { color: string }) => (
  <Text style={{ fontSize: 24, color }}>🔍</Text>
);

const ProfileIcon = ({ color }: { color: string }) => (
  <Text style={{ fontSize: 24, color }}>👤</Text>
);

const MessagesIcon = ({ color }: { color: string }) => (
  <Text style={{ fontSize: 24, color }}>💬</Text>
);

// Main App Navigator
const AppNavigator = () => {
  const { user, isLoading } = useUser();
  const { call, pendingCancel } = useWebRTC();
  const { chessChallenge, clearChessChallenge, socket } = useSocket();
  const navigationRef = useRef<any>(null);
  const pendingNavigationEvent = useRef<any>(null); // Store NavigateToCallScreen event if received before navigation ref is ready

  // State to track pending cancel from SharedPreferences (checked on mount)
  const [hasPendingCancelFromPrefs, setHasPendingCancelFromPrefs] = useState(false);
  const [isInitialMount, setIsInitialMount] = useState(true);

  // Check SharedPreferences for pending cancel on mount and when call state changes
  useEffect(() => {
    const checkPendingCancel = async () => {
      try {
        const pendingData = await getPendingCallData();
        const hasCancel = !!(pendingData?.hasPendingCancel || pendingData?.shouldCancelCall);
        setHasPendingCancelFromPrefs(hasCancel);
        if (hasCancel) {
          console.log('⏸️ [AppNavigator] Pending cancel detected in SharedPreferences - will prevent navigation');
        }
      } catch (error) {
        console.error('[AppNavigator] Error checking pending cancel:', error);
        setHasPendingCancelFromPrefs(false);
      }
    };
    
    // Check immediately when component mounts (CRITICAL - before any navigation)
    if (isInitialMount) {
      console.log('🔍 [AppNavigator] Initial mount - checking for pending cancel...');
      checkPendingCancel().then(() => {
        setIsInitialMount(false);
      });
    } else {
      // Re-check when call state changes
      checkPendingCancel();
    }
  }, [call.isReceivingCall, isInitialMount]); // Re-check when call state changes

  // Navigate to CallScreen when receiving an incoming call from socket
  // BUT: Don't navigate if there's a pending NavigateToCallScreen event (from MainActivity with shouldAutoAnswer)
  useEffect(() => {
    // CRITICAL: Check BOTH pendingCancel state AND SharedPreferences
    // This prevents navigation when Decline button is pressed and MainActivity launches
    if (pendingCancel || hasPendingCancelFromPrefs) {
      console.log('⏸️ [AppNavigator] Skipping navigation - cancel is in progress', {
        pendingCancel,
        hasPendingCancelFromPrefs
      });
      return;
    }
    
    // Only navigate if call.isReceivingCall is true (if it's false, CancelCallFromNotification cleared it)
    if (call.isReceivingCall && call.from && call.name && navigationRef.current) {
      // If there's a pending NavigateToCallScreen event (from MainActivity), don't navigate from socket
      // The MainActivity event will handle navigation with shouldAutoAnswer=true
      if (pendingNavigationEvent.current) {
        console.log('⏸️ [AppNavigator] Skipping socket navigation - pending NavigateToCallScreen event will handle it');
        return;
      }
      
      // Check if we're already on CallScreen (to avoid duplicate navigation)
      const currentRoute = navigationRef.current.getCurrentRoute();
      if (currentRoute?.name === 'CallScreen') {
        console.log('⏸️ [AppNavigator] Already on CallScreen - skipping navigation');
        return;
      }
      
      console.log('📞 [AppNavigator] Incoming call detected from socket, navigating to CallScreen...');
      console.log('📞 [AppNavigator] Caller:', call.name, '(', call.from, ')');
      console.log('📞 [AppNavigator] Call type:', call.callType);
      
      // Navigate to CallScreen for incoming call from socket (normal flow)
      navigationRef.current.navigate('CallScreen', {
        userName: call.name,
        userId: call.from,
        callType: call.callType || 'video',
        isFromNotification: false, // This is from socket, not push notification
        shouldAutoAnswer: false, // User needs to manually answer
      });
      console.log('✅ [AppNavigator] Navigated to CallScreen for incoming call (from socket)');
    }
  }, [call.isReceivingCall, call.from, call.name, call.callType, pendingCancel, hasPendingCancelFromPrefs]);

  // Set up navigation refs for FCM and OneSignal when navigation is ready
  useEffect(() => {
    if (navigationRef.current) {
      console.log('✅ [AppNavigator] Setting up navigation refs...');
      
      // Set OneSignal navigation ref for notification navigation
      oneSignalService.setNavigationRef(navigationRef.current);
      
      // Process pending NavigateToCallScreen event if any
      if (pendingNavigationEvent.current) {
        console.log('📞 [AppNavigator] Processing pending NavigateToCallScreen event...');
        const data = pendingNavigationEvent.current;
        navigationRef.current.navigate('CallScreen', {
          userName: data.callerName,
          userId: data.callerId,
          callType: data.callType,
          isFromNotification: data.isFromNotification !== false,
          shouldAutoAnswer: data.shouldAutoAnswer === true,
          shouldDecline: data.shouldDecline || false,
        });
        console.log('✅ [AppNavigator] Processed pending navigation to CallScreen');
        pendingNavigationEvent.current = null;
      }
      
      // Check SharedPreferences for pending call data (backup when intent doesn't reach MainActivity)
      if (user) {
        getPendingCallData().then((callData) => {
          if (callData && callData.hasPendingCall && navigationRef.current) {
            console.log('📞 [AppNavigator] Found pending call in SharedPreferences:', callData);
            console.log('📞 [AppNavigator] Navigating to CallScreen from SharedPreferences...');
            
            navigationRef.current.navigate('CallScreen', {
              userName: callData.callerName,
              userId: callData.callerId,
              callType: callData.callType || 'audio',
              isFromNotification: true,
              shouldAutoAnswer: callData.shouldAutoAnswer === true,
            });
            
            // Clear SharedPreferences after reading
            clearCallData();
            console.log('✅ [AppNavigator] Navigated to CallScreen from SharedPreferences');
          }
        }).catch((error) => {
          console.error('[AppNavigator] Error checking SharedPreferences:', error);
        });

        // Check SharedPreferences for pending OneSignal action button clicks
        getPendingOneSignalAction().then((actionData) => {
          if (actionData && navigationRef.current) {
            console.log('🔘 [AppNavigator] Found pending OneSignal action in SharedPreferences:', actionData);
            
            // Handle action based on type
            if (actionData.action === 'com.compnay.ONESIGNAL_VIEW_POST' && actionData.postId) {
              console.log('🔘 [AppNavigator] Navigating to PostDetail from OneSignal action');
              navigationRef.current.navigate('Feed', {
                screen: 'PostDetail',
                params: { postId: actionData.postId }
              });
            } else if (actionData.action === 'com.compnay.ONESIGNAL_VIEW_PROFILE' && actionData.userId) {
              console.log('🔘 [AppNavigator] Navigating to UserProfile from OneSignal action');
              navigationRef.current.navigate('Profile', {
                screen: 'UserProfile',
                params: { userId: actionData.userId }
              });
            } else if (actionData.action === 'com.compnay.ONESIGNAL_MARK_READ') {
              console.log('🔘 [AppNavigator] Mark as read action - handled by OneSignal service');
              // OneSignal service will handle mark as read via API
            }
            
            // Clear SharedPreferences after reading
            clearOneSignalAction();
            console.log('✅ [AppNavigator] Processed OneSignal action from SharedPreferences');
          }
        }).catch((error) => {
          console.error('[AppNavigator] Error checking OneSignal action SharedPreferences:', error);
        });
      }
      
      if (user) {
        // Native IncomingCallActivity handles answer/decline from notification
        // When user presses Answer, MainActivity receives shouldAutoAnswer=true
        // MainActivity emits NavigateToCallScreen event which this listener handles
        console.log('✅ [AppNavigator] Native IncomingCallActivity will handle call notifications');
      }
    }
  }, [navigationRef.current, user]);

  // Listen for navigation events from native code (e.g., from IncomingCallActivity via MainActivity)
  useEffect(() => {
    if (Platform.OS === 'android') {
      console.log('📞 [AppNavigator] Setting up NavigateToCallScreen listener...');
      
      const listener = DeviceEventEmitter.addListener('NavigateToCallScreen', (data: any) => {
        console.log('📞 [AppNavigator] ========== NavigateToCallScreen EVENT RECEIVED ==========');
        console.log('📞 [AppNavigator] Event data:', JSON.stringify(data));
        console.log('📞 [AppNavigator] Navigation ref available:', !!navigationRef.current);
        console.log('📞 [AppNavigator] Should auto-answer:', data?.shouldAutoAnswer);
        
        if (navigationRef.current && data) {
          // Check if we're already on CallScreen
          const currentRoute = navigationRef.current.getCurrentRoute();
          const isAlreadyOnCallScreen = currentRoute?.name === 'CallScreen';
          
          if (isAlreadyOnCallScreen && data.shouldAutoAnswer === true) {
            // If already on CallScreen and shouldAutoAnswer=true, we need to trigger auto-answer
            // This can happen if socket event navigated first
            console.log('⚠️ [AppNavigator] Already on CallScreen - triggering auto-answer via WebRTCContext');
            // The route params won't update, so we'll rely on WebRTCContext's shouldAutoAnswerRef
            // We can emit a CallAnswered event or just navigate with replace
            navigationRef.current.navigate('CallScreen', {
              userName: data.callerName,
              userId: data.callerId,
              callType: data.callType,
              isFromNotification: data.isFromNotification !== false,
              shouldAutoAnswer: true, // Force shouldAutoAnswer=true
              shouldDecline: data.shouldDecline || false,
            });
            console.log('✅ [AppNavigator] Updated CallScreen route params with shouldAutoAnswer=true');
          } else {
            // Navigate immediately to CallScreen
            // If shouldAutoAnswer is true, CallScreen will auto-answer
            console.log('📞 [AppNavigator] Navigating to CallScreen with params:', {
              userName: data.callerName,
              userId: data.callerId,
              callType: data.callType,
              isFromNotification: data.isFromNotification !== false,
              shouldAutoAnswer: data.shouldAutoAnswer === true,
            });
            
            navigationRef.current.navigate('CallScreen', {
              userName: data.callerName,
              userId: data.callerId,
              callType: data.callType,
              isFromNotification: data.isFromNotification !== false, // Default to true
              shouldAutoAnswer: data.shouldAutoAnswer === true, // Only true if explicitly set
              shouldDecline: data.shouldDecline || false,
            });
            console.log('✅ [AppNavigator] Navigated to CallScreen - shouldAutoAnswer:', data.shouldAutoAnswer === true);
          }
        } else {
          console.warn('⚠️ [AppNavigator] Navigation ref or data not available');
          console.warn('⚠️ [AppNavigator] Navigation ref:', !!navigationRef.current);
          console.warn('⚠️ [AppNavigator] Data:', !!data, data);
          
          // Store event for later if navigation ref not ready
          if (!navigationRef.current && data) {
            console.log('📋 [AppNavigator] Navigation ref not ready - storing event for later');
            pendingNavigationEvent.current = data;
            
            // Also retry after a short delay
            setTimeout(() => {
              if (navigationRef.current && pendingNavigationEvent.current) {
                console.log('📞 [AppNavigator] Retry - Navigating to CallScreen...');
                const storedData = pendingNavigationEvent.current;
                navigationRef.current.navigate('CallScreen', {
                  userName: storedData.callerName,
                  userId: storedData.callerId,
                  callType: storedData.callType,
                  isFromNotification: storedData.isFromNotification !== false,
                  shouldAutoAnswer: storedData.shouldAutoAnswer === true,
                  shouldDecline: storedData.shouldDecline || false,
                });
                console.log('✅ [AppNavigator] Retry - Navigated to CallScreen');
                pendingNavigationEvent.current = null;
              }
            }, 500);
          }
        }
      });

      console.log('✅ [AppNavigator] NavigateToCallScreen listener set up');

      return () => {
        listener.remove();
      };
    }
  }, []);

  // Poll SharedPreferences for pending call data while app is active
  // This catches cases where Answer button is pressed but MainActivity launch is blocked
  useEffect(() => {
    if (!user || Platform.OS !== 'android' || !navigationRef.current) return;

    let pollInterval: NodeJS.Timeout | null = null;
    let stopTimeout: NodeJS.Timeout | null = null;

    const checkPendingCall = () => {
      if (!navigationRef.current) return;
      
      getPendingCallData()
        .then((callData) => {
          if (callData && callData.hasPendingCall && navigationRef.current) {
            console.log('📞 [AppNavigator] Found pending call in SharedPreferences (polling):', callData);
            
            // Check if already on CallScreen
            const currentRoute = navigationRef.current.getCurrentRoute();
            if (currentRoute?.name === 'CallScreen') {
              console.log('⏸️ [AppNavigator] Already on CallScreen - clearing SharedPreferences');
              clearCallData();
              if (pollInterval) clearInterval(pollInterval);
              return;
            }

            navigationRef.current.navigate('CallScreen', {
              userName: callData.callerName,
              userId: callData.callerId,
              callType: callData.callType || 'audio',
              isFromNotification: true,
              shouldAutoAnswer: callData.shouldAutoAnswer === true,
            });

            clearCallData();
            console.log('✅ [AppNavigator] Navigated to CallScreen from SharedPreferences (polling)');
            
            // Stop polling once we found and processed the call
            if (pollInterval) clearInterval(pollInterval);
          }
        })
        .catch((error) => {
          console.error('[AppNavigator] Error checking SharedPreferences (polling):', error);
        });
    };

    // Check immediately once
    checkPendingCall();

    // Then poll while app is active, but stop after a short window to reduce overhead.
    // Rationale: this is a reliability fallback; normal flow is via native event + SharedPrefs read on mount.
    pollInterval = setInterval(() => {
      if (AppState.currentState === 'active' && navigationRef.current) {
        checkPendingCall();
      }
    }, 5000);

    // Stop polling after 60 seconds (battery/CPU friendly)
    stopTimeout = setTimeout(() => {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = null;
    }, 60000);

    // Also check on AppState change
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && navigationRef.current) {
        checkPendingCall();
      }
    });

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (stopTimeout) clearTimeout(stopTimeout);
      subscription.remove();
    };
  }, [user, navigationRef.current]);

  if (isLoading) {
    return null; // You can add a splash screen here
  }

  const navTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: COLORS.background,
      card: COLORS.background,
      border: COLORS.border,
      text: COLORS.text,
    },
  };

  return (
    <NavigationContainer 
      theme={navTheme}
      ref={(ref) => {
        navigationRef.current = ref;
        // Set OneSignal navigation ref immediately when NavigationContainer is ready
        if (ref) {
          console.log('✅ [AppNavigator] NavigationContainer ref ready - setting OneSignal ref');
          oneSignalService.setNavigationRef(ref);
        }
      }}
    >
      <View style={{ flex: 1 }}>
        {user ? <MainStack /> : <AuthStack />}
        {user && (
          <ChessChallengeNotification
            visible={!!chessChallenge?.isReceivingChallenge}
            challengerName={chessChallenge?.fromName}
            challengerUsername={chessChallenge?.fromUsername}
            challengerProfilePic={chessChallenge?.fromProfilePic}
            onDecline={() => {
              try {
                if (socket && user?._id && chessChallenge?.from) {
                  socket.emit('declineChessChallenge', {
                    from: user._id,
                    to: chessChallenge.from,
                  });
                }
              } finally {
                clearChessChallenge();
              }
            }}
            onAccept={() => {
              try {
                if (!socket || !user?._id || !chessChallenge?.from) {
                  clearChessChallenge();
                  return;
                }

                const roomId = `chess_${chessChallenge.from}_${user._id}_${Date.now()}`;

                // Navigate first (like web), then emit accept
                navigationRef.current?.navigate('ChessGame', {
                  roomId,
                  color: 'black', // receiver/accepter is black (backend uses from=accepter)
                  opponentId: chessChallenge.from,
                });

                setTimeout(() => {
                  socket.emit('acceptChessChallenge', {
                    from: user._id, // accepter
                    to: chessChallenge.from, // challenger
                    roomId,
                  });
                }, 100);
              } finally {
                clearChessChallenge();
              }
            }}
          />
        )}
      </View>
    </NavigationContainer>
  );
};

export default AppNavigator;
