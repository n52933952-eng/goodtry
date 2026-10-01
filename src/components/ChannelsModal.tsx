import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  TextInput,
} from 'react-native';
import { COLORS } from '../utils/constants';
import { apiService } from '../services/api';
import { useShowToast } from '../hooks/useShowToast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';

interface Channel {
  id: string;
  name: string;
  username: string;
  bio: string;
  category: string;
  thumbnail?: string;
  streams: Array<{
    name: string;
    buttonColor: string;
    thumbnail?: string;
  }>;
}

interface SavedLink {
  _id: string;
  title?: string;
  thumbnail?: string;
  provider?: string;
}

interface ChannelsModalProps {
  visible: boolean;
  onClose: () => void;
  /** postId + optional full post for instant feed inject */
  onChannelFollowed?: (postId?: string, post?: any) => void;
}

const ChannelsModal: React.FC<ChannelsModalProps> = ({
  visible,
  onClose,
  onChannelFollowed,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useShowToast();
  
  const [channels, setChannels] = useState<Channel[]>([]);
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [addUrl, setAddUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [streamLoading, setStreamLoading] = useState<{ [key: string]: boolean }>({});
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      fetchChannels();
    }
  }, [visible]);

  const fetchChannels = async () => {
    try {
      setLoading(true);
      const channelsData = await apiService.get('/api/news/channels');
      if (channelsData?.channels) {
        setChannels(channelsData.channels);
      }
      if (Array.isArray(channelsData?.links)) {
        setLinks(channelsData.links);
      }
    } catch (error) {
      console.error('Error fetching channels:', error);
      showToast('Error', 'Failed to load channels', 'error');
    } finally {
      setLoading(false);
    }
  };


  const handleStreamClick = async (channelId: string, streamIndex: number) => {
    const loadingKey = `${channelId}-${streamIndex}`;
    try {
      setStreamLoading(prev => ({ ...prev, [loadingKey]: true }));

      const data = await apiService.post(
        `/api/news/post/livestream?channelId=${encodeURIComponent(channelId)}&streamIndex=${streamIndex}`,
        { text: caption.trim() },
      );

      const channel = channels.find(c => c.id === channelId);
      onClose();
      if (data?.posted === false) {
        showToast('Info', data?.message || 'Already in your feed', 'info');
        return;
      }
      showToast('Success', `🔴 ${channel?.name} added to your feed!`, 'success');
      onChannelFollowed?.(
        data?.postId ? String(data.postId) : undefined,
        data?.post || undefined,
      );
    } catch (error) {
      console.error('Error creating stream post:', error);
      showToast('Error', 'Failed to add live stream', 'error');
    } finally {
      setStreamLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  const saveLink = async () => {
    const typed = addUrl.trim();
    const url = /^https?:\/\//i.test(typed) ? typed : `https://${typed}`;
    if (!typed || addBusy) return;
    setAddBusy(true);
    try {
      const data = await apiService.post('/api/news/links', { url });
      if (data?.link) {
        setLinks((prev) => [data.link, ...prev.filter((item) => item._id !== data.link._id)]);
      }
      setAddUrl('');
      showToast('Success', 'Link added', 'success');
    } catch (error: any) {
      showToast('Error', error?.message || 'Could not add link', 'error');
    } finally {
      setAddBusy(false);
    }
  };

  const hideChannel = async (channelId: string) => {
    try {
      await apiService.post('/api/news/channels/hide', { channelId });
      setChannels((prev) => prev.filter((c) => c.id !== channelId));
      setExpandedChannel(null);
    } catch (error: any) {
      showToast('Error', error?.message || 'Could not remove channel', 'error');
    }
  };

  const watchLink = async (link: SavedLink) => {
    const loadingKey = `link-${link._id}`;
    setStreamLoading((prev) => ({ ...prev, [loadingKey]: true }));
    try {
      const data = await apiService.post(`/api/news/links/${link._id}/watch`, { text: caption.trim() });
      onClose();
      if (data?.posted === false) {
        showToast('Info', 'Already in your feed', 'info');
        return;
      }
      showToast('Success', 'Added to your feed', 'success');
      onChannelFollowed?.(data?.postId ? String(data.postId) : undefined, data?.post);
    } catch (error: any) {
      showToast('Error', error?.message || 'Could not add to feed', 'error');
    } finally {
      setStreamLoading((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const shareVideo = async (body: { linkId?: string; channelId?: string; streamIndex?: number }) => {
    try {
      const data = await apiService.post('/api/news/share', { ...body, text: caption.trim() });
      showToast('Success', 'Shared to your followers', 'success');
      onClose();
    } catch (error: any) {
      showToast('Error', error?.message || 'Could not share', 'error');
    }
  };

  const removeLink = async (linkId: string) => {
    try {
      await apiService.delete(`/api/news/links/${linkId}`);
      setLinks((prev) => prev.filter((item) => item._id !== linkId));
      setExpandedChannel(null);
    } catch (error: any) {
      showToast('Error', error?.message || 'Could not remove link', 'error');
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'news':
        return '📰';
      case 'kids':
        return '🧒';
      default:
        return '🎬';
    }
  };

  const colorMap: { [key: string]: string } = {
    red: '#EF4444',
    blue: '#3B82F6',
    purple: '#A855F7',
    green: '#10B981',
    orange: '#F97316',
    teal: '#14B8A6',
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={[styles.modalContent, { backgroundColor: colors.backgroundLight }]} onPress={() => {}}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>📺 Channels</Text>
            <TouchableOpacity style={styles.removeX} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.removeXText}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <ScrollView 
              style={styles.scrollView} 
              contentContainerStyle={[styles.scrollContent, { paddingBottom: 20 + insets.bottom }]}
              showsVerticalScrollIndicator={false}
            >
              {/* Live Stream Channels */}
              <View style={styles.addRow}>
                <View style={styles.addInputWrap}>
                <TextInput
                  style={[styles.addInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }, addUrl ? styles.addInputWithClear : null]}
                  placeholder="Paste any link"
                  placeholderTextColor={colors.textGray}
                  value={addUrl}
                  onChangeText={setAddUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  showSoftInputOnFocus={false}
                  caretHidden={false}
                />
                {addUrl ? (
                  <TouchableOpacity style={styles.clearLink} onPress={() => setAddUrl('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.clearLinkText}>✕</Text>
                  </TouchableOpacity>
                ) : null}
                </View>
                <TouchableOpacity style={[styles.addButton, { backgroundColor: colors.primary }]} onPress={saveLink} disabled={addBusy}>
                  {addBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.addButtonText}>+</Text>}
                </TouchableOpacity>
              </View>
              {(channels.length > 0 || links.length > 0) && (
                <View style={styles.liveChannelsSection}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>🔴 Live Channels</Text>
                  <View style={styles.liveChannelsGrid}>
                    {channels.map((channel) => (
                      <View
                        key={channel.id}
                        style={[
                          styles.liveChannelCard,
                          { backgroundColor: colors.cardBg, borderColor: colors.border },
                          expandedChannel === channel.id && styles.expandedChannelCard,
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.liveChannelHeader}
                          onPress={() =>
                            setExpandedChannel(expandedChannel === channel.id ? null : channel.id)
                          }
                        >
                          {channel.thumbnail ? (
                            <Image source={{ uri: channel.thumbnail }} style={styles.thumb} />
                          ) : (
                          <View style={[styles.liveChannelAvatar, { backgroundColor: colors.avatarBg }]}>
                            <Text style={styles.liveChannelAvatarText}>
                              {channel.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          )}
                          <View style={styles.liveChannelInfo}>
                            <Text style={[styles.liveChannelName, { color: colors.cardText }]} numberOfLines={1}>
                              {channel.name}
                            </Text>
                            <Text style={styles.liveChannelCategory}>
                              {getCategoryIcon(channel.category)}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.removeX}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            onPress={() => hideChannel(channel.id)}
                          >
                            <Text style={styles.removeXText}>✕</Text>
                          </TouchableOpacity>
                        </TouchableOpacity>

                        {expandedChannel === channel.id && (
                          <View style={styles.expandedContent}>
                            <Text style={[styles.channelBio, { color: colors.cardText }]}>{channel.bio}</Text>
                            <TextInput
                              style={[styles.addInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background, marginBottom: 10 }]}
                              placeholder="Write something (optional)"
                              placeholderTextColor={colors.textGray}
                              value={caption}
                              onChangeText={setCaption}
                            />
                            <View style={styles.streamsContainer}>
                              {channel.streams.map((stream, index) => {
                                const loadingKey = `${channel.id}-${index}`;
                                const isLoading = streamLoading[loadingKey];
                                const showLanguage = channel.streams.length > 1 && !!stream.name;
                                return (
                                  <View key={index} style={styles.streamGroup}>
                                    {showLanguage ? (
                                      <Text style={[styles.streamLanguage, { color: colors.text }]}>{stream.name}</Text>
                                    ) : null}
                                    <TouchableOpacity
                                      style={[
                                        styles.streamButton,
                                        { backgroundColor: colorMap[stream.buttonColor] || COLORS.primary },
                                      ]}
                                      onPress={() => handleStreamClick(channel.id, index)}
                                      disabled={isLoading}
                                    >
                                      {isLoading ? (
                                        <ActivityIndicator size="small" color="#FFFFFF" />
                                      ) : (
                                        <>
                                          <View style={styles.liveDot} />
                                          <Text style={styles.streamButtonText}>Add to my feed</Text>
                                        </>
                                      )}
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.streamButton, { backgroundColor: colors.border }]}
                                      onPress={() => shareVideo({ channelId: channel.id, streamIndex: index })}
                                    >
                                      <Text style={[styles.streamButtonText, { color: colors.text }]}>Share to feed</Text>
                                    </TouchableOpacity>
                                  </View>
                                );
                              })}
                              <TouchableOpacity onPress={() => hideChannel(channel.id)}>
                                <Text style={{ color: colors.textGray, textAlign: 'center', fontWeight: '600' }}>Remove</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.streamButton, { backgroundColor: colors.border }]}
                                onPress={() => setExpandedChannel(null)}
                              >
                                <Text style={[styles.streamButtonText, { color: colors.text }]}>Close</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>
                    ))}
                    {links.map((link) => (
                      <View
                        key={link._id}
                        style={[
                          styles.liveChannelCard,
                          { backgroundColor: colors.cardBg, borderColor: colors.border },
                          expandedChannel === `link:${link._id}` && styles.expandedChannelCard,
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.liveChannelHeader}
                          onPress={() => setExpandedChannel(expandedChannel === `link:${link._id}` ? null : `link:${link._id}`)}
                        >
                          {link.thumbnail ? (
                            <Image source={{ uri: link.thumbnail }} style={styles.thumb} />
                          ) : (
                            <View style={[styles.liveChannelAvatar, { backgroundColor: colors.avatarBg }]}>
                              <Text style={styles.liveChannelAvatarText}>▶</Text>
                            </View>
                          )}
                          <View style={styles.liveChannelInfo}>
                            <Text style={[styles.liveChannelName, { color: colors.cardText }]} numberOfLines={1}>
                              {link.title || 'Video'}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.removeX}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            onPress={() => removeLink(link._id)}
                          >
                            <Text style={styles.removeXText}>✕</Text>
                          </TouchableOpacity>
                        </TouchableOpacity>
                        {expandedChannel === `link:${link._id}` && (
                          <View style={styles.expandedContent}>
                            <TextInput
                              style={[styles.addInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background, marginBottom: 10 }]}
                              placeholder="Write something (optional)"
                              placeholderTextColor={colors.textGray}
                              value={caption}
                              onChangeText={setCaption}
                            />
                            <TouchableOpacity
                              style={[styles.streamButton, { backgroundColor: colors.primary }]}
                              onPress={() => watchLink(link)}
                              disabled={!!streamLoading[`link-${link._id}`]}
                            >
                              {streamLoading[`link-${link._id}`] ? (
                                <ActivityIndicator color="#fff" size="small" />
                              ) : (
                                <Text style={styles.streamButtonText}>Add to my feed</Text>
                              )}
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.streamButton, { backgroundColor: colors.border }]}
                              onPress={() => shareVideo({ linkId: link._id })}
                            >
                              <Text style={[styles.streamButtonText, { color: colors.text }]}>Share to feed</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => removeLink(link._id)}>
                              <Text style={{ color: colors.textGray, textAlign: 'center', fontWeight: '600' }}>Remove</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.streamButton, { backgroundColor: colors.border }]}
                              onPress={() => setExpandedChannel(null)}
                            >
                              <Text style={[styles.streamButtonText, { color: colors.text }]}>Close</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.backgroundLight,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '90%',
    maxHeight: '90%',
    flexDirection: 'column',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexShrink: 0,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  modalCloseButton: {
    fontSize: 24,
    color: COLORS.textGray,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  liveChannelsSection: {
    padding: 15,
    padding: 15,
    paddingTop: 0,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 15,
  },
  liveChannelsGrid: {
    gap: 12,
  },
  liveChannelCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  expandedChannelCard: {
    borderColor: COLORS.primary,
    borderWidth: 2,
  },
  liveChannelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  removeX: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E11D48',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  removeXText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  liveChannelAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  thumb: {
    width: 56,
    height: 40,
    borderRadius: 6,
    marginRight: 12,
    backgroundColor: '#111',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 15,
    paddingTop: 12,
  },
  addInputWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  addInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  addInputWithClear: {
    paddingRight: 36,
  },
  clearLink: {
    position: 'absolute',
    right: 8,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearLinkText: {
    color: '#E11D48',
    fontSize: 16,
    fontWeight: '700',
  },
  addButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  liveChannelAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  liveChannelInfo: {
    flex: 1,
  },
  liveChannelName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  liveChannelCategory: {
    fontSize: 14,
  },
  expandedContent: {
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  channelBio: {
    fontSize: 13,
    color: COLORS.textGray,
    marginBottom: 15,
    lineHeight: 18,
  },
  streamsContainer: {
    gap: 14,
  },
  streamGroup: {
    gap: 8,
  },
  streamLanguage: {
    fontSize: 15,
    fontWeight: '700',
  },
  streamButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  streamButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});

export default ChannelsModal;
