import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useUser } from '../context/UserContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';

type Props = {
  visible: boolean;
  onClose: () => void;
  post: any;
  onContributorRemoved?: (updated: any) => void;
};

const ManageContributorsModal: React.FC<Props> = ({
  visible,
  onClose,
  post,
  onContributorRemoved,
}) => {
  const { user } = useUser();
  const { t } = useLanguage();
  const { colors } = useTheme();
  const showToast = useShowToast();

  const [loadingPost, setLoadingPost] = useState(false);
  const [populatedPost, setPopulatedPost] = useState<any>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const currentPost = populatedPost || post;
  const postOwnerId = currentPost?.postedBy?._id?.toString();
  const currentUserId = user?._id?.toString();
  const contributors = currentPost?.contributors || [];

  const reset = useCallback(() => {
    setPopulatedPost(null);
    setRemovingId(null);
  }, []);

  useEffect(() => {
    if (!visible || !post?._id) return;
    const first = post.contributors?.[0];
    const needFetch =
      typeof first === 'string' || (first && typeof first === 'object' && !first?.name);
    if (!needFetch) {
      setPopulatedPost(post);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingPost(true);
      try {
        const data = await apiService.get(`${ENDPOINTS.GET_POST}/${post._id}`);
        if (!cancelled && data) setPopulatedPost(data);
      } catch {
        if (!cancelled) setPopulatedPost(post);
      } finally {
        if (!cancelled) setLoadingPost(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, post?._id]);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const handleRemove = (contributorId: string, contributorName: string, opts?: { isSelf?: boolean }) => {
    const isSelf = !!opts?.isSelf;
    Alert.alert(
      isSelf ? 'Leave collaborative post' : t('removeContributor'),
      isSelf
        ? 'Are you sure you want to leave this collaborative post?'
        : t('removeContributorQuestion').replace('{{name}}', contributorName),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: isSelf ? 'Leave' : t('remove'),
          style: 'destructive',
          onPress: async () => {
            if (!currentPost?._id) return;
            setRemovingId(contributorId);
            try {
              const data: any = await apiService.delete(
                `${ENDPOINTS.REMOVE_CONTRIBUTOR}/${currentPost._id}/contributor/${contributorId}`
              );
              showToast(t('success'), t('contributorRemoved'), 'success');
              if (data?.post) {
                onContributorRemoved?.(data.post);
              } else {
                try {
                  const fresh = await apiService.get(`${ENDPOINTS.GET_POST}/${currentPost._id}`);
                  onContributorRemoved?.(fresh);
                } catch {
                  /* keep modal open; feed can refresh later */
                }
              }
              onClose();
            } catch (e: any) {
              showToast(t('error'), e?.message || t('failedToRemoveContributor'), 'error');
            } finally {
              setRemovingId(null);
            }
          },
        },
      ]
    );
  };

  const nonOwner = contributors.filter((c: any) => {
    const id = (c._id || c)?.toString();
    return id && id !== postOwnerId;
  });
  const isOwner = !!postOwnerId && !!currentUserId && postOwnerId === currentUserId;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.backgroundLight }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>{t('manageContributors')}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.sheetBody} contentContainerStyle={{ paddingBottom: 24 }}>
            {loadingPost ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
            ) : (
              <>
                {currentPost?.postedBy && (
                  <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textGray }]}>
                      {t('postOwner')}
                    </Text>
                    <View style={[styles.row, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      {currentPost.postedBy.profilePic ? (
                        <Image source={{ uri: currentPost.postedBy.profilePic }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, styles.avatarPh, { backgroundColor: colors.avatarBg }]}>
                          <Text style={styles.avatarTxt}>
                            {(currentPost.postedBy.name || currentPost.postedBy.username || '?')[0]?.toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.userInfo}>
                        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                          {currentPost.postedBy.name}
                        </Text>
                        <Text style={[styles.sub, { color: colors.textGray }]} numberOfLines={1}>
                          @{currentPost.postedBy.username}
                        </Text>
                      </View>
                      <Text style={[styles.badge, { color: colors.primary }]}>{t('owner')}</Text>
                    </View>
                  </View>
                )}

                {nonOwner.length > 0 && (
                  <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textGray }]}>
                      {t('contributors')} ({nonOwner.length})
                    </Text>
                    {nonOwner.map((contributor: any) => {
                      const contributorId = (contributor._id || contributor).toString();
                      const contributorName = contributor?.name || contributor?.username || '?';
                      const isSelf = !!currentUserId && contributorId === currentUserId;
                      const canRemove = isOwner || isSelf;
                      return (
                        <View
                          key={contributorId}
                          style={[styles.row, { backgroundColor: colors.background, borderColor: colors.border }]}
                        >
                          {contributor?.profilePic ? (
                            <Image source={{ uri: contributor.profilePic }} style={styles.avatar} />
                          ) : (
                            <View style={[styles.avatar, styles.avatarPh, { backgroundColor: colors.avatarBg }]}>
                              <Text style={styles.avatarTxt}>{contributorName[0]?.toUpperCase()}</Text>
                            </View>
                          )}
                          <View style={styles.userInfo}>
                            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                              {contributorName}
                            </Text>
                            <Text style={[styles.sub, { color: colors.textGray }]} numberOfLines={1}>
                              @{contributor?.username || '—'}
                            </Text>
                          </View>
                          {canRemove && (
                            <TouchableOpacity
                              style={styles.rowAction}
                              onPress={() => handleRemove(contributorId, contributorName, { isSelf })}
                              disabled={removingId === contributorId}
                            >
                              {removingId === contributorId ? (
                                <ActivityIndicator color={colors.error} />
                              ) : (
                                <Text style={{ color: colors.error }}>{isSelf ? 'Leave' : t('remove')}</Text>
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                {!loadingPost && nonOwner.length === 0 && (
                  <Text style={{ color: colors.textGray, textAlign: 'center', marginTop: 16 }}>
                    {t('noContributorsYet')}
                  </Text>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  sheetBody: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    direction: 'ltr',
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  rowAction: {
    marginLeft: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  avatarPh: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarTxt: {
    color: '#fff',
    fontWeight: '700',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    width: '100%',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  sub: {
    fontSize: 13,
    width: '100%',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 10,
  },
});

export default ManageContributorsModal;
