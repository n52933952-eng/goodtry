import { Platform, PermissionsAndroid } from 'react-native';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';

function iosGranted(result: string) {
  return result === RESULTS.GRANTED || result === RESULTS.LIMITED;
}

/**
 * Request camera + microphone for calls and live (not during a call).
 * Android: PermissionsAndroid. iOS: react-native-permissions (Info.plist strings).
 */
export async function requestCameraAndMicrophone(): Promise<{ camera: boolean; microphone: boolean }> {
  if (Platform.OS === 'android') {
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
    const cam = res[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;
    const mic = res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
    return { camera: cam, microphone: mic };
  }
  const cam = await request(PERMISSIONS.IOS.CAMERA);
  const mic = await request(PERMISSIONS.IOS.MICROPHONE);
  return {
    camera: iosGranted(cam),
    microphone: iosGranted(mic),
  };
}
