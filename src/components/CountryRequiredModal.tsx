import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import { useUser } from '../context/UserContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import { COUNTRY_OPTIONS } from '../utils/countries';
import { useShowToast } from '../hooks/useShowToast';

const CountryRequiredModal = () => {
  const { user, updateUser, isLoading } = useUser();
  const { colors } = useTheme();
  const showToast = useShowToast();
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState(false);
  const [serverCountry, setServerCountry] = useState('');

  useEffect(() => {
    if (!user?._id || isLoading) {
      setChecked(false);
      setServerCountry('');
      return;
    }
    const local = String(user.country || '').trim();
    if (local) {
      setServerCountry(local);
      setChecked(true);
      return;
    }
    let cancelled = false;
    setChecked(false);
    (async () => {
      try {
        const data = await apiService.get(ENDPOINTS.GET_ME);
        const country = String(data?.country || '').trim();
        if (cancelled) return;
        if (country) updateUser({ country });
        setServerCountry(country);
      } catch {
        if (!cancelled) setServerCountry('skip');
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?._id, user?.country, isLoading, updateUser]);

  const needsCountry = !!user?._id && !isLoading && checked && !serverCountry;

  const saveCountry = async (country: string) => {
    if (!user?._id || saving) return;
    setSaving(true);
    try {
      const data = await apiService.put(`${ENDPOINTS.UPDATE_USER}/${user._id}`, { country });
      if (data?.error) {
        showToast('Error', data.error, 'error');
        return;
      }
      updateUser({ country, ...(data || {}) } as any);
      setServerCountry(country);
      DeviceEventEmitter.emit('discover-country-set');
    } catch (e: any) {
      showToast('Error', e?.message || 'Could not save country', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!needsCountry) return null;

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.backgroundLight }]}>
          <Text style={[styles.title, { color: colors.text }]}>Select your country</Text>
          <Text style={[styles.sub, { color: colors.textGray }]}>
            So you can see people and posts near you.
          </Text>
          {saving ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
          ) : (
            <FlatList
              data={COUNTRY_OPTIONS}
              keyExtractor={(item) => item.name}
              style={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.row, { borderBottomColor: colors.border }]}
                  onPress={() => saveCountry(item.name)}
                >
                  <Text style={styles.flag}>{item.flag}</Text>
                  <Text style={[styles.rowText, { color: colors.text }]}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: 16,
    maxHeight: '80%',
    paddingTop: 18,
    overflow: 'hidden',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
  },
  sub: {
    fontSize: 13,
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 10,
  },
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flag: { fontSize: 22, marginRight: 12 },
  rowText: { fontSize: 15 },
});

export default CountryRequiredModal;
