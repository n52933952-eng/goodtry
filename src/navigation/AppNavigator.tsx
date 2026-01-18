import React, { useRef, useEffect } from 'react';
import { View, Text, DeviceEventEmitter, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useUser } from '../context/UserContext';
import { useWebRTC } from '../context/WebRTCContext';
import { COLORS } from '../utils/constants';
import fcmService from '../services/fcmService';
import oneSignalService from '../services/onesignal';

// Auth Screens
import LoginScreen from '../screens/Auth/LoginScreen';
import SignupScreen from '../screens/Auth/SignupScreen';

// Main Screens
import FeedScreen from '../screens/Home/FeedScreen';
import CreatePostScreen from '../screens/Post/CreatePostScreen';
import PostDetailScreen from '../screens/Post/PostDetailScreen';
import UserProfileScreen from '../screens/Profile/UserProfileScreen';
import SearchScreen from '../screens/Search/SearchScreen';
import NotificationsScreen from '../screens/Notifications/NotificationsScreen';
import WeatherScreen from '../screens/Weather/WeatherScreen';
import FootballScreen from '../screens/Football/FootballScreen';
import MessagesScreen from '../screens/Messages/MessagesScreen';
import ChatScreen from '../screens/Messages/ChatScreen';
import CallScreen from '../screens/Call/CallScreen';
import ChessScreen from '../screens/Chess/ChessScreen';
import ChessGameScreen from '../screens/Chess/ChessGameScreen';

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
      component={FeedScreen}
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
      component={UserProfileScreen}
      initialParams={{ username: 'self' }}
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
    <Stack.Screen name="PostDetail" component={PostDetailScreen} />
    <Stack.Screen name="UserProfile" component={UserProfileScreen} />
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
  const { call } = useWebRTC();
  const navigationRef = useRef<any>(null);
  const pendingNavigationEvent = useRef<any>(null); // Store NavigateToCallScreen event if received before navigation ref is ready

  // Navigate to CallScreen when receiving an incoming call from socket
  // BUT: Don't navigate if there's a pending NavigateToCallScreen event (from MainActivity with shouldAutoAnswer)
  useEffect(() => {
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
  }, [call.isReceivingCall, call.from, call.name, call.callType]);

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

  if (isLoading) {
    return null; // You can add a splash screen here
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <View style={{ flex: 1 }}>
        {user ? <MainStack /> : <AuthStack />}
      </View>
    </NavigationContainer>
  );
};

export default AppNavigator;
