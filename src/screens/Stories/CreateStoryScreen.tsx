import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  TextInput,
} from 'react-native';
import { launchImageLibrary, Asset } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiService } from '../../services/api';
import { ENDPOINTS, STORY_STRIP_SHOULD_REFRESH } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';

const MAX_SLIDES = 15;
const MAX_VIDEO_SEC = 20;

const CreateStoryScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, tn } = useLanguage();
  const showToast = useShowToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState('');
  const EMOJIS = [
    '😂','😍','🥰','😘','😊','😎','🥳','🤯','😢','😭','😡','🤔',
    '👏','🙏','💯','✨','🔥','💥','⚡','🌟','🌈','☀️','🌤️','🌙',
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💖',
    '⚽','🏆','🎮','🎥','🎵','📌','✅','❌','📍','📝','📸','📣',
  ];

  const pickMedia = async () => {
    const result = await launchImageLibrary({
      mediaType: 'mixed',
      selectionLimit: MAX_SLIDES,
      includeExtra: true,
    });

    if (result.didCancel || !result.assets?.length) return;

    const next: Asset[] = [];
    for (const a of result.assets) {
      const mime = a.type || '';
      const uri = a.uri || '';
      const looksVideo = mime.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(uri);
      if (looksVideo) {
        const dur = typeof a.duration === 'number' ? a.duration : 0;
        const sec = dur > 1000 ? dur / 1000 : dur;
        if (sec > MAX_VIDEO_SEC + 0.5) {
          Alert.alert(t('videoTooLongTitle'), tn('videoTooLongBody', { sec: MAX_VIDEO_SEC }));
          continue;
        }
      }
      next.push(a);
    }

    if (!next.length) return;
    setAssets((prev) => [...prev, ...next].slice(0, MAX_SLIDES));
  };

  const removeAt = (i: number) => {
    setAssets((prev) => prev.filter((_, idx) => idx !== i));
  };

  const publish = async () => {
    if (!assets.length) {
      showToast('Error', 'Add at least one photo or video', 'error');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      const trimmedCaption = caption.trim();
      if (trimmedCaption) {
        formData.append('text', trimmedCaption.slice(0, 300));
      }
      for (const a of assets) {
        const uri = a.uri;
        if (!uri) continue;
        const mime = a.type || 'image/jpeg';
        const isVid = mime.startsWith('video/');
        const ext = isVid ? 'mp4' : 'jpg';
        const name = a.fileName || `story_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        formData.append('files', { uri, type: mime, name } as any);
      }

      const data = await apiService.upload(ENDPOINTS.STORY_CREATE, formData);
      const appended = !!(data as { appended?: boolean })?.appended;
      DeviceEventEmitter.emit(STORY_STRIP_SHOULD_REFRESH);
      showToast(t('success'), appended ? t('addedToYourStory') : t('storyPublished'), 'success');
      setAssets([]);
      setCaption('');
      navigation.goBack();
    } catch (e: any) {
      showToast(t('error'), e?.message || t('uploadFailed'), 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={{ color: colors.text, fontSize: 16 }}>{t('cancel')}</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t('newStory')}</Text>
        <TouchableOpacity onPress={publish} disabled={uploading || !assets.length}>
          {uploading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={{ color: assets.length ? colors.primary : colors.textGray, fontWeight: '700' }}>
              {t('share')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={[styles.hint, { color: colors.textGray }]}>
        Up to {MAX_SLIDES} per share · videos max {MAX_VIDEO_SEC}s · new posts add to your current story until it
        expires (24h)
      </Text>

      <TouchableOpacity
        style={[styles.addBtn, { borderColor: colors.border, backgroundColor: colors.backgroundLight }]}
        onPress={pickMedia}
        disabled={uploading}
      >
        <Text style={{ color: colors.primary, fontWeight: '600' }}>{t('pickPhotosVideos')}</Text>
      </TouchableOpacity>

      <View style={[styles.captionBox, { borderColor: colors.border, backgroundColor: colors.backgroundLight }]}>
        <Text style={{ color: colors.textGray, marginBottom: 6, fontSize: 12 }}>{t('storyTextOptional')}</Text>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder="Write something…"
          placeholderTextColor={colors.textGray}
          editable={!uploading}
          multiline
          maxLength={300}
          style={{ color: colors.text, minHeight: 40, fontSize: 15 }}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: 2 }}
        >
          {EMOJIS.map((e) => (
            <TouchableOpacity
              key={e}
              onPress={() => setCaption((prev) => `${prev}${e}`)}
              disabled={uploading}
              style={[
                styles.emojiBtn,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 18 }}>{e}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView horizontal style={styles.strip} contentContainerStyle={{ paddingVertical: 8 }}>
        {assets.map((a, i) => {
          const uri = a.uri || '';
          const isVid = (a.type || '').startsWith('video/');
          return (
            <View key={`${uri}-${i}`} style={styles.thumbWrap}>
              {isVid ? (
                <View style={[styles.thumb, { backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' }]}>
                  <Text style={{ color: '#fff' }}>▶</Text>
                </View>
              ) : (
                <Image source={{ uri }} style={styles.thumb} />
              )}
              <TouchableOpacity style={styles.removeX} onPress={() => removeAt(i)}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>×</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700' },
  hint: { fontSize: 13, marginBottom: 12 },
  addBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 12,
  },
  captionBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  emojiBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: 8,
  },
  strip: { flexGrow: 0 },
  thumbWrap: { marginRight: 10, position: 'relative' },
  thumb: { width: 72, height: 96, borderRadius: 8 },
  removeX: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default CreateStoryScreen;
