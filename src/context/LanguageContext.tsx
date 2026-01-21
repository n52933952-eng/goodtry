import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Language = 'en' | 'ar';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// Translation strings - Complete app translations
const translations: Record<Language, Record<string, string>> = {
  en: {
    // Login Screen
    'welcomeBack': 'Welcome Back',
    'loginToAccount': 'Login to your account',
    'username': 'Username',
    'password': 'Password',
    'login': 'Login',
    'dontHaveAccount': "Don't have an account?",
    'signUp': 'Sign Up',
    'pleaseFillAllFields': 'Please fill all fields',
    'loggedInSuccessfully': 'Logged in successfully!',
    'failedToLogin': 'Failed to login',
    
    // SignUp Screen
    'createAccount': 'Create Account',
    'signUpToGetStarted': 'Sign up to get started',
    'fullName': 'Full Name',
    'email': 'Email',
    'selectCountry': 'Select country',
    'passwordMin6': 'Password (min 6 characters)',
    'passwordMustBe6Chars': 'Password must be at least 6 characters',
    'accountCreatedSuccessfully': 'Account created successfully!',
    'failedToCreateAccount': 'Failed to create account',
    'alreadyHaveAccount': 'Already have an account?',
    'showPassword': 'Show password',
    'hidePassword': 'Hide password',
    
    // Feed Screen
    'feed': 'Feed',
    'createPost': 'Create Post',
    'loggedOut': 'Logged Out',
    'youHaveBeenLoggedOut': 'You have been logged out',
    'failedToLogout': 'Failed to logout',
    'noPosts': 'No posts available',
    'pullToRefresh': 'Pull down to refresh',
    
    // Messages Screen
    'messages': 'Messages',
    'searchUsers': 'Search users...',
    'noConversations': 'No conversations',
    'startConversation': 'Start a conversation',
    'noUsersFound': 'No users found',
    'deleteConversation': 'Delete Conversation',
    'confirmDeleteConversation': 'Are you sure you want to delete this conversation?',
    'yes': 'Yes',
    'no': 'No',
    
    // Chat Screen
    'typeMessage': 'Type a message...',
    'send': 'Send',
    'online': 'Online',
    'offline': 'Offline',
    'reply': 'Reply',
    'react': 'React',
    'deleteMessage': 'Delete Message',
    'confirmDeleteMessage': 'Are you sure you want to delete this message?',
    
    // Profile Screen
    'profile': 'Profile',
    'followers': 'Followers',
    'following': 'Following',
    'posts': 'Posts',
    'follow': 'Follow',
    'unfollow': 'Unfollow',
    'updateProfile': 'Update Profile',
    'editProfile': 'Edit Profile',
    'noPostsYet': 'No posts yet',
    
    // Post Detail Screen
    'comments': 'Comments',
    'addComment': 'Add a comment...',
    'like': 'Like',
    'unlike': 'Unlike',
    'share': 'Share',
    
    // Create Post Screen
    'whatsOnYourMind': "What's on your mind?",
    'post': 'Post',
    'postCreatedSuccessfully': 'Post created successfully!',
    'pleaseAddTextOrImage': 'Please add some text or an image',
    'failedToCreatePost': 'Failed to create post',
    'collaborativePost': 'Collaborative Post',
    
    // Weather Screen
    'weather': 'Weather',
    'followWeather': 'Follow Weather',
    'following': 'Following',
    'saveAndUpdateFeed': 'Save & Update Feed',
    'selectCities': 'Select cities in Weather screen',
    'noWeatherData': 'No weather data available',
    'searchCities': 'Search cities (e.g., Doha, Baghdad)...',
    'searchResults': 'Search Results',
    'noCitiesFound': 'No cities found',
    'tryDifferentSearch': 'Try a different search term',
    'added': 'Added',
    'add': 'Add',
    
    // Football Screen
    'football': 'Football',
    'live': 'Live',
    'upcoming': 'Upcoming',
    'finished': 'Finished',
    'noMatches': 'No matches',
    'noLiveMatches': 'No live matches',
    'noUpcomingMatches': 'No upcoming matches',
    'noFinishedMatches': 'No finished matches',
    
    // Activity Screen
    'liveActivity': '🔴 Live Activity',
    'noActivity': 'No activity',
    'activitiesFromUsersYouFollow': 'Activities from users you follow will appear here',
    
    // Notifications Screen
    'notifications': 'Notifications',
    'noNotifications': 'No notifications',
    
    // Update Profile Screen
    'updateProfile': 'Update Profile',
    'name': 'Name',
    'bio': 'Bio',
    'country': 'Country',
    'changeAvatar': 'Change Avatar',
    'profileUpdatedSuccessfully': 'Profile updated successfully!',
    'failedToUpdateProfile': 'Failed to update profile',
    'userNotFound': 'User not found',
    'failedToSelectImage': 'Failed to select image',
    'newPassword': 'New Password (optional)',
    
    // Common
    'error': 'Error',
    'success': 'Success',
    'info': 'Info',
    'cancel': 'Cancel',
    'save': 'Save',
    'delete': 'Delete',
    'edit': 'Edit',
    'loading': 'Loading...',
    'refresh': 'Refresh',
    'back': 'Back',
    'close': 'Close',
    'confirm': 'Confirm',
    'ok': 'OK',
    'selectImage': 'Select Image',
    'chooseOption': 'Choose an option',
    'camera': 'Camera',
    'gallery': 'Gallery',
    'image': 'Image',
    'deleteConversationQuestion': 'Delete conversation?',
    'deleteConversationWarning': 'This will delete the conversation and all messages for both users.',
    'failedToDeleteConversation': 'Failed to delete conversation',
    'noMessagesYet': 'No messages yet',
    'unknown': 'Unknown',
    'createPost': 'Create Post',
    'postCreatedButResponseInvalid': 'Post created but response invalid',
    'writeComment': 'Write a comment...',
    'writeReplyToComment': 'Write a reply to comment...',
    'postNotFound': 'Post not found',
    'passwordLeaveEmpty': 'Password (leave empty to keep current)',
    'newPasswordPlaceholder': 'New password',
    'yourBio': 'Your bio...',
    'selectCountryPlaceholder': 'Select country',
  },
  ar: {
    // Login Screen
    'welcomeBack': 'مرحباً بعودتك',
    'loginToAccount': 'سجل الدخول إلى حسابك',
    'username': 'اسم المستخدم',
    'password': 'كلمة المرور',
    'login': 'تسجيل الدخول',
    'dontHaveAccount': 'ليس لديك حساب؟',
    'signUp': 'إنشاء حساب',
    'pleaseFillAllFields': 'يرجى ملء جميع الحقول',
    'loggedInSuccessfully': 'تم تسجيل الدخول بنجاح!',
    'failedToLogin': 'فشل تسجيل الدخول',
    
    // SignUp Screen
    'createAccount': 'إنشاء حساب',
    'signUpToGetStarted': 'سجل للبدء',
    'fullName': 'الاسم الكامل',
    'email': 'البريد الإلكتروني',
    'selectCountry': 'اختر البلد',
    'passwordMin6': 'كلمة المرور (6 أحرف على الأقل)',
    'passwordMustBe6Chars': 'يجب أن تكون كلمة المرور 6 أحرف على الأقل',
    'accountCreatedSuccessfully': 'تم إنشاء الحساب بنجاح!',
    'failedToCreateAccount': 'فشل إنشاء الحساب',
    'alreadyHaveAccount': 'لديك حساب بالفعل؟',
    'showPassword': 'إظهار كلمة المرور',
    'hidePassword': 'إخفاء كلمة المرور',
    
    // Feed Screen
    'feed': 'الخلاصة',
    'createPost': 'إنشاء منشور',
    'loggedOut': 'تم تسجيل الخروج',
    'youHaveBeenLoggedOut': 'تم تسجيل خروجك',
    'failedToLogout': 'فشل تسجيل الخروج',
    'noPosts': 'لا توجد منشورات',
    'pullToRefresh': 'اسحب للأسفل للتحديث',
    
    // Messages Screen
    'messages': 'الرسائل',
    'searchUsers': 'البحث عن المستخدمين...',
    'noConversations': 'لا توجد محادثات',
    'startConversation': 'ابدأ محادثة',
    'noUsersFound': 'لم يتم العثور على مستخدمين',
    'deleteConversation': 'حذف المحادثة',
    'confirmDeleteConversation': 'هل أنت متأكد أنك تريد حذف هذه المحادثة؟',
    'yes': 'نعم',
    'no': 'لا',
    
    // Chat Screen
    'typeMessage': 'اكتب رسالة...',
    'send': 'إرسال',
    'online': 'متصل',
    'offline': 'غير متصل',
    'reply': 'رد',
    'react': 'تفاعل',
    'deleteMessage': 'حذف الرسالة',
    'confirmDeleteMessage': 'هل أنت متأكد أنك تريد حذف هذه الرسالة؟',
    
    // Profile Screen
    'profile': 'الملف الشخصي',
    'followers': 'المتابعون',
    'following': 'يتابع',
    'posts': 'المنشورات',
    'follow': 'متابعة',
    'unfollow': 'إلغاء المتابعة',
    'updateProfile': 'تحديث الملف الشخصي',
    'editProfile': 'تعديل الملف الشخصي',
    'noPostsYet': 'لا توجد منشورات بعد',
    
    // Post Detail Screen
    'comments': 'التعليقات',
    'addComment': 'أضف تعليقاً...',
    'like': 'إعجاب',
    'unlike': 'إلغاء الإعجاب',
    'share': 'مشاركة',
    
    // Create Post Screen
    'whatsOnYourMind': 'بم تفكر؟',
    'post': 'نشر',
    'postCreatedSuccessfully': 'تم إنشاء المنشور بنجاح!',
    'pleaseAddTextOrImage': 'يرجى إضافة نص أو صورة',
    'failedToCreatePost': 'فشل إنشاء المنشور',
    'collaborativePost': 'منشور تعاوني',
    
    // Weather Screen
    'weather': 'الطقس',
    'followWeather': 'متابعة الطقس',
    'following': 'متابع',
    'saveAndUpdateFeed': 'حفظ وتحديث الخلاصة',
    'selectCities': 'اختر المدن في شاشة الطقس',
    'noWeatherData': 'لا توجد بيانات طقس متاحة',
    'searchCities': 'البحث عن المدن (مثل: الدوحة، بغداد)...',
    'searchResults': 'نتائج البحث',
    'noCitiesFound': 'لم يتم العثور على مدن',
    'tryDifferentSearch': 'جرب مصطلح بحث مختلف',
    'added': 'تمت الإضافة',
    'add': 'إضافة',
    
    // Football Screen
    'football': 'كرة القدم',
    'live': 'مباشر',
    'upcoming': 'قادمة',
    'finished': 'منتهية',
    'noMatches': 'لا توجد مباريات',
    'noLiveMatches': 'لا توجد مباريات مباشرة',
    'noUpcomingMatches': 'لا توجد مباريات قادمة',
    'noFinishedMatches': 'لا توجد مباريات منتهية',
    
    // Activity Screen
    'liveActivity': '🔴 النشاط المباشر',
    'noActivity': 'لا يوجد نشاط',
    'activitiesFromUsersYouFollow': 'سيظهر هنا نشاطات من المستخدمين الذين تتابعهم',
    
    // Notifications Screen
    'notifications': 'الإشعارات',
    'noNotifications': 'لا توجد إشعارات',
    
    // Update Profile Screen
    'updateProfile': 'تحديث الملف الشخصي',
    'name': 'الاسم',
    'bio': 'السيرة الذاتية',
    'country': 'البلد',
    'changeAvatar': 'تغيير الصورة الشخصية',
    'profileUpdatedSuccessfully': 'تم تحديث الملف الشخصي بنجاح!',
    'failedToUpdateProfile': 'فشل تحديث الملف الشخصي',
    'userNotFound': 'المستخدم غير موجود',
    'failedToSelectImage': 'فشل اختيار الصورة',
    'newPassword': 'كلمة المرور الجديدة (اختياري)',
    
    // Common
    'error': 'خطأ',
    'success': 'نجح',
    'info': 'معلومات',
    'cancel': 'إلغاء',
    'save': 'حفظ',
    'delete': 'حذف',
    'edit': 'تعديل',
    'loading': 'جاري التحميل...',
    'refresh': 'تحديث',
    'back': 'رجوع',
    'close': 'إغلاق',
    'confirm': 'تأكيد',
    'ok': 'موافق',
    'selectImage': 'اختر صورة',
    'chooseOption': 'اختر خياراً',
    'camera': 'الكاميرا',
    'gallery': 'المعرض',
    'image': 'صورة',
    'deleteConversationQuestion': 'حذف المحادثة؟',
    'deleteConversationWarning': 'سيؤدي هذا إلى حذف المحادثة وجميع الرسائل لكلا المستخدمين.',
    'failedToDeleteConversation': 'فشل حذف المحادثة',
    'noMessagesYet': 'لا توجد رسائل بعد',
    'unknown': 'غير معروف',
    'createPost': 'إنشاء منشور',
    'postCreatedButResponseInvalid': 'تم إنشاء المنشور لكن الاستجابة غير صالحة',
    'writeComment': 'اكتب تعليقاً...',
    'writeReplyToComment': 'اكتب رداً على التعليق...',
    'postNotFound': 'المنشور غير موجود',
    'passwordLeaveEmpty': 'كلمة المرور (اتركها فارغة للاحتفاظ بالحالية)',
    'newPasswordPlaceholder': 'كلمة المرور الجديدة',
    'yourBio': 'سيرتك الذاتية...',
    'selectCountryPlaceholder': 'اختر البلد',
  },
};

const STORAGE_KEY = '@app_language';

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<Language>('en');

  // Load saved language on mount
  useEffect(() => {
    const loadLanguage = async () => {
      try {
        const savedLanguage = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedLanguage === 'en' || savedLanguage === 'ar') {
          setLanguageState(savedLanguage as Language);
        }
      } catch (error) {
        console.error('Error loading language:', error);
      }
    };
    loadLanguage();
  }, []);

  const setLanguage = async (lang: Language) => {
    try {
      setLanguageState(lang);
      await AsyncStorage.setItem(STORAGE_KEY, lang);
    } catch (error) {
      console.error('Error saving language:', error);
    }
  };

  const t = (key: string): string => {
    return translations[language][key] || key;
  };

  const isRTL = language === 'ar';

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};
