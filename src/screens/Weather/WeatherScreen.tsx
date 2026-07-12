import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Keyboard,
  ScrollView,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { API_URL } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useTabBarCollapseOnFocus } from '../../context/TabBarCollapseContext';

interface WeatherData {
  _id: string;
  city: string;
  country?: string;
  temperature: number;
  condition: string;
  humidity: number;
  wind_speed: number;
  icon: string;
  lastUpdated: string;
  timezoneOffset?: number | null;
}

type CitySel = string | { name: string; country?: string; lat?: number; lon?: number };

const cityNameOf = (c: CitySel) => (typeof c === 'string' ? c : c.name);

/** OpenWeatherMap timezone offset (seconds from UTC) → h:mm am/pm in that city */
const formatCityLocalTime = (timezoneOffsetSec?: number | null) => {
  if (typeof timezoneOffsetSec !== 'number' || Number.isNaN(timezoneOffsetSec)) return null;
  const d = new Date(Date.now() + timezoneOffsetSec * 1000);
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
};

/** Soft sky palette from condition + day/night (no purple gradients). */
const getSkyPalette = (
  condition?: string,
  timezoneOffset?: number | null,
  theme: 'dark' | 'blue' = 'dark',
) => {
  let hour = new Date().getUTCHours();
  if (typeof timezoneOffset === 'number') {
    hour = new Date(Date.now() + timezoneOffset * 1000).getUTCHours();
  }
  const night = hour >= 19 || hour < 6;
  const c = (condition || '').toLowerCase();

  if (theme === 'blue') {
    if (night) {
      return { bg: '#1B2F4A', text: '#F4F8FC', muted: '#A8BDD4', accent: '#5BA8E8', chip: '#243B5C' };
    }
    if (c.includes('storm') || c.includes('thunder')) {
      return { bg: '#D9E4F0', text: '#1A2C40', muted: '#5A6F86', accent: '#3D7AB8', chip: '#C5D4E6' };
    }
    if (c.includes('rain') || c.includes('drizzle')) {
      return { bg: '#D0EAF6', text: '#0F3A4E', muted: '#4A7080', accent: '#1D9BF0', chip: '#B8DCEB' };
    }
    if (c.includes('snow')) {
      return { bg: '#E4EEF5', text: '#1E3344', muted: '#5E7588', accent: '#6BA3C4', chip: '#D0DCE6' };
    }
    if (c.includes('cloud')) {
      return { bg: '#D8E8F2', text: '#16384A', muted: '#567486', accent: '#2B9FD9', chip: '#C2D6E4' };
    }
    return { bg: '#C5E7F8', text: '#0A3550', muted: '#3F6F88', accent: '#1D9BF0', chip: '#A8D4EC' };
  }

  if (night) {
    return { bg: '#152038', text: '#F0F4FA', muted: '#9AABC4', accent: '#6B9EFF', chip: '#1C2A48' };
  }
  if (c.includes('storm') || c.includes('thunder')) {
    return { bg: '#1A2438', text: '#EEF2F8', muted: '#9AA8BE', accent: '#7EB6FF', chip: '#243048' };
  }
  if (c.includes('rain') || c.includes('drizzle')) {
    return { bg: '#143044', text: '#EAF6FC', muted: '#8FB4C8', accent: '#4DB8E8', chip: '#1C3C52' };
  }
  if (c.includes('snow')) {
    return { bg: '#1A2A38', text: '#F2F7FB', muted: '#A0B4C4', accent: '#A8D4F0', chip: '#243848' };
  }
  if (c.includes('cloud')) {
    return { bg: '#172E3C', text: '#EAF5FA', muted: '#8EADC0', accent: '#5CC8F0', chip: '#203A4A' };
  }
  return { bg: '#0E3550', text: '#E8F6FD', muted: '#8EC4DC', accent: '#3DB8F5', chip: '#164A66' };
};

