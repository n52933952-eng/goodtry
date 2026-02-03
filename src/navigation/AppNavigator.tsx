import React, { useRef, useEffect, useState } from 'react';
import { View, Text, DeviceEventEmitter, Platform, AppState, TouchableOpacity } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useUser } from '../context/UserContext';
import { useWebRTC } from '../context/WebRTCContext';
import { useTheme } from '../context/ThemeContext';
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
import CardChallengeNotification from '../components/CardChallengeNotification';
import CardScreen from '../screens/Card/CardScreen';
import CardGameScreen from '../screens/Card/CardGameScreen';
import ActivityScreen from '../screens/Activity/ActivityScreen';
import { useSocket } from '../context/SocketContext';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Auth Stack
const AuthStack = () => {
  const { colors } = useTheme();
  
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
    </Stack.Navigator>
  );
};

// Feed Stack (nested stack for Feed tab to include PostDetail)
const FeedStack = () => {
  const { colors } = useTheme();
  
  return (
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
            backgroundColor: colors.backgroundLight,
          },
          headerTintColor: colors.text,
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      />
    </Stack.Navigator>
  );
};

// Main Tab Navigator (after login)
const MainTabs = () => {
  const { colors } = useTheme();
  
  return (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarShowLabel: false, // Remove text labels below icons
      tabBarStyle: {
        backgroundColor: colors.backgroundLight,
        borderTopColor: colors.border,
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
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textGray,
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
          backgroundColor: colors.backgroundLight,
          borderTopWidth: 1,
          borderTopColor: colors.border,
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
            const color = isFocused ? colors.primary : colors.textGray;

            const onPress = () => {
              const event = props.navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                // Special handling for Profile tab: always navigate to own profile
                if (route.name === 'Profile') {
                  props.navigation.navigate('Profile', {
                    screen: 'UserProfile',
                    params: { username: 'self' }
                  });
                } else {
                  props.navigation.navigate(route.name);
                }
              } else if (isFocused && route.name === 'Profile') {
                // If already on Profile tab, navigate to own profile (in case viewing another user's profile)
                props.navigation.navigate('Profile', {
                  screen: 'UserProfile',
                  params: { username: 'self' }
                });
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
      name="Card"
      component={CardScreen}
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
};

// Profile Stack (nested stack for Profile tab to include UserProfile and PostDetail)
const ProfileStack = ({ navigation: stackNavigation }: any) => {
  const { colors } = useTheme();
  
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
          headerTitleAlign: 'center',
          headerStyle: {
            backgroundColor: colors.backgroundLight,
          },
          headerTintColor: colors.text,
          headerTitleStyle: {
            fontWeight: 'bold',
            fontSize: 18,
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
              style={{ 
                marginLeft: 15,
                padding: 5,
              }}
            >
              <Text style={{ 
                color: colors.text, 
                fontSize: 28,
                fontWeight: 'bold',
              }}>←</Text>
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
            backgroundColor: colors.backgroundLight,
          },
          headerTintColor: colors.text,
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
const MainStack = () => {
  const { colors } = useTheme();
  
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        presentation: 'card',
        cardStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen 
        name="CreatePost" 
        component={CreatePostScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="Activity" component={ActivityScreen} />
      <Stack.Screen 
        name="ChatScreen" 
        component={ChatScreen}
        options={{
          cardStyle: { backgroundColor: colors.background },
          animationEnabled: false,
        }}
      />
      <Stack.Screen 
        name="CallScreen" 
        component={CallScreen}
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
        }}
      />
      <Stack.Screen name="ChessGame" component={ChessGameScreen} />
      <Stack.Screen name="CardGame" component={CardGameScreen} />
    </Stack.Navigator>
  );
};

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
  const { call, pendingCancel, callEnded, isCalling, callAccepted, setIncomingCallFromNotification, getIncomingCallFromNotificationCallerId } = useWebRTC();
  const { chessChallenges, clearChessChallenge, cardChallenges, clearCardChallenge, socket } = useSocket();
  const navigationRef = useRef<any>(null);
  const navReadyRef = useRef(false);
  const [navReady, setNavReady] = useState(false);
  const pendingNavigationEvent = useRef<any>(null); // Store NavigateToCallScreen event if received before navigation ref is ready
  const lastNavigateToCallRef = useRef<{ callerId: string; ts: number } | null>(null); // P0: Navigate at most once per call (MainActivity emits 7x)
  const lastSetUpForCallerRef = useRef<string | null>(null); // P0: Avoid calling setIncomingCallFromNotification twice (listener + effect)
  const cancelGuardRef = useRef({
    pendingCancel: false,
    hasPendingCancelFromPrefs: false,
    callEnded: false,
  });

  // State to track pending cancel from SharedPreferences (checked on mount)
  const [hasPendingCancelFromPrefs, setHasPendingCancelFromPrefs] = useState(false);
  const [isInitialMount, setIsInitialMount] = useState(true);

  // Keep latest cancel/end state for native event handlers (which run with stable [] deps).
  useEffect(() => {
    cancelGuardRef.current = {
      pendingCancel,
      hasPendingCancelFromPrefs,
      callEnded,
    };
  }, [pendingCancel, hasPendingCancelFromPrefs, callEnded]);

  // Clear lastSetUpForCallerRef when call ends so next call can set up correctly
  useEffect(() => {
    if (callEnded) lastSetUpForCallerRef.current = null;
  }, [callEnded]);

  // Check SharedPreferences for pending cancel on mount and when call state changes
  useEffect(() => {
    const checkPendingCancel = async () => {
      try {
        const pendingData = await getPendingCallData();
        const hasCancel = !!(pendingData?.hasPendingCancel || pendingData?.shouldCancelCall);
        // Same caller has new pending call (declined first, answered second) – don't block
        const sameCallerNewCall = !!(pendingData?.hasPendingCall && pendingData?.callerId && pendingData?.callerIdToCancel && pendingData.callerId === pendingData.callerIdToCancel);
        setHasPendingCancelFromPrefs(hasCancel && !sameCallerNewCall);
        if (hasCancel && !sameCallerNewCall) {
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

  // When cancel guard state is cleared (pendingCancel/callEnded false), re-check SharedPreferences
  // so we pick up cleared prefs after WebRTCContext treats a pending cancel as stale and clears it
  useEffect(() => {
    if (pendingCancel || callEnded) return;
    const recheck = async () => {
      try {
        const pendingData = await getPendingCallData();
        const hasCancel = !!(pendingData?.hasPendingCancel || pendingData?.shouldCancelCall);
        const sameCallerNewCall = !!(pendingData?.hasPendingCall && pendingData?.callerId && pendingData?.callerIdToCancel && pendingData.callerId === pendingData.callerIdToCancel);
        setHasPendingCancelFromPrefs(hasCancel && !sameCallerNewCall);
      } catch {
        setHasPendingCancelFromPrefs(false);
      }
    };
    recheck();
  }, [pendingCancel, callEnded]);

  // Navigate to CallScreen when receiving an incoming call from socket
  // BUT: Don't navigate if there's a pending NavigateToCallScreen event (from MainActivity with shouldAutoAnswer)
  useEffect(() => {
    // CRITICAL: Check BOTH pendingCancel state AND SharedPreferences
    // This prevents navigation when Decline button is pressed and MainActivity launches
    if (pendingCancel || hasPendingCancelFromPrefs || callEnded) {
      console.log('⏸️ [AppNavigator] Skipping navigation - cancel/ended guard active', {
        pendingCancel,
        hasPendingCancelFromPrefs,
        callEnded,
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
      const currentRoute = navigationRef.current.getCurrentRoute?.();
      if (currentRoute?.name === 'CallScreen') {
        console.log('⏸️ [AppNavigator] Already on CallScreen - skipping navigation');
        return;
      }
      
      console.log('📞 [AppNavigator] Incoming call detected from socket, navigating to CallScreen...');
      console.log('📞 [AppNavigator] Caller:', call.name, '(', call.from, ')');
      console.log('📞 [AppNavigator] Call type:', call.callType);
      // If user already pressed Answer on native UI for THIS call, pass notification params so CallScreen auto-answers.
      // Use getter (ref) so we see cleared value immediately after CallCanceled – no wait for React state.
      const notificationCallerId = getIncomingCallFromNotificationCallerId?.() ?? null;
      const fromNotificationAnswer = notificationCallerId != null && notificationCallerId === call.from;
      navigationRef.current.navigate('CallScreen', {
        userName: call.name,
        userId: call.from,
        callType: call.callType || 'video',
        isFromNotification: fromNotificationAnswer,
        shouldAutoAnswer: fromNotificationAnswer,
        fromSocketIncoming: true, // Call state already set by callUser handler - do NOT overwrite with setIncomingCallFromNotification
      });
      // CRITICAL: Set lastNavigateToCallRef so later NavigateToCallScreen events are treated as duplicates.
      // Otherwise they call setIncomingCallFromNotification again and reset processingCallUserRef, isAnsweringRef, etc.
      if (call.from) lastNavigateToCallRef.current = { callerId: call.from, ts: Date.now() };
      console.log('✅ [AppNavigator] Navigated to CallScreen for incoming call (from socket)', { fromNotificationAnswer });
    }
  }, [call.isReceivingCall, call.from, call.name, call.callType, pendingCancel, hasPendingCancelFromPrefs, getIncomingCallFromNotificationCallerId]);

  // FIRM: If call ended/canceled while app was backgrounded, CallScreen may remain visible.
  // Force-dismiss ONLY on explicit end/cancel signals (NOT merely because state hasn't flipped yet on outgoing setup).
  useEffect(() => {
    if (!navigationRef.current) return;

    const currentRoute = navigationRef.current.getCurrentRoute?.();
    if (currentRoute?.name !== 'CallScreen') return;

    const shouldDismiss = pendingCancel || hasPendingCancelFromPrefs || callEnded;
    if (!shouldDismiss) return;

    console.log('📴 [AppNavigator] Forcing CallScreen dismiss (stale/ended call)', {
      pendingCancel,
      hasPendingCancelFromPrefs,
      callEnded,
    });

    // Prefer reset to a known-safe route to avoid GO_BACK not handled issues.
    navigationRef.current.reset({
      index: 0,
      routes: [{ name: 'MainTabs' }],
    });
  }, [pendingCancel, hasPendingCancelFromPrefs, callEnded, call.isReceivingCall, isCalling, callAccepted]);

  // Set up navigation refs for FCM and OneSignal when navigation is ready
  useEffect(() => {
    if (!navReady || !navigationRef.current) return;

    console.log('✅ [AppNavigator] Setting up navigation refs...');
    oneSignalService.setNavigationRef(navigationRef.current);

    const guard = cancelGuardRef.current;
    const pendingHasAnswer = pendingNavigationEvent.current?.shouldAutoAnswer === true;
    if (guard.pendingCancel || guard.hasPendingCancelFromPrefs) {
      console.log('⏸️ [AppNavigator] Skipping pending-call processing - cancel guard active', guard);
      pendingNavigationEvent.current = null;
      return;
    }
    if (!pendingHasAnswer && guard.callEnded) {
      console.log('⏸️ [AppNavigator] Skipping pending-call processing - call ended', guard);
      pendingNavigationEvent.current = null;
      return;
    }

    // Process pending NavigateToCallScreen event if any (e.g. user pressed Answer, nav wasn't ready)
    if (pendingNavigationEvent.current) {
      const data = pendingNavigationEvent.current;
      const callType = data.callType === 'video' ? 'video' : 'audio';
      // Only call setIncomingCallFromNotification if not already set up (listener may have run first when nav wasn't ready)
      const alreadySetUp = lastSetUpForCallerRef.current === data.callerId || (call.isReceivingCall && call.from === data.callerId);
      if (pendingHasAnswer && setIncomingCallFromNotification && !alreadySetUp && data.callerId) {
        lastSetUpForCallerRef.current = data.callerId;
        setIncomingCallFromNotification(data.callerId || '', data.callerName || 'Unknown', callType, true);
      }
      const cid = data.callerId;
      const n = lastNavigateToCallRef.current;
      if (cid && n && n.callerId === cid && Date.now() - n.ts < 15000) {
        console.log('📞 [AppNavigator] P0: Skip pending - already navigated for this call');
        pendingNavigationEvent.current = null;
      } else {
        console.log('📞 [AppNavigator] Processing pending NavigateToCallScreen event...');
        navigationRef.current.navigate('CallScreen', {
          userName: data.callerName,
          userId: data.callerId,
          callType: data.callType,
          isFromNotification: data.isFromNotification !== false,
          shouldAutoAnswer: data.shouldAutoAnswer === true,
          shouldDecline: data.shouldDecline || false,
        });
        if (cid) lastNavigateToCallRef.current = { callerId: cid, ts: Date.now() };
        pendingNavigationEvent.current = null;
        console.log('✅ [AppNavigator] Processed pending navigation to CallScreen');
      }
    }

    if (user) {
      // Check SharedPreferences for pending call data (backup when intent doesn't reach MainActivity)
      getPendingCallData()
        .then((callData) => {
          if (!callData?.hasPendingCall || !navigationRef.current) return;
          const g = cancelGuardRef.current;
          if (g.pendingCancel || g.hasPendingCancelFromPrefs || g.callEnded) {
            console.log('⏸️ [AppNavigator] Skip SharedPreferences nav - cancel/ended guard active', g);
            clearCallData();
            return;
          }

          const cid = callData.callerId;
          const n = lastNavigateToCallRef.current;
          if (cid && n && n.callerId === cid && Date.now() - n.ts < 15000) {
            console.log('📞 [AppNavigator] P0: Skip SharedPreferences nav - already navigated for this call');
            clearCallData();
            return;
          }
          console.log('📞 [AppNavigator] Found pending call in SharedPreferences:', callData);
          navigationRef.current.navigate('CallScreen', {
            userName: callData.callerName,
            userId: callData.callerId,
            callType: callData.callType || 'audio',
            isFromNotification: true,
            shouldAutoAnswer: callData.shouldAutoAnswer === true,
            shouldDecline: callData.shouldDecline === true,
          });
          if (cid) lastNavigateToCallRef.current = { callerId: cid, ts: Date.now() };
          clearCallData();
          console.log('✅ [AppNavigator] Navigated to CallScreen from SharedPreferences');
        })
        .catch((error) => {
          console.error('[AppNavigator] Error checking SharedPreferences:', error);
        });

      // Check SharedPreferences for pending OneSignal action button clicks
      getPendingOneSignalAction()
        .then((actionData) => {
          if (actionData && navigationRef.current) {
            console.log('🔘 [AppNavigator] Found pending OneSignal action in SharedPreferences:', actionData);

            if (actionData.action === 'com.compnay.ONESIGNAL_VIEW_POST' && actionData.postId) {
              console.log('🔘 [AppNavigator] Navigating to PostDetail from OneSignal action');
              navigationRef.current.navigate('Feed', {
                screen: 'PostDetail',
                params: { postId: actionData.postId },
              });
            } else if (actionData.action === 'com.compnay.ONESIGNAL_VIEW_PROFILE' && actionData.userId) {
              console.log('🔘 [AppNavigator] Navigating to UserProfile from OneSignal action');
              navigationRef.current.navigate('Profile', {
                screen: 'UserProfile',
                params: { userId: actionData.userId },
              });
            } else if (actionData.action === 'com.compnay.ONESIGNAL_MARK_READ') {
              console.log('🔘 [AppNavigator] Mark as read action - handled by OneSignal service');
            }

            clearOneSignalAction();
            console.log('✅ [AppNavigator] Processed OneSignal action from SharedPreferences');
          }
        })
        .catch((error) => {
          console.error('[AppNavigator] Error checking OneSignal action SharedPreferences:', error);
        });

      console.log('✅ [AppNavigator] Native IncomingCallActivity will handle call notifications');
    }
  }, [navReady, user, setIncomingCallFromNotification]);

  // Listen for navigation events from native code (e.g., from IncomingCallActivity via MainActivity)
  useEffect(() => {
    if (Platform.OS === 'android') {
      console.log('📞 [AppNavigator] Setting up NavigateToCallScreen listener...');
      
      const listener = DeviceEventEmitter.addListener('NavigateToCallScreen', (data: any) => {
        console.log('📞 [AppNavigator] ========== NavigateToCallScreen EVENT RECEIVED ==========');
        console.log('📞 [AppNavigator] Event data:', JSON.stringify(data));
        console.log('📞 [AppNavigator] Navigation ref available:', !!navigationRef.current);
        console.log('📞 [AppNavigator] Should auto-answer:', data?.shouldAutoAnswer);

        const guard = cancelGuardRef.current;
        const isAnswerFromNative = data?.shouldAutoAnswer === true;
        const callerId = data?.callerId;

        // CRITICAL: Skip duplicate events FIRST – do NOT call setIncomingCallFromNotification on duplicates.
        // Each call resets hasReceivedSignalForCallerRef, processingCallUserRef, etc., which interrupts
        // signal processing and auto-answer when callUser arrives.
        const nav = lastNavigateToCallRef.current;
        const isDuplicate = callerId && nav && nav.callerId === callerId && Date.now() - nav.ts < 15000;
        if (isDuplicate) {
          console.log('📞 [AppNavigator] P0: Skip duplicate NavigateToCallScreen (already set up for this call)');
          return;
        }

        if (guard.pendingCancel || guard.hasPendingCancelFromPrefs) {
          console.log('⏸️ [AppNavigator] Ignoring NavigateToCallScreen - cancel guard active', guard);
          return;
        }
        if (!isAnswerFromNative && guard.callEnded) {
          console.log('⏸️ [AppNavigator] Ignoring NavigateToCallScreen - call ended (not Answer)', guard);
          return;
        }

        // When user pressed Answer on native UI – set up call state and request signal (only once per call).
        // CRITICAL: Do NOT call setIncomingCallFromNotification if callUser already set up the call (has signal).
        // Overwriting with signal: null would break auto-answer and cause connection to fail.
        const callType = data?.callType === 'video' ? 'video' : 'audio';
        const currentRouteForSetup = navigationRef.current?.getCurrentRoute?.();
        const alreadyHasSignalFromCallUser = currentRouteForSetup?.name === 'CallScreen' && call.from === callerId && !!call.signal;
        if (isAnswerFromNative && setIncomingCallFromNotification && callerId && !alreadyHasSignalFromCallUser) {
          lastSetUpForCallerRef.current = callerId;
          setIncomingCallFromNotification(
            data.callerId || '',
            data.callerName || 'Unknown',
            callType,
            true
          );
        }
        
        if (navigationRef.current && data) {
          // Check if we're already on CallScreen
          const currentRoute = navigationRef.current.getCurrentRoute?.();
          const isAlreadyOnCallScreen = currentRoute?.name === 'CallScreen';
          
          if (isAlreadyOnCallScreen && data.shouldAutoAnswer === true) {
            // If already on CallScreen and shouldAutoAnswer=true, we need to trigger auto-answer
            // This can happen if socket event navigated first
            console.log('⚠️ [AppNavigator] Already on CallScreen - triggering auto-answer via WebRTCContext');
            navigationRef.current.navigate('CallScreen', {
              userName: data.callerName,
              userId: data.callerId,
              callType: data.callType,
              isFromNotification: data.isFromNotification !== false,
              shouldAutoAnswer: true,
              shouldDecline: data.shouldDecline || false,
            });
            if (callerId) lastNavigateToCallRef.current = { callerId, ts: Date.now() };
            console.log('✅ [AppNavigator] Updated CallScreen route params with shouldAutoAnswer=true');
          } else {
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
              isFromNotification: data.isFromNotification !== false,
              shouldAutoAnswer: data.shouldAutoAnswer === true,
              shouldDecline: data.shouldDecline || false,
            });
            if (callerId) lastNavigateToCallRef.current = { callerId, ts: Date.now() };
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
            
            setTimeout(() => {
              if (!navigationRef.current || !pendingNavigationEvent.current) return;
              const storedData = pendingNavigationEvent.current;
              const sid = storedData.callerId;
              const n = lastNavigateToCallRef.current;
              if (sid && n && n.callerId === sid && Date.now() - n.ts < 15000) {
                console.log('📞 [AppNavigator] P0: Retry skip - already navigated for this call');
                pendingNavigationEvent.current = null;
                return;
              }
              console.log('📞 [AppNavigator] Retry - Navigating to CallScreen...');
              navigationRef.current.navigate('CallScreen', {
                userName: storedData.callerName,
                userId: storedData.callerId,
                callType: storedData.callType,
                isFromNotification: storedData.isFromNotification !== false,
                shouldAutoAnswer: storedData.shouldAutoAnswer === true,
                shouldDecline: storedData.shouldDecline || false,
              });
              if (sid) lastNavigateToCallRef.current = { callerId: sid, ts: Date.now() };
              pendingNavigationEvent.current = null;
              console.log('✅ [AppNavigator] Retry - Navigated to CallScreen');
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
            const currentRoute = navigationRef.current.getCurrentRoute?.();
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
              shouldDecline: callData.shouldDecline === true,
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
    // CRITICAL: Don't include navigationRef.current in dependencies - causes infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
        // IMPORTANT: this callback can run multiple times; make it idempotent.
        if (!ref) return;
        if (navigationRef.current === ref && navReadyRef.current) return;
        navigationRef.current = ref;
        if (!navReadyRef.current) {
          navReadyRef.current = true;
          setNavReady(true);
        }
        console.log('✅ [AppNavigator] NavigationContainer ref ready');
      }}
    >
      <View style={{ flex: 1 }}>
        {user ? <MainStack /> : <AuthStack />}
        {user && (
          <ChessChallengeNotification
            challenges={chessChallenges}
            onDecline={(challenge) => {
              try {
                if (socket && user?._id && challenge?.from) {
                  socket.emit('declineChessChallenge', {
                    from: user._id,
                    to: challenge.from,
                  });
                }
              } finally {
                clearChessChallenge(challenge?.from);
              }
            }}
            onAccept={(challenge) => {
              try {
                if (!socket || !user?._id || !challenge?.from) {
                  clearChessChallenge(challenge?.from);
                  return;
                }

                const roomId = `chess_${challenge.from}_${user._id}_${Date.now()}`;

                // Navigate first (like web), then emit accept
                navigationRef.current?.navigate('ChessGame', {
                  roomId,
                  color: 'black', // receiver/accepter is black (backend uses from=accepter)
                  opponentId: challenge.from,
                });

                setTimeout(() => {
                  socket.emit('acceptChessChallenge', {
                    from: user._id, // accepter
                    to: challenge.from, // challenger
                    roomId,
                  });
                }, 100);
              } finally {
                clearChessChallenge(challenge?.from);
              }
            }}
          />
        )}
        {user && (
          <CardChallengeNotification
            challenges={cardChallenges}
            onDecline={(challenge) => {
              try {
                if (socket && user?._id && challenge?.from) {
                  socket.emit('declineCardChallenge', {
                    from: user._id,
                    to: challenge.from,
                  });
                }
              } finally {
                clearCardChallenge(challenge?.from);
              }
            }}
            onAccept={(challenge) => {
              try {
                if (!socket || !user?._id || !challenge?.from) {
                  clearCardChallenge(challenge?.from);
                  return;
                }

                const roomId = `card_${challenge.from}_${user._id}_${Date.now()}`;

                // Navigate first (like web), then emit accept
                navigationRef.current?.navigate('CardGame', {
                  roomId,
                  opponentId: challenge.from,
                });

                setTimeout(() => {
                  socket.emit('acceptCardChallenge', {
                    from: user._id, // accepter
                    to: challenge.from, // challenger
                    roomId,
                  });
                }, 100);
              } finally {
                clearCardChallenge(challenge?.from);
              }
            }}
          />
        )}
      </View>
    </NavigationContainer>
  );
};

export default AppNavigator;
