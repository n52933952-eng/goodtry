import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { launchCamera, launchImageLibrary, Asset } from 'react-native-image-picker';

export const useImagePicker = () => {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageData, setImageData] = useState<Asset | null>(null);

  const pickImage = async (useCamera: boolean = false) => {
    try {
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

  const clearImage = () => {
    setImageUri(null);
    setImageData(null);
  };

  return {
    imageUri,
    imageData,
    pickImage,
    clearImage,
  };
};