const WeatherScreen = () => {
  const { user } = useUser();
  const showToast = useShowToast();
  const { t } = useLanguage();
  const { colors, theme } = useTheme();
  const { tabBarHeight } = useTabBarCollapseOnFocus('weather');

  const [activeTab, setActiveTab] = useState<'my' | 'cities'>('my');
  const [weatherData, setWeatherData] = useState<WeatherData[]>([]);
  const [selectedCities, setSelectedCities] = useState<CitySel[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        loadingContainer: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        },
        header: {
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 8,
        },
        headerTop: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        },
        refreshBtn: {
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.backgroundLight,
          borderWidth: 1,
          borderColor: colors.border,
        },
        refreshIcon: {
          fontSize: 18,
          color: colors.primary,
          fontWeight: '700',
        },
        headerTitle: {
          fontSize: 26,
          fontWeight: '700',
          color: colors.text,
          letterSpacing: -0.3,
        },
        headerSubtitle: {
          marginTop: 4,
          fontSize: 13,
          color: colors.textGray,
          marginLeft: 46,
        },
        tabs: {
          flexDirection: 'row',
          marginHorizontal: 16,
          marginTop: 10,
          marginBottom: 6,
          padding: 4,
          borderRadius: 14,
          backgroundColor: colors.backgroundLight,
          borderWidth: 1,
          borderColor: colors.border,
        },
        tab: {
          flex: 1,
          paddingVertical: 11,
          borderRadius: 11,
          alignItems: 'center',
        },
        tabActive: {
          backgroundColor: colors.primary,
        },
        tabText: {
          fontSize: 14,
          fontWeight: '600',
          color: colors.textGray,
        },
        tabTextActive: {
          color: '#FFFFFF',
          fontWeight: '700',
        },
        hero: {
          marginHorizontal: 16,
          marginTop: 12,
          marginBottom: 12,
          paddingVertical: 28,
          paddingHorizontal: 20,
          borderRadius: 20,
          overflow: 'hidden',
        },
        heroAccentBar: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 4,
        },
        heroCity: {
          fontSize: 15,
          fontWeight: '600',
          marginBottom: 6,
        },
        heroTempRow: {
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 10,
        },
        heroTemp: {
          fontSize: 58,
          fontWeight: '300',
          letterSpacing: -1.5,
          lineHeight: 64,
        },
        heroIcon: { fontSize: 38, marginBottom: 8 },
        heroCondition: {
          marginTop: 8,
          fontSize: 16,
          textTransform: 'capitalize',
          fontWeight: '500',
        },
        heroMeta: {
          marginTop: 16,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        },
        heroMetaChip: {
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 20,
        },
        heroMetaText: {
          fontSize: 13,
          fontWeight: '600',
        },
        listPad: { paddingHorizontal: 16, paddingBottom: 28, paddingTop: 4 },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 14,
          paddingHorizontal: 14,
          marginBottom: 10,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.backgroundLight,
        },
        rowAccent: {
          width: 4,
          alignSelf: 'stretch',
          borderRadius: 4,
          marginRight: 12,
        },
        rowCity: { flex: 1 },
        rowName: { fontSize: 16, fontWeight: '700', color: colors.text },
        rowCond: { fontSize: 13, color: colors.textGray, marginTop: 3 },
        rowRight: { alignItems: 'flex-end' },
        rowTemp: { fontSize: 22, fontWeight: '700', color: colors.text },
        rowIcon: { fontSize: 20, marginBottom: 2 },
        emptyWrap: { padding: 40, alignItems: 'center' },
        emptyTitle: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
          marginBottom: 8,
        },
        emptySub: {
          fontSize: 14,
          color: colors.textGray,
          textAlign: 'center',
          marginBottom: 20,
          lineHeight: 20,
        },
        emptyCta: {
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderRadius: 10,
          backgroundColor: colors.primary,
        },
        emptyCtaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
        chipsWrap: {
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 4,
        },
        chipsLabel: {
          fontSize: 13,
          fontWeight: '600',
          color: colors.textGray,
          marginBottom: 8,
        },
        chip: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 7,
          paddingLeft: 12,
          paddingRight: 8,
          borderRadius: 20,
          backgroundColor: colors.backgroundLight,
          borderWidth: 1,
          borderColor: colors.primary,
          marginRight: 8,
          marginBottom: 8,
        },
        chipText: { fontSize: 13, color: colors.text, marginRight: 6, fontWeight: '600' },
        chipX: {
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.primary,
        },
        chipXText: { fontSize: 12, color: '#FFFFFF', fontWeight: '700' },
        searchContainer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
        searchInputRow: {
          position: 'relative',
          backgroundColor: colors.backgroundLight,
          borderRadius: 12,
          minHeight: 48,
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.border,
        },
        searchInput: {
          paddingVertical: 12,
          paddingLeft: 14,
          color: colors.text,
          fontSize: 16,
          textAlign: 'left',
        },
        searchClearBtn: {
          position: 'absolute',
          right: 6,
          top: 0,
          bottom: 0,
          width: 44,
          justifyContent: 'center',
          alignItems: 'center',
        },
        searchClearBtnInner: {
          width: 28,
          height: 28,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.border,
        },
        searchClearBtnText: { fontSize: 14, fontWeight: '700', color: colors.textGray },
        searchResultItem: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        searchResultCity: { fontSize: 15, fontWeight: '600', color: colors.text },
        searchResultState: { fontSize: 12, color: colors.textGray, marginTop: 2 },
        searchResultAdd: { fontSize: 14, color: colors.primary, fontWeight: '700' },
        searchResultAdded: { fontSize: 13, color: colors.textGray, fontWeight: '600' },
        saveBar: {
          padding: 16,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          backgroundColor: colors.background,
        },
        saveButton: {
          backgroundColor: colors.primary,
          borderRadius: 12,
          paddingVertical: 14,
          alignItems: 'center',
        },
        saveButtonDisabled: { opacity: 0.5 },
        saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
        hint: {
          paddingHorizontal: 16,
          paddingBottom: 8,
          fontSize: 13,
          color: colors.textGray,
        },
      }),
    [colors],
  );

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchLoading(false);
    Keyboard.dismiss();
    searchInputRef.current?.blur();
  }, []);

  useEffect(() => {
    fetchWeatherData();
    fetchUserPreferences();
  }, [user]);

  const fetchWeatherData = async () => {
    try {
      const response = await fetch(`${API_URL}/api/weather?limit=50`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (response.ok && data.weather) {
        const cities = data.weather.map((item: any) => ({
          _id: item._id?.toString() || '',
          city: item.location?.city || '',
          country: item.location?.country || '',
          temperature: item.current?.temperature || 0,
          condition: item.current?.condition?.description || item.current?.condition?.main || 'Unknown',
          humidity: item.current?.humidity || 0,
          wind_speed: item.current?.windSpeed || 0,
          icon: item.current?.condition?.icon || '01d',
          lastUpdated: item.lastUpdated || new Date(),
          timezoneOffset:
            typeof item.location?.timezoneOffset === 'number'
              ? item.location.timezoneOffset
              : null,
        }));
        setWeatherData(cities);
      } else {
        setWeatherData([]);
      }
    } catch (error) {
      console.error('Error fetching weather:', error);
      showToast(t('error'), t('failedToLoadWeatherData'), 'error');
      setWeatherData([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchUserPreferences = async () => {
    try {
      const response = await fetch(`${API_URL}/api/weather/preferences`, {
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        const list = data.cities || data.selectedCities || [];
        setSelectedCities(Array.isArray(list) ? list : []);
        setHeroIndex(0);
      }
    } catch (error) {
      console.error('Error fetching preferences:', error);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    fetch(`${API_URL}/api/weather/fetch/manual`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    await Promise.all([fetchWeatherData(), fetchUserPreferences()]);
  };

  const isCitySelected = (name: string, country?: string) =>
    selectedCities.some((city) => {
      if (typeof city === 'string') return city === name;
      return city.name === name && (!country || !city.country || city.country === country);
    });

  const removeCity = (name: string) => {
    setSelectedCities((prev) =>
      prev.filter((city) => cityNameOf(city) !== name),
    );
  };

  const addCityFromSearch = (item: any) => {
    if (isCitySelected(item.name, item.country)) {
      showToast(t('info'), `${item.name} ${t('isAlreadySelected')}`, 'info');
      return;
    }
    if (selectedCities.length >= 10) {
      Alert.alert(t('limitReached'), t('youCanSelectUpTo10Cities'));
      return;
    }
    setSelectedCities((prev) => [
      ...prev,
      { name: item.name, country: item.country, lat: item.lat, lon: item.lon },
    ]);
    clearSearch();
  };

  const handleSavePreferences = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/weather/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cities: selectedCities }),
      });
      if (response.ok) {
        showToast(
          t('success'),
          selectedCities.length === 0
            ? 'All cities cleared'
            : t('weatherPreferencesSaved'),
          'success',
        );
        // Backend now caches new cities before responding — reload list for My Weather
        await fetchWeatherData();
        await fetchUserPreferences();
      } else {
        showToast(t('error'), t('failedToSavePreferences'), 'error');
      }
    } catch (error) {
      console.error('Error saving preferences:', error);
      showToast(t('error'), t('failedToSavePreferences'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const getWeatherIconEmoji = (
    condition: string,
    iconCode?: string,
    timezoneOffset?: number | null,
  ) => {
    // OpenWeatherMap: icon ends with "d" (day) or "n" (night) — e.g. 01d / 01n
    let isNight = typeof iconCode === 'string' && /n$/i.test(iconCode);
    if (typeof timezoneOffset === 'number') {
      const h = new Date(Date.now() + timezoneOffset * 1000).getUTCHours();
      isNight = h >= 19 || h < 6;
    }
    const cond = (condition || '').toLowerCase();
    if (cond.includes('clear') || cond.includes('sunny')) return isNight ? '🌙' : '☀️';
    if (cond.includes('few clouds') || cond.includes('scattered')) return isNight ? '☁️' : '⛅';
    if (cond.includes('cloud')) return '☁️';
    if (cond.includes('rain') || cond.includes('drizzle')) return '🌧️';
    if (cond.includes('snow')) return '❄️';
    if (cond.includes('storm') || cond.includes('thunder')) return '⛈️';
    if (cond.includes('fog') || cond.includes('mist') || cond.includes('haze')) return '🌫️';
    return isNight ? '🌙' : '🌤️';
  };

  const renderConditionIcon = (
    condition: string,
    iconCode?: string,
    timezoneOffset?: number | null,
    size: number = 40,
  ) => (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.12)',
      }}
    >
      <Text style={{ fontSize: size * 0.55, lineHeight: size * 0.7 }}>
        {getWeatherIconEmoji(condition, iconCode, timezoneOffset)}
      </Text>
    </View>
  );

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/api/weather/search?query=${encodeURIComponent(query)}`,
        { credentials: 'include' },
      );
      const data = await response.json();
      setSearchResults(response.ok && data.cities ? data.cities : []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const selectedNames = useMemo(
    () => new Set(selectedCities.map(cityNameOf).filter(Boolean)),
    [selectedCities],
  );

  const myWeather = useMemo(() => {
    if (!selectedNames.size) return [];
    const matched = weatherData.filter((w) => selectedNames.has(w.city));
    // Keep order close to selection order
    const byName = new Map(matched.map((w) => [w.city, w]));
    const ordered: WeatherData[] = [];
    for (const c of selectedCities) {
      const n = cityNameOf(c);
      const hit = byName.get(n);
      if (hit) ordered.push(hit);
    }
    return ordered;
  }, [weatherData, selectedCities, selectedNames]);

  const hero = myWeather[Math.min(heroIndex, Math.max(0, myWeather.length - 1))] || null;
  const rest = myWeather.filter((_, i) => i !== Math.min(heroIndex, Math.max(0, myWeather.length - 1)));
  // clockTick keeps local times fresh every 30s
  const heroLocalTime = useMemo(
    () => formatCityLocalTime(hero?.timezoneOffset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hero?.timezoneOffset, clockTick],
  );
  const heroPalette = useMemo(
    () => getSkyPalette(hero?.condition, hero?.timezoneOffset, theme),
    [hero?.condition, hero?.timezoneOffset, theme],
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={handleRefresh}
            disabled={refreshing}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Refresh weather. Pull down to refresh."
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.refreshIcon}>↻</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('weather')}</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          {selectedCities.length}/10 {t('cities')} · pull down to refresh
        </Text>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'my' && styles.tabActive]}
          onPress={() => {
            setActiveTab('my');
            void fetchWeatherData();
          }}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'my' && styles.tabTextActive]}>
            My Weather
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'cities' && styles.tabActive]}
          onPress={() => setActiveTab('cities')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'cities' && styles.tabTextActive]}>
            Cities
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'my' ? (
        <FlatList
          data={rest}
          extraData={clockTick}
          keyExtractor={(item) => item._id || item.city}
          contentContainerStyle={[styles.listPad, { paddingBottom: 28 + tabBarHeight }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            myWeather.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No cities yet</Text>
                <Text style={styles.emptySub}>
                  Add up to 10 cities to see live conditions here.
                </Text>
                <TouchableOpacity
                  style={styles.emptyCta}
                  onPress={() => setActiveTab('cities')}
                >
                  <Text style={styles.emptyCtaText}>Add cities</Text>
                </TouchableOpacity>
              </View>
            ) : hero ? (
              <TouchableOpacity
                activeOpacity={0.92}
                style={[styles.hero, { backgroundColor: heroPalette.bg }]}
              >
                <View style={[styles.heroAccentBar, { backgroundColor: heroPalette.accent }]} />
                <Text style={[styles.heroCity, { color: heroPalette.muted }]}>
                  {hero.city}
                  {hero.country ? `, ${hero.country}` : ''}
                  {heroLocalTime ? ` · Time: ${heroLocalTime}` : ''}
                </Text>
                <View style={styles.heroTempRow}>
                  <Text style={[styles.heroTemp, { color: heroPalette.text }]}>
                    {Math.round(hero.temperature)}°
                  </Text>
                  {renderConditionIcon(
                    hero.condition,
                    hero.icon,
                    hero.timezoneOffset,
                    56,
                  )}
                </View>
                <Text style={[styles.heroCondition, { color: heroPalette.text }]}>
                  {hero.condition}
                </Text>
                <View style={styles.heroMeta}>
                  <View style={[styles.heroMetaChip, { backgroundColor: heroPalette.chip }]}>
                    <Text style={[styles.heroMetaText, { color: heroPalette.muted }]}>
                      Humidity {hero.humidity}%
                    </Text>
                  </View>
                  <View style={[styles.heroMetaChip, { backgroundColor: heroPalette.chip }]}>
                    <Text style={[styles.heroMetaText, { color: heroPalette.muted }]}>
                      Wind {Number(hero.wind_speed).toFixed(1)} m/s
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => {
              const localTime = formatCityLocalTime(item.timezoneOffset);
              const rowPalette = getSkyPalette(item.condition, item.timezoneOffset, theme);
              return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  const idx = myWeather.findIndex((w) => w.city === item.city);
                  if (idx >= 0) setHeroIndex(idx);
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.rowAccent, { backgroundColor: rowPalette.accent }]} />
                <View style={styles.rowCity}>
                  <Text style={styles.rowName}>{item.city}</Text>
                  <Text style={styles.rowCond}>
                    {item.condition}
                    {localTime ? ` · Time: ${localTime}` : ''}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  {renderConditionIcon(
                    item.condition,
                    item.icon,
                    item.timezoneOffset,
                    36,
                  )}
                  <Text style={[styles.rowTemp, { color: rowPalette.accent }]}>
                    {Math.round(item.temperature)}°
                  </Text>
                </View>
              </TouchableOpacity>
            );
            }}
          ListEmptyComponent={
            myWeather.length > 1 ? null : myWeather.length === 1 ? (
              <View style={{ height: 8 }} />
            ) : null
          }
        />
      ) : (
        <View style={{ flex: 1 }}>
          <Text style={styles.hint}>Search and tap to add. Save when you’re done.</Text>

          {selectedCities.length > 0 && (
            <View style={styles.chipsWrap}>
              <Text style={styles.chipsLabel}>Selected</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {selectedCities.map((c, i) => {
                  const name = cityNameOf(c);
                  return (
                    <View key={`${name}-${i}`} style={styles.chip}>
                      <Text style={styles.chipText}>{name}</Text>
                      <TouchableOpacity
                        style={styles.chipX}
                        onPress={() => removeCity(name)}
                        hitSlop={8}
                      >
                        <Text style={styles.chipXText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View style={styles.searchContainer}>
            <View style={styles.searchInputRow}>
              <TextInput
                ref={searchInputRef}
                style={[
                  styles.searchInput,
                  { paddingRight: searchQuery.length > 0 || searchLoading ? 48 : 12 },
                ]}
                placeholder={t('searchCities')}
                placeholderTextColor={colors.textGray}
                value={searchQuery}
                onChangeText={handleSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchLoading ? (
                <View style={styles.searchClearBtn}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : searchQuery.length > 0 ? (
                <Pressable onPress={clearSearch} style={styles.searchClearBtn} hitSlop={12}>
                  <View style={styles.searchClearBtnInner}>
                    <Text style={styles.searchClearBtnText}>✕</Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
          </View>

          <FlatList
            data={searchResults}
            keyExtractor={(item, index) => `${item.name}-${item.country}-${index}`}
            contentContainerStyle={{ paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              searchQuery.trim().length >= 2 && !searchLoading ? (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptySub}>
                    {t('noCitiesFound')} “{searchQuery}”
                  </Text>
                </View>
              ) : searchQuery.trim().length < 2 ? (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptySub}>Type at least 2 letters to search</Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => {
              const selected = isCitySelected(item.name, item.country);
              return (
                <TouchableOpacity
                  style={styles.searchResultItem}
                  onPress={() => (selected ? removeCity(item.name) : addCityFromSearch(item))}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.searchResultCity}>
                      {item.name}
                      {item.country ? `, ${item.country}` : ''}
                    </Text>
                    {item.state ? (
                      <Text style={styles.searchResultState}>{item.state}</Text>
                    ) : null}
                  </View>
                  <Text style={selected ? styles.searchResultAdded : styles.searchResultAdd}>
                    {selected ? 'Remove' : '+ Add'}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />

          <View style={[styles.saveBar, { paddingBottom: 16 + tabBarHeight }]}>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSavePreferences}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.saveButtonText}>
                  {selectedCities.length === 0
                    ? 'Clear all cities'
                    : `${t('save')} · ${selectedCities.length}/10`}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

export default WeatherScreen;
