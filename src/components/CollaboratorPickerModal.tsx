import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import CollaboratorPicker from './CollaboratorPicker';
import { CollaboratorUser } from '../utils/collaborators';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  excludeUserIds: string[];
  selectedCollaborators: CollaboratorUser[];
  onChangeSelected: (users: CollaboratorUser[]) => void;
  footer?: React.ReactNode;
};

const CollaboratorPickerModal: React.FC<Props> = ({
  visible,
  onClose,
  title,
  excludeUserIds,
  selectedCollaborators,
  onChangeSelected,
  footer,
}) => {
  const { t } = useLanguage();
  const { colors } = useTheme();

  const selectedIds = selectedCollaborators.map((u) => String(u._id));

  const handleToggle = useCallback(
    (u: CollaboratorUser, selected: boolean) => {
      const id = String(u._id);
      if (selected) {
        if (!selectedCollaborators.some((x) => String(x._id) === id)) {
          onChangeSelected([...selectedCollaborators, u]);
        }
      } else {
        onChangeSelected(selectedCollaborators.filter((x) => String(x._id) !== id));
      }
    },
    [selectedCollaborators, onChangeSelected]
  );

  useEffect(() => {
    if (!visible) {
      /* parent may reset selection on close */
    }
  }, [visible]);

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
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                {title || t('addContributors')}
              </Text>
              {selectedCollaborators.length > 0 ? (
                <Text style={[styles.countHint, { color: colors.textGray }]}>
                  {t('selected')} ({selectedCollaborators.length})
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>{t('done')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.pickerWrap}>
            <CollaboratorPicker
              excludeUserIds={excludeUserIds}
              selectedIds={selectedIds}
              onToggleUser={handleToggle}
            />
          </View>

          {footer ? (
            <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.backgroundLight }]}>
              {footer}
            </View>
          ) : null}
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
});

export default CollaboratorPickerModal;
