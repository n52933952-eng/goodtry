import React from 'react';
import { View, TextInput, Pressable, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

const INPUT_LTR = {
  textAlign: 'left' as const,
  writingDirection: 'ltr' as const,
};

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  containerStyle?: object;
};

const UserListSearchBar: React.FC<Props> = ({
  value,
  onChangeText,
  placeholder = 'Search users...',
  containerStyle,
}) => {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.backgroundLight, borderColor: colors.border },
        containerStyle,
      ]}
    >
      <TextInput
        style={[
          styles.input,
          INPUT_LTR,
          { color: colors.text, paddingRight: value.length > 0 ? 48 : 12 },
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.textGray}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        returnKeyType="search"
        textAlign="left"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          style={styles.clearBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <View style={[styles.clearInner, { backgroundColor: colors.border }]}>
            <Text style={[styles.clearText, { color: colors.text }]}>✕</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    position: 'relative',
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: 'center',
    direction: 'ltr',
  },
  input: {
    width: '100%',
    paddingVertical: 12,
    paddingLeft: 14,
    fontSize: 16,
  },
  clearBtn: {
    position: 'absolute',
    right: 6,
    top: 0,
    bottom: 0,
    width: 44,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  clearInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 17,
  },
});

export default UserListSearchBar;
