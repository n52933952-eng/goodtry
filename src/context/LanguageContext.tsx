import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Language = 'en' | 'ar';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  tn: (key: string, params?: Record<string, string | number>) => string;
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
    'removeFromFeed': 'Remove from feed',
    'removeFromFeedHint':
      'This card will disappear from your feed. Open Weather, Football, or Channels again to bring it back.',
    'removeFromFeedConfirm': 'Remove',
    'removedFromFeed': 'Removed from your feed',
    
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
    'typing': 'is typing',
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
    'profilePhoto': 'Profile photo',
    
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
    'pleaseAddTextOrImage': 'Please add some text, a photo, or a video',
    'failedToCreatePost': 'Failed to create post',
    'collaborativePost': 'Collaborative Post',
    'addContributors': 'Add contributors',
    'addContributorsConfirm': 'Add contributors',
    'addContributor': 'Add contributor',
    'selectAtLeastOneContributor': 'Please select at least one user',
    'contributorsAdded': 'Contributors added',
    'failedToAddContributor': 'Failed to add contributor',
    'searchContributorsPlaceholder': 'Search by name or username…',
    'peopleYouFollow': 'People you follow',
    'typeMoreToSearchGlobally': 'No matches in your following. Type at least 2 characters to search.',
    'notFollowingAnyoneSearchContributors': 'You are not following anyone yet. Search for users to add.',
    'manageContributors': 'Manage contributors',
    'postOwner': 'Post owner',
    'owner': 'Owner',
    'contributors': 'Contributors',
    'removeContributor': 'Remove contributor',
    'removeContributorQuestion': 'Remove {{name}} from this collaborative post?',
    'contributorRemoved': 'Contributor removed',
    'failedToRemoveContributor': 'Failed to remove contributor',
    'noContributorsYet': 'No contributors yet. Add people to collaborate.',
    'editPost': 'Edit post',
    'postUpdatedSuccessfully': 'Post updated!',
    'failedToUpdatePost': 'Failed to update post',
    'postTextTooLong': 'Post must be 500 characters or less',
    'media': 'Media',
    'replaceMediaHint': 'Pick a new photo or video to replace the current one.',
    'changeMedia': 'Change photo or video',
    'addPhotoOrVideo': 'Add photo or video',
    'video': 'Video',
    'editedPost': 'Edited',
    
    // Weather Screen
    'weather': 'Weather',
    'followWeather': 'Follow Weather',
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
    'gallery': 'Gallery (photo or video)',
    'pickPhotoVideo': 'Pick photo / video',
    'takePhoto': 'Take photo',
    'recordVideo': 'Record video',
    'selectMedia': 'Add image or video',
    'image': 'Image',
    'storyAndProfile': 'Story & profile',
    'seeStory': 'See story',
    'goToProfile': 'Go to profile',
    'viewers': 'Viewers',
    'deleteStoryItemTitle': 'Delete this story item?',
    'deleteStoryItemBody': 'Remove only the current story item.',
    'newStory': 'New story',
    'storyPublished': 'Story published',
    'addedToYourStory': 'Added to your story',
    'uploadFailed': 'Upload failed',
    'pickPhotosVideos': 'Pick photos & videos',
    'storyTextOptional': 'Story text (optional)',
    'videoTooLongTitle': 'Video too long',
    'videoTooLongBody': 'Each clip must be {{sec}} seconds or less.',
    'done': 'Done',
    'noViewsYet': 'No views yet',
    'deleteAccount': 'Delete account',
    'deleteAccountTitle': 'Delete your account?',
    'deleteAccountBody':
      'This will permanently delete your account and all your data (posts, stories, messages, and collaborations). This cannot be undone.',
    'typeDeleteToConfirm': 'Type DELETE to confirm',
    'confirmDelete': 'Confirm delete',
    'deleteAccountFailed': 'Failed to delete account',
    'deleteAccountSuccess': 'Account deleted',
    'deleteConversationQuestion': 'Delete conversation?',
    'deleteConversationWarning': 'This will delete the conversation and all messages for both users.',
    'failedToDeleteConversation': 'Failed to delete conversation',
    'noMessagesYet': 'No messages yet',
    'unknown': 'Unknown',
    'postCreatedButResponseInvalid': 'Post created but response invalid',
    'writeComment': 'Write a comment...',
    'writeReplyToComment': 'Write a reply to comment...',
    'postNotFound': 'Post not found',
    'passwordLeaveEmpty': 'Password (leave empty to keep current)',
    'newPasswordPlaceholder': 'New password',
    'yourBio': 'Your bio...',
    'selectCountryPlaceholder': 'Select country',
    'replyingTo': 'Replying to',
    'attachment': '📎 Attachment',
    'videoSelected': 'Video selected',
    'imageSelected': 'Image selected',
    'remove': 'Remove',
    'unfollowed': 'Unfollowed',
    'failedToFollowUnfollow': 'Failed to follow/unfollow',
    'failedToLoadList': 'Could not load this list. Try again.',
    'confirmUnfollowUser': 'Stop following {{name}}?',
    'removeFollowerTitle': 'Remove follower',
    'removeFollowerMessage': '{{name}} will no longer follow you.',
    'followerRemoved': 'Follower removed',
    'failedToRemoveFollower': 'Could not remove follower',
    'noFollowingYet': 'You are not following anyone yet.',
    'noFollowersYet': 'No followers yet.',
    'pleaseEnterReply': 'Please enter a reply',
    'failedToPostReply': 'Failed to post reply',
    'mustBeLoggedInToLike': 'You must be logged in to like',
    'failedToLikeComment': 'Failed to like comment',
    'mustBeLoggedInToDelete': 'You must be logged in to delete comments',
    'commentDeletedSuccessfully': 'Comment deleted successfully',
    'failedToDeleteComment': 'Failed to delete comment',
    'message': 'message',
    'loadMoreComments': 'Load More Comments',
    'remaining': 'remaining',
    'failedToLoadWeatherData': 'Failed to load weather data',
    'limitReached': 'Limit Reached',
    'youCanSelectUpTo10Cities': 'You can select up to 10 cities only.',
    'noCitiesSelected': 'No Cities Selected',
    'pleaseSelectAtLeastOneCity': 'Please select at least one city.',
    'weatherPreferencesSaved': '✅ Weather preferences saved!',
    'failedToSavePreferences': 'Failed to save preferences',
    'footballAccountNotFound': 'Football account not found',
    'unfollowedFootballChannel': 'Unfollowed Football channel',
    'followingFootballChannel': 'Following Football channel! You\'ll now see updates in your feed',
    'failedToUpdateFollowStatus': 'Failed to update follow status',
    'unknownLeague': 'Unknown League',
    'halfTime': 'HALF TIME',
    'tbd': 'TBD',
    'justNow': 'just now',
    'ago': 'ago',
    'likedAPost': 'liked a post',
    'commentedOnAPost': 'commented on a post',
    'followed': 'followed',
    'createdAPost': 'created a post',
    'repliedToAComment': 'replied to a comment',
    'didSomething': 'did something',
    'someone': 'Someone',
    'likedYourComment': 'liked your comment',
    'likedYourPost': 'liked your post',
    'commentedOnYourPost': 'commented on your post',
    'mentionedYouInAComment': 'mentioned you in a comment',
    'startedFollowingYou': 'started following you',
    'challengedYouToAChessGame': 'challenged you to a chess game',
    'sentYouAMessage': 'sent you a message',
    'addedYouAsAContributor': 'added you as a contributor to',
    'edited': 'edited',
    'newNotification': 'New notification',
    'now': 'now',
    'youWillSeeNotifications': 'You\'ll see notifications when someone likes, comments, or follows you',
    'selected': 'Selected',
    'cities': 'cities',
    'isAlreadySelected': 'is already selected',
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
    'removeFromFeed': 'إزالة من الخلاصة',
    'removeFromFeedHint':
      'ستُزال هذه البطاقة من خلاصتك. يمكنك فتح الطقس أو كرة القدم أو القنوات لإعادتها.',
    'removeFromFeedConfirm': 'إزالة',
    'removedFromFeed': 'تمت الإزالة من خلاصتك',
    
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
    'typing': 'يكتب',
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
    'profilePhoto': 'الصورة الشخصية',
    
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
    'pleaseAddTextOrImage': 'يرجى إضافة نص أو صورة أو فيديو',
    'failedToCreatePost': 'فشل إنشاء المنشور',
    'collaborativePost': 'منشور تعاوني',
    'addContributors': 'إضافة مساهمين',
    'addContributorsConfirm': 'إضافة المساهمين',
    'addContributor': 'إضافة مساهم',
    'selectAtLeastOneContributor': 'يرجى اختيار مستخدم واحد على الأقل',
    'contributorsAdded': 'تمت إضافة المساهمين',
    'failedToAddContributor': 'فشل إضافة المساهم',
    'searchContributorsPlaceholder': 'ابحث بالاسم أو اسم المستخدم…',
    'peopleYouFollow': 'الأشخاص الذين تتابعهم',
    'typeMoreToSearchGlobally': 'لا توجد نتائج في قائمة المتابَعين. اكتب حرفين على الأقل للبحث.',
    'notFollowingAnyoneSearchContributors': 'لا تتابع أحداً بعد. ابحث عن مستخدمين لإضافتهم.',
    'manageContributors': 'إدارة المساهمين',
    'postOwner': 'صاحب المنشور',
    'owner': 'المالك',
    'contributors': 'المساهمون',
    'removeContributor': 'إزالة مساهم',
    'removeContributorQuestion': 'إزالة {{name}} من هذا المنشور التعاوني؟',
    'contributorRemoved': 'تمت إزالة المساهم',
    'failedToRemoveContributor': 'فشل إزالة المساهم',
    'noContributorsYet': 'لا يوجد مساهمون بعد. أضف أشخاصاً للتعاون.',
    'editPost': 'تعديل المنشور',
    'postUpdatedSuccessfully': 'تم تحديث المنشور!',
    'failedToUpdatePost': 'فشل تحديث المنشور',
    'postTextTooLong': 'يجب ألا يتجاوز المنشور 500 حرفاً',
    'media': 'الوسائط',
    'replaceMediaHint': 'اختر صورة أو فيديو جديداً لاستبدال الحالي.',
    'changeMedia': 'تغيير الصورة أو الفيديو',
    'addPhotoOrVideo': 'إضافة صورة أو فيديو',
    'video': 'فيديو',
    'editedPost': 'تم التعديل',
    
    // Weather Screen
    'weather': 'الطقس',
    'followWeather': 'متابعة الطقس',
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
    'gallery': 'المعرض (صورة أو فيديو)',
    'pickPhotoVideo': 'اختر صورة / فيديو',
    'takePhoto': 'التقط صورة',
    'recordVideo': 'تسجيل فيديو',
    'selectMedia': 'إضافة صورة أو فيديو',
    'image': 'صورة',
    'storyAndProfile': 'القصة والملف الشخصي',
    'seeStory': 'عرض القصة',
    'goToProfile': 'الذهاب إلى الملف الشخصي',
    'viewers': 'المشاهدون',
    'deleteStoryItemTitle': 'حذف عنصر القصة؟',
    'deleteStoryItemBody': 'سيتم حذف العنصر الحالي فقط.',
    'newStory': 'قصة جديدة',
    'storyPublished': 'تم نشر القصة',
    'addedToYourStory': 'تمت الإضافة إلى قصتك',
    'uploadFailed': 'فشل الرفع',
    'pickPhotosVideos': 'اختر صوراً وفيديوهات',
    'storyTextOptional': 'نص القصة (اختياري)',
    'videoTooLongTitle': 'الفيديو طويل جداً',
    'videoTooLongBody': 'يجب ألا تتجاوز مدة كل مقطع {{sec}} ثانية.',
    'done': 'تم',
    'noViewsYet': 'لا توجد مشاهدات بعد',
    'deleteAccount': 'حذف الحساب',
    'deleteAccountTitle': 'حذف حسابك؟',
    'deleteAccountBody':
      'سيتم حذف حسابك وجميع بياناتك نهائياً (المنشورات، القصص، الرسائل، والمساهمات). لا يمكن التراجع عن ذلك.',
    'typeDeleteToConfirm': 'اكتب DELETE للتأكيد',
    'confirmDelete': 'تأكيد الحذف',
    'deleteAccountFailed': 'فشل حذف الحساب',
    'deleteAccountSuccess': 'تم حذف الحساب',
    'deleteConversationQuestion': 'حذف المحادثة؟',
    'deleteConversationWarning': 'سيؤدي هذا إلى حذف المحادثة وجميع الرسائل لكلا المستخدمين.',
    'failedToDeleteConversation': 'فشل حذف المحادثة',
    'noMessagesYet': 'لا توجد رسائل بعد',
    'unknown': 'غير معروف',
    'postCreatedButResponseInvalid': 'تم إنشاء المنشور لكن الاستجابة غير صالحة',
    'writeComment': 'اكتب تعليقاً...',
    'writeReplyToComment': 'اكتب رداً على التعليق...',
    'postNotFound': 'المنشور غير موجود',
    'passwordLeaveEmpty': 'كلمة المرور (اتركها فارغة للاحتفاظ بالحالية)',
    'newPasswordPlaceholder': 'كلمة المرور الجديدة',
    'yourBio': 'سيرتك الذاتية...',
    'selectCountryPlaceholder': 'اختر البلد',
    'replyingTo': 'الرد على',
    'attachment': '📎 مرفق',
    'videoSelected': 'تم اختيار فيديو',
    'imageSelected': 'تم اختيار صورة',
    'remove': 'إزالة',
    'unfollowed': 'تم إلغاء المتابعة',
    'failedToFollowUnfollow': 'فشل المتابعة/إلغاء المتابعة',
    'failedToLoadList': 'تعذر تحميل هذه القائمة. حاول مرة أخرى.',
    'confirmUnfollowUser': 'إلغاء متابعة {{name}}؟',
    'removeFollowerTitle': 'إزالة المتابع',
    'removeFollowerMessage': 'لن يتابعك {{name}} بعد الآن.',
    'followerRemoved': 'تمت إزالة المتابع',
    'failedToRemoveFollower': 'تعذر إزالة المتابع',
    'noFollowingYet': 'لا تتابع أحداً بعد.',
    'noFollowersYet': 'لا يوجد متابعون بعد.',
    'pleaseEnterReply': 'يرجى إدخال رد',
    'failedToPostReply': 'فشل نشر الرد',
    'mustBeLoggedInToLike': 'يجب تسجيل الدخول للإعجاب',
    'failedToLikeComment': 'فشل الإعجاب بالتعليق',
    'mustBeLoggedInToDelete': 'يجب تسجيل الدخول لحذف التعليقات',
    'commentDeletedSuccessfully': 'تم حذف التعليق بنجاح',
    'failedToDeleteComment': 'فشل حذف التعليق',
    'message': 'رسالة',
    'loadMoreComments': 'تحميل المزيد من التعليقات',
    'remaining': 'متبقي',
    'failedToLoadWeatherData': 'فشل تحميل بيانات الطقس',
    'limitReached': 'تم الوصول للحد الأقصى',
    'youCanSelectUpTo10Cities': 'يمكنك اختيار ما يصل إلى 10 مدن فقط.',
    'noCitiesSelected': 'لم يتم اختيار مدن',
    'pleaseSelectAtLeastOneCity': 'يرجى اختيار مدينة واحدة على الأقل.',
    'weatherPreferencesSaved': '✅ تم حفظ تفضيلات الطقس!',
    'failedToSavePreferences': 'فشل حفظ التفضيلات',
    'footballAccountNotFound': 'حساب كرة القدم غير موجود',
    'unfollowedFootballChannel': 'تم إلغاء متابعة قناة كرة القدم',
    'followingFootballChannel': 'متابع قناة كرة القدم! ستشاهد التحديثات في خلاصتك',
    'failedToUpdateFollowStatus': 'فشل تحديث حالة المتابعة',
    'unknownLeague': 'دوري غير معروف',
    'halfTime': 'نصف الوقت',
    'tbd': 'لم يحدد',
    'justNow': 'الآن',
    'ago': 'منذ',
    'likedAPost': 'أعجب بمنشور',
    'commentedOnAPost': 'علق على منشور',
    'followed': 'تابع',
    'createdAPost': 'أنشأ منشور',
    'repliedToAComment': 'رد على تعليق',
    'didSomething': 'قام بشيء',
    'someone': 'شخص ما',
    'likedYourComment': 'أعجب بتعليقك',
    'likedYourPost': 'أعجب بمنشورك',
    'commentedOnYourPost': 'علق على منشورك',
    'mentionedYouInAComment': 'ذكرك في تعليق',
    'startedFollowingYou': 'بدأ بمتابعتك',
    'challengedYouToAChessGame': 'تحداك في لعبة شطرنج',
    'sentYouAMessage': 'أرسل لك رسالة',
    'addedYouAsAContributor': 'أضافك كمساهم في',
    'edited': 'عدل',
    'newNotification': 'إشعار جديد',
    'now': 'الآن',
    'youWillSeeNotifications': 'سترى الإشعارات عندما يعجب شخص ما أو يعلق أو يتابعك',
    'selected': 'المحدد',
    'cities': 'مدن',
    'isAlreadySelected': 'محدد بالفعل',
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

  const t = useCallback((key: string): string => {
    return translations[language][key] || key;
  }, [language]);

  const tn = useCallback((key: string, params?: Record<string, string | number>): string => {
    const base = translations[language][key] || key;
    if (!params) return base;
    return Object.keys(params).reduce((acc, k) => {
      const v = params[k];
      return acc.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v));
    }, base);
  }, [language]);

  // Force isRTL to always be false to keep LTR layout
  // Text will be in Arabic when language is 'ar', but layout stays Left-to-Right
  const isRTL = false; // Always LTR layout regardless of language

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, tn, isRTL }}>
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
