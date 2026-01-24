import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { API_URL, COLORS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';
import { useTheme } from '../context/ThemeContext';

interface Channel {
  id: string;
  name: string;
  username: string;
  bio: string;
  category: string;
  streams: Array<{
    name: string;
    buttonColor: string;
  }>;
}

interface ChannelsModalProps {
  visible: boolean;
  onClose: () => void;
  onChannelFollowed?: () => void;
}

const ChannelsModal: React.FC<ChannelsModalProps> = ({
  visible,
  onClose,
  onChannelFollowed,
}) => {
  const { colors } = useTheme();
  const showToast = useShowToast();
  
  const [channels, setChannels] = useState<Channel[]>([]);
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
      const baseUrl = API_URL;

      // Fetch live stream channels
      const channelsRes = await fetch(`${baseUrl}/api/news/channels`, {
        credentials: 'include',
      });
      const channelsData = await channelsRes.json();
      if (channelsRes.ok && channelsData.channels) {
        setChannels(channelsData.channels);
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

      const baseUrl = API_URL;
      const res = await fetch(
        `${baseUrl}/api/news/post/livestream?channelId=${channelId}&streamIndex=${streamIndex}`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );
      const data = await res.json();

      if (res.ok) {
        const channel = channels.find(c => c.id === channelId);
        showToast('Success', `🔴 ${channel?.name} added to your feed!`, 'success');
        // Close modal and refresh feed
        onClose();
        // Small delay to ensure post is created before refreshing
        setTimeout(() => {
          if (onChannelFollowed) {
            onChannelFollowed();
          }
        }, 500);
      } else {
        showToast('Info', data.message || 'Already in feed', 'info');
      }
    } catch (error) {
      console.error('Error creating stream post:', error);
      showToast('Error', 'Failed to add live stream', 'error');
    } finally {
      setStreamLoading(prev => ({ ...prev, [loadingKey]: false }));
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
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.backgroundLight }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>📺 Channels</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.modalCloseButton, { color: colors.textGray }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <ScrollView 
              style={styles.scrollView} 
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Live Stream Channels */}
              {channels.length > 0 && (
                <View style={styles.liveChannelsSection}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>🔴 Live Channels</Text>
                  <View style={styles.liveChannelsGrid}>
                    {channels.map((channel) => (
                      <TouchableOpacity
                        key={channel.id}
                        style={[
                          styles.liveChannelCard,
                          { backgroundColor: colors.cardBg, borderColor: colors.border },
                          expandedChannel === channel.id && styles.expandedChannelCard,
                        ]}
                        onPress={() =>
                          setExpandedChannel(expandedChannel === channel.id ? null : channel.id)
                        }
                      >
                        <View style={styles.liveChannelHeader}>
                          <View style={[styles.liveChannelAvatar, { backgroundColor: colors.avatarBg }]}>
                            <Text style={styles.liveChannelAvatarText}>
                              {channel.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.liveChannelInfo}>
                            <Text style={[styles.liveChannelName, { color: colors.cardText }]} numberOfLines={1}>
                              {channel.name}
                            </Text>
                            <Text style={styles.liveChannelCategory}>
                              {getCategoryIcon(channel.category)}
                            </Text>
                          </View>
                        </View>

                        {expandedChannel === channel.id && (
                          <View style={styles.expandedContent}>
                            <Text style={[styles.channelBio, { color: colors.cardText }]}>{channel.bio}</Text>
                            <View style={styles.streamsContainer}>
                              {channel.streams.map((stream, index) => {
                                const loadingKey = `${channel.id}-${index}`;
                                const isLoading = streamLoading[loadingKey];
                                return (
                                  <TouchableOpacity
                                    key={index}
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
                                        <Text style={styles.streamButtonText}>
                                          Watch Live {stream.name && `(${stream.name})`}
                                        </Text>
                                      </>
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
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
  liveChannelAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
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
    gap: 10,
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
