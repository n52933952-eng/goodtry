import { Alert, ToastAndroid, Platform } from 'react-native';

type ToastStatus = 'success' | 'error' | 'info' | 'warning';

export const useShowToast = () => {
  const showToast = (title: string, description?: string, status: ToastStatus = 'info') => {
    const message = description ? `${title}\n${description}` : title;

    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert(
        title,
        description,
        [{ text: 'OK' }],
        { cancelable: true }
      );
    }
  };

  return showToast;
};
