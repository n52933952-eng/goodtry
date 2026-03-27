import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useUser } from '../context/UserContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';
import CollaboratorPicker from './CollaboratorPicker';
import { CollaboratorUser } from '../utils/collaborators';

type Props = {
  visible: boolean;
  onClose: () => void;
  post: any;
  onContributorAdded?: (updated: any) => void;
};

const AddContributorModal: React.FC<Props> = ({
  visible,
  onClose,
  post,
  onContributorAdded,
}) => {
  const { user } = useUser();
  const { t } = useLanguage();
  const { colors } = useTheme();
  const showToast = useShowToast();

  const [selectedUsers, setSelectedUsers] = useState<CollaboratorUser[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  const existingContributorIds =
    post?.contributors?.map((c: any) => (c._id || c).toString()) || [];
  const postOwnerId = post?.postedBy?._id?.toString();

  const reset = useCallback(() => {
    setSelectedUsers([]);
    setIsAdding(false);
  }, []);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const excludeUserIds = [
    user?._id?.toString(),
    postOwnerId,
    ...existingContributorIds,
    ...selectedUsers.map((s) => s._id?.toString()).filter(Boolean),
  ].filter(Boolean) as string[];

  const handleSelectUser = (u: CollaboratorUser) => {
    if (!selectedUsers.some((x) => x._id === u._id)) {
      setSelectedUsers((prev) => [...prev, u]);
    }
  };

  const handleAddContributors = async () => {
    if (selectedUsers.length === 0 || !post?._id) {
      showToast(t('error'), t('selectAtLeastOneContributor'), 'error');
      return;
    }
    setIsAdding(true);
    try {
      const results = await Promise.all(
        selectedUsers.map(async (su) => {
          try {
            const data = await apiService.put(
              `${ENDPOINTS.ADD_CONTRIBUTOR}/${post._id}/contributor`,
              { contributorId: su._id }
            );
            return { ok: true, data, username: su.username };
          } catch (e: any) {
            return { ok: false, message: e?.message, username: su.username };
          }
        })
      );
      const successful = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      if (successful.length > 0) {
        const first = successful[0] as { ok: true; data: { post?: any } };
        const updated = first.data?.post;
        if (updated) {
          showToast(t('success'), t('contributorsAdded'), 'success');
          onContributorAdded?.(updated);
        } else {
          const fresh = await apiService.get(`${ENDPOINTS.GET_POST}/${post._id}`);
          showToast(t('success'), t('contributorsAdded'), 'success');
          onContributorAdded?.(fresh);
        }
        onClose();
        reset();
      }
      if (failed.length > 0 && successful.length === 0) {
        failed.forEach((f: any) => {
          showToast(t('error'), `${f.username}: ${f.message || t('failedToAddContributor')}`, 'error');
        });
        onClose();
        reset();
      }
    } catch (e: any) {
      showToast(t('error'), e?.message || t('failedToAddContributor'), 'error');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.backgroundLight }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>{t('addContributors')}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <CollaboratorPicker excludeUserIds={excludeUserIds} onSelectUser={handleSelectUser} />

            {selectedUsers.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.textGray }]}>
                  {t('selected')} ({selectedUsers.length})
                </Text>
                {selectedUsers.map((su) => (
                  <View
                    key={su._id}
                    style={[styles.row, { backgroundColor: colors.background, borderColor: colors.border }]}
                  >
                    {su.profilePic ? (
                      <Image source={{ uri: su.profilePic }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarPh, { backgroundColor: colors.avatarBg }]}>
                        <Text style={styles.avatarTxt}>
                          {(su.name || su.username || '?')[0]?.toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, { color: colors.text }]}>{su.name}</Text>
                      <Text style={[styles.sub, { color: colors.textGray }]}>@{su.username}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setSelectedUsers((p) => p.filter((x) => x._id !== su._id))}
                    >
                      <Text style={{ color: colors.error }}>{t('remove')}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.backgroundLight }]}>
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { backgroundColor: selectedUsers.length ? colors.primary : colors.border },
              ]}
              disabled={selectedUsers.length === 0 || isAdding}
              onPress={handleAddContributors}
            >
              {isAdding ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('addContributorsConfirm')}</Text>
              )}
            </TouchableOpacity>
          </View>
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
    maxHeight: '88%',
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
    marginTop: 8,
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
  },
  sub: {
    fontSize: 13,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});

export default AddContributorModal;
