import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
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
  ].filter(Boolean) as string[];

  const handleToggleUser = (u: CollaboratorUser, selected: boolean) => {
    const id = String(u._id);
    if (selected) {
      setSelectedUsers((prev) =>
        prev.some((x) => String(x._id) === id) ? prev : [...prev, u]
      );
    } else {
      setSelectedUsers((prev) => prev.filter((x) => String(x._id) !== id));
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
        const needsHydration = (p: any) =>
          !Array.isArray(p?.contributors) ||
          p.contributors.some((c: any) => typeof c === 'string' || typeof c === 'number' || !c?.profilePic);

        let finalPost = updated;
        if (!finalPost || needsHydration(finalPost)) {
          const fresh = await apiService.get(`${ENDPOINTS.GET_POST}/${post._id}`);
          finalPost = (fresh as any)?.post ?? fresh;
        }

        const selectedById = new Map(
          selectedUsers
            .filter((u) => u?._id)
            .map((u) => [String(u._id), { _id: u._id, name: u.name, username: u.username, profilePic: u.profilePic }])
        );
        const normalizeContributor = (c: any) => {
          const id = (typeof c === 'string' || typeof c === 'number') ? String(c) : (c?._id != null ? String(c._id) : '');
          if (id && selectedById.has(id)) return selectedById.get(id);
          if (typeof c === 'string' || typeof c === 'number') return { _id: id };
          return c;
        };
        if (finalPost && Array.isArray(finalPost.contributors)) {
          const merged = finalPost.contributors.map(normalizeContributor);
          for (const [id, u] of selectedById.entries()) {
            if (!merged.some((c: any) => String((c?._id ?? c) || '') === id)) merged.push(u);
          }
          finalPost = { ...finalPost, contributors: merged };
        }

        showToast(t('success'), t('contributorsAdded'), 'success');
        if (finalPost) onContributorAdded?.(finalPost);
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
            <View style={styles.headerTextWrap}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>{t('addContributors')}</Text>
              {selectedUsers.length > 0 ? (
                <Text style={[styles.countHint, { color: colors.textGray }]}>
                  {t('selected')} ({selectedUsers.length})
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.pickerWrap}>
            <CollaboratorPicker
              excludeUserIds={excludeUserIds}
              selectedIds={selectedUsers.map((u) => String(u._id))}
              onToggleUser={handleToggleUser}
            />
          </View>

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
    minHeight: '70%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  countHint: {
    fontSize: 13,
    marginTop: 2,
  },
  pickerWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default AddContributorModal;
