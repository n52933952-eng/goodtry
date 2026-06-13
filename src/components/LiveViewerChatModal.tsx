import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { useUser } from '../context/UserContext';
import { LiveChatMessage, useLiveBroadcast } from '../context/LiveBroadcastContext';

type Props = {
  visible: boolean;
  onClose: () => void;
};

const MODAL_HEIGHT_RATIO = 0.52;
const MODAL_MIN_HEIGHT = 360;
const MODAL_MAX_HEIGHT = 480;

const LiveViewerChatModal: React.FC<Props> = ({ visible, onClose }) => {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const modalHeight = Math.min(
    MODAL_MAX_HEIGHT,
    Math.max(MODAL_MIN_HEIGHT, Math.round(winH * MODAL_HEIGHT_RATIO)),
  );
  const { colors } = useTheme();
  const { t } = useLanguage();
  const { user } = useUser();
  const { liveChatMessages, sendChat, addLiveChatMessage } = useLiveBroadcast();
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList<LiveChatMessage>>(null);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [visible, liveChatMessages.length]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    const sender = user?.name || user?.username || 'Streamer';
    await sendChat(text, sender);
    addLiveChatMessage(sender, text);
    setInput('');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          <Pressable
            style={[
              styles.card,
              {
                height: modalHeight,
                backgroundColor: colors.backgroundLight,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.text }]}>{t('liveViewerMessages')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.close, { color: colors.textGray }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.listWrap}>
              <FlatList
                ref={listRef}
                style={styles.list}
                data={liveChatMessages}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                contentContainerStyle={
                  liveChatMessages.length === 0
                    ? styles.listEmptyContent
                    : styles.listContent
                }
                ListEmptyComponent={
                  <Text style={[styles.empty, { color: colors.textGray }]}>{t('noMessagesYet')}</Text>
                }
                renderItem={({ item }) => (
                  <View style={styles.row}>
                    <Text style={[styles.sender, { color: colors.primary }]}>{item.sender}</Text>
                    <Text style={[styles.body, { color: colors.text }]}>{item.text}</Text>
                  </View>
                )}
              />
            </View>

            <View style={[styles.inputRow, { borderTopColor: colors.border }]}>
              <TextInput
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
                ]}
                placeholder={t('liveChatPlaceholder')}
                placeholderTextColor={colors.textGray}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={() => { void sendMessage(); }}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: colors.primary }]}
                onPress={() => { void sendMessage(); }}
                activeOpacity={0.85}
              >
                <Text style={[styles.sendText, { color: colors.buttonText }]}>{t('send')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  keyboard: {
    width: '100%',
  },
  card: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  close: {
    fontSize: 20,
    fontWeight: '600',
  },
  listWrap: {
    flex: 1,
    minHeight: 0,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingBottom: 16,
  },
  listEmptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  empty: {
    textAlign: 'center',
    fontSize: 14,
  },
  row: {
    marginBottom: 10,
  },
  sender: {
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 2,
  },
  body: {
    fontSize: 15,
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 15,
  },
  sendBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  sendText: {
    fontWeight: '700',
    fontSize: 14,
  },
});

export default LiveViewerChatModal;
