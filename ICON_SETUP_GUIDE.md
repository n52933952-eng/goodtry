# App Icon & Splash Screen Setup Guide

## 📱 Image Requirements

You have 3 images with different sizes. Here's what you need:

### **App Icon Sizes (for mipmap folders):**
- **mipmap-mdpi**: 48x48 px
- **mipmap-hdpi**: 72x72 px  
- **mipmap-xhdpi**: 96x96 px
- **mipmap-xxhdpi**: 144x144 px
- **mipmap-xxxhdpi**: 192x192 px

### **Notification Icon Sizes (for drawable folders):**
- **drawable-mdpi**: 24x24 px (white/transparent)
- **drawable-hdpi**: 36x36 px (white/transparent)
- **drawable-xhdpi**: 48x48 px (white/transparent)
- **drawable-xxhdpi**: 72x72 px (white/transparent)
- **drawable-xxxhdpi**: 96x96 px (white/transparent)

**Important**: Notification icons must be **white/transparent** (not colored) for Android 5.0+

## 🎨 Steps to Set Up:

### 1. **Choose Your Image**
Look at your 3 images and pick the one that's closest to these sizes:
- For app icon: 192x192 px or larger (we'll resize)
- For notification: Can be any size (we'll convert to white)

### 2. **Convert PNG to Icons**

You can use online tools like:
- https://www.appicon.co/
- https://icon.kitchen/
- Or use Android Studio's Image Asset Studio

### 3. **Place Files**

**App Icons** (colored, with gradient background):
- Copy to: `android/app/src/main/res/mipmap-*/ic_launcher.png`
- Copy to: `android/app/src/main/res/mipmap-*/ic_launcher_round.png` (same image)

**Notification Icons** (white/transparent):
- Convert your image to white/transparent
- Copy to: `android/app/src/main/res/drawable-*/ic_notification.png`

### 4. **Splash Screen**
✅ Already configured! It will use your app icon automatically.

## 🔧 Quick Setup (If you have one image):

1. **Resize your image** to 192x192 px (or use the largest of your 3 images)
2. **Copy to all mipmap folders** with name `ic_launcher.png` and `ic_launcher_round.png`
3. **For notifications**: Create a white version and place in drawable folders as `ic_notification.png`

## 📝 File Locations:

```
android/app/src/main/res/
├── mipmap-mdpi/
│   ├── ic_launcher.png (48x48)
│   └── ic_launcher_round.png (48x48)
├── mipmap-hdpi/
│   ├── ic_launcher.png (72x72)
│   └── ic_launcher_round.png (72x72)
├── mipmap-xhdpi/
│   ├── ic_launcher.png (96x96)
│   └── ic_launcher_round.png (96x96)
├── mipmap-xxhdpi/
│   ├── ic_launcher.png (144x144)
│   └── ic_launcher_round.png (144x144)
├── mipmap-xxxhdpi/
│   ├── ic_launcher.png (192x192)
│   └── ic_launcher_round.png (192x192)
└── drawable-*/
    └── ic_notification.png (white/transparent versions)
```

## ✅ After Setup:

1. Rebuild the app: `npx react-native run-android`
2. The splash screen will show your icon on a gradient background
3. The app icon will appear on the phone home screen
4. Notifications will use your custom icon instead of default Android icon
