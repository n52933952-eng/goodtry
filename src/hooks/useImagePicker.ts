import { useState } from 'react';
import { Alert, Platform, PermissionsAndroid } from 'react-native';
import { launchCamera, launchImageLibrary, Asset } from 'react-native-image-picker';
import {
  pick,
  types,
  keepLocalCopy,
  isErrorWithCode,
  errorCodes,
} from '@react-native-documents/picker';
import { useLanguage } from '../context/LanguageContext';
import {
  MAX_POST_VIDEO_DURATION_SEC,
  MAX_POST_AUDIO_DURATION_SEC,
  isVideoAsset,
  isVideoWithinMaxDuration,
  isAudioWithinMaxDuration,
} from '../utils/videoDuration';

export const MAX_CAROUSEL_PHOTOS = 4;

export type PickedAudio = {
  uri: string;
  type: string;
  fileName: string;
};

export const useImagePicker = () => {
  const { t } = useLanguage();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageData, setImageData] = useState<Asset | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [carouselImages, setCarouselImages] = useState<Asset[]>([]);
  const [audioFile, setAudioFile] = useState<PickedAudio | null>(null);

  const showVideoTooLongAlert = () => {
    Alert.alert(t('postVideoTooLongTitle'), t('postVideoTooLongBody'));
  };

  const rejectLongVideo = (asset: Asset): boolean => {
    if (!isVideoAsset(asset)) return false;
    if (isVideoWithinMaxDuration(asset, MAX_POST_VIDEO_DURATION_SEC)) return false;
    showVideoTooLongAlert();
    return true;
  };

  const acceptMediaAsset = (asset: Asset): Asset | null => {
    if (rejectLongVideo(asset)) return null;
    const looksVideo = isVideoAsset(asset);
    setCarouselImages([]);
    setAudioFile(null);
    setIsVideo(looksVideo);
    setImageUri(asset.uri || null);
    setImageData(asset);
    return asset;
  };

  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      return true; // iOS handles permissions automatically
    }

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'This app needs access to your camera to take photos.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn('Camera permission error:', err);
      return false;
    }
  };

  const requestMicPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      return true;
    }
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'This app needs microphone access to record video with sound.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn('Microphone permission error:', err);
      return false;
    }
  };

  const pickImage = async (useCamera: boolean = false) => {
    try {
      // Request camera permission if using camera
      if (useCamera) {
        const hasPermission = await requestCameraPermission();
        if (!hasPermission) {
          Alert.alert(
            'Permission Denied',
            'Camera permission is required to take photos. Please enable it in your device settings.'
          );
          return null;
        }
      }

      const options = {
        mediaType: 'photo' as const,
        quality: 0.8 as const,
        maxWidth: 1024,
        maxHeight: 1024,
      };

      const result = useCamera
        ? await launchCamera(options)
        : await launchImageLibrary(options);

      if (result.didCancel) {
        return null;
      }

      if (result.errorCode) {
        Alert.alert('Error', result.errorMessage || 'Failed to pick image');
        return null;
      }

      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setCarouselImages([]);
        setAudioFile(null);
        setIsVideo(false);
        setImageUri(asset.uri || null);
        setImageData(asset);
        return asset;
      }

      return null;
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
      return null;
    }
  };

  /** Gallery: user can pick a photo or a video (same as “image or video”). */
  const pickMixedFromGallery = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 1,
        includeExtra: true,
      });

      if (result.didCancel) {
        return null;
      }
      if (result.errorCode) {
        Alert.alert('Error', result.errorMessage || 'Failed to pick media');
        return null;
      }
      if (result.assets && result.assets.length > 0) {
        return acceptMediaAsset(result.assets[0]);
      }
      return null;
    } catch (error) {
      console.error('Error picking media:', error);
      Alert.alert('Error', 'Failed to pick media');
      return null;
    }
  };

  const pickVideoFromCamera = async () => {
    try {
      const hasCam = await requestCameraPermission();
      if (!hasCam) {
        Alert.alert(
          'Permission Denied',
          'Camera permission is required to record video.'
        );
        return null;
      }
      if (Platform.OS === 'android') {
        const hasMic = await requestMicPermission();
        if (!hasMic) {
          Alert.alert(
            'Permission Denied',
            'Microphone permission is needed to record video with sound.'
          );
          return null;
        }
      }

      const result = await launchCamera({
        mediaType: 'video',
        videoQuality: 'medium',
        durationLimit: MAX_POST_VIDEO_DURATION_SEC,
      });

      if (result.didCancel) {
        return null;
      }
      if (result.errorCode) {
        Alert.alert('Error', result.errorMessage || 'Failed to record video');
        return null;
      }
      if (result.assets && result.assets.length > 0) {
        return acceptMediaAsset(result.assets[0]);
      }
      return null;
    } catch (error) {
      console.error('Error recording video:', error);
      Alert.alert('Error', 'Failed to record video');
      return null;
    }
  };

  /** Pick up to 4 photos for an Instagram-style carousel (photos only). */
  const pickMultiplePhotos = async () => {
    try {
      const remaining = MAX_CAROUSEL_PHOTOS - carouselImages.length;
      if (remaining <= 0) {
        Alert.alert(t('error'), t('carouselMaxPhotos'));
        return null;
      }

      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: remaining,
        quality: 0.85,
        maxWidth: 2048,
        maxHeight: 2048,
      });

      if (result.didCancel) return null;
      if (result.errorCode) {
        Alert.alert('Error', result.errorMessage || 'Failed to pick photos');
        return null;
      }

      const assets = (result.assets || []).filter((a) => a.uri && !isVideoAsset(a));
      if (!assets.length) return null;

      setImageUri(null);
      setImageData(null);
      setIsVideo(false);
      setCarouselImages((prev) => [...prev, ...assets].slice(0, MAX_CAROUSEL_PHOTOS));
      return assets;
    } catch (error) {
      console.error('Error picking photos:', error);
      Alert.alert('Error', 'Failed to pick photos');
      return null;
    }
  };

  /** Pick MP3/audio from device storage (Files, Downloads, Music, etc.). */
  const pickAudioFile = async () => {
    try {
      const results = await pick({
        type: [types.audio, 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a'],
        allowMultiSelection: false,
      });

      const result = results[0];
      if (!result?.uri) return null;

      const fileName = result.name || `audio_${Date.now()}.mp3`;
      let uri = result.uri;
      const mime = result.type || 'audio/mpeg';

      try {
        const [copyResult] = await keepLocalCopy({
          files: [{ uri: result.uri, fileName }],
          destination: 'cachesDirectory',
        });
        if (copyResult.status === 'success' && copyResult.localUri) {
          uri = copyResult.localUri;
        }
      } catch (copyErr) {
        console.warn('[pickAudioFile] keepLocalCopy failed, using original uri', copyErr);
      }

      const withinLimit = await isAudioWithinMaxDuration(uri, MAX_POST_AUDIO_DURATION_SEC);
      if (!withinLimit) {
        Alert.alert(t('postAudioTooLongTitle'), t('postAudioTooLongBody'));
        return null;
      }

      const picked: PickedAudio = {
        uri,
        type: mime,
        fileName,
      };
      setAudioFile(picked);
      return picked;
    } catch (error) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
        return null;
      }
      console.error('Error picking audio:', error);
      Alert.alert(t('error'), t('failedToPickAudio'));
      return null;
    }
  };

  const clearAudio = () => setAudioFile(null);

  const removeCarouselImage = (index: number) => {
    setCarouselImages((prev) => prev.filter((_, i) => i !== index));
  };

  const clearCarousel = () => setCarouselImages([]);

  const clearImage = () => {
    setImageUri(null);
    setImageData(null);
    setIsVideo(false);
  };

  const clearAllMedia = () => {
    clearImage();
    clearCarousel();
    clearAudio();
  };

  return {
    imageUri,
    imageData,
    isVideo,
    carouselImages,
    audioFile,
    pickImage,
    pickMixedFromGallery,
    pickVideoFromCamera,
    pickMultiplePhotos,
    pickAudioFile,
    removeCarouselImage,
    clearImage,
    clearCarousel,
    clearAudio,
    clearAllMedia,
  };
};
