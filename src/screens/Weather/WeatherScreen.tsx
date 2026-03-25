import React, { useState, useEffect, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { API_URL, ENDPOINTS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import { apiService } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';

interface WeatherData {
  _id: string;
  city: string;
  temperature: number;
  condition: string;
  humidity: number;
  wind_speed: number;
  icon: string;
  lastUpdated: string;
}

const WeatherScreen = () => {
  const { user } = useUser();
  const showToast = useShowToast();
  const { t } = useLanguage();
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        loadingContainer: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        },
        header: {
          padding: 15,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerTop: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        headerTextContainer: {
          flex: 1,
        },
        headerTitle: {
          fontSize: 24,
          fontWeight: 'bold',
          color: colors.text,
          marginBottom: 5,
        },
        headerSubtitle: {
          fontSize: 14,
          color: colors.textGray,
        },
        followButton: {
          backgroundColor: colors.primary,
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 8,
          minWidth: 100,
          alignItems: 'center',
          justifyContent: 'center',
        },
        followingButton: {
          backgroundColor: colors.backgroundLight,
          borderWidth: 1,
          borderColor: colors.border,
        },
        followButtonText: {
          color: '#FFFFFF',
          fontSize: 14,
          fontWeight: '600',
        },
        followingButtonText: {
          color: colors.text,
        },
        searchContainer: {
          padding: 15,
        },
        searchInput: {
          backgroundColor: colors.backgroundLight,
          borderRadius: 10,
          paddingVertical: 12,
          paddingHorizontal: 15,
          color: colors.text,
          fontSize: 16,
        },
        listContainer: {
          padding: 15,
          paddingBottom: 100,
        },
        weatherCard: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.backgroundLight,
          borderRadius: 12,
          padding: 15,
          marginBottom: 12,
          borderWidth: 2,
          borderColor: 'transparent',
        },
        selectedCard: {
          borderColor: colors.primary,
          backgroundColor: colors.backgroundLight,
        },
        checkboxContainer: {
          marginRight: 12,
        },
        checkbox: {
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: colors.textGray,
          justifyContent: 'center',
          alignItems: 'center',
        },
        checkboxChecked: {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
        },
        checkmark: {
          color: '#FFFFFF',
          fontSize: 16,
          fontWeight: 'bold',
        },
        cityInfo: {
          flex: 1,
        },
        cityName: {
          fontSize: 18,
          fontWeight: 'bold',
          color: colors.text,
          marginBottom: 4,
        },
        condition: {
          fontSize: 14,
          color: colors.textGray,
        },
        tempContainer: {
          alignItems: 'center',
          marginRight: 15,
        },
        weatherIcon: {
          fontSize: 32,
          marginBottom: 4,
        },
        temperature: {
          fontSize: 20,
          fontWeight: 'bold',
          color: colors.text,
        },
        detailsContainer: {
          alignItems: 'flex-end',
        },
        detailText: {
          fontSize: 13,
          color: colors.textGray,
          marginBottom: 4,
        },
        emptyContainer: {
          padding: 60,
          alignItems: 'center',
        },
        emptyText: {
          fontSize: 16,
          color: colors.textGray,
          textAlign: 'center',
          marginBottom: 8,
        },
        emptySubtext: {
          fontSize: 14,
          color: colors.textGray,
          textAlign: 'center',
        },
        searchLoading: {
          position: 'absolute',
          right: 15,
          top: 15,
        },
        searchResultsContainer: {
          maxHeight: 300,
          backgroundColor: colors.backgroundLight,
          marginHorizontal: 15,
          marginTop: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
        },
        searchResultsTitle: {
          fontSize: 14,
          fontWeight: '600',
          color: colors.text,
          padding: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        searchResultItem: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        searchResultItemSelected: {
          opacity: 0.5,
        },
        searchResultInfo: {
          flex: 1,
        },
        searchResultCity: {
          fontSize: 16,
          fontWeight: '600',
          color: colors.text,
          marginBottom: 2,
        },
        searchResultState: {
          fontSize: 12,
          color: colors.textGray,
        },
        searchResultAdd: {
          fontSize: 14,
          color: colors.primary,
          fontWeight: '600',
        },
        searchResultAdded: {
          fontSize: 14,
          color: colors.success,
          fontWeight: '600',
        },
        saveButtonContainer: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: 15,
          backgroundColor: colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        saveButton: {
          backgroundColor: colors.primary,
          borderRadius: 12,
          paddingVertical: 15,
          alignItems: 'center',
        },
        saveButtonDisabled: {
          opacity: 0.5,
        },
        saveButtonText: {
          color: '#FFFFFF',
          fontSize: 16,
          fontWeight: 'bold',
        },
      }),
    [colors],
  );

  const [weatherData, setWeatherData] = useState<WeatherData[]>([]);
  const [selectedCities, setSelectedCities] = useState<Array<string | { name: string; country?: string; lat?: number; lon?: number }>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [weatherAccountId, setWeatherAccountId] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    fetchWeatherData();
    fetchUserPreferences();
    checkFollowStatus();
  }, [user]);

  // Re-check follow status when screen comes into focus (e.g., after refresh)
  useFocusEffect(
    React.useCallback(() => {
      if (user) {
        checkFollowStatus();
      }
    }, [user])
  );

  const fetchWeatherData = async () => {
    try {
      const baseUrl = API_URL;
      // Use same endpoint as web: /api/weather?limit=50
      const response = await fetch(`${baseUrl}/api/weather?limit=50`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      console.log('🌤️ [WeatherScreen] fetchWeatherData response:', { 
        ok: response.ok, 
        weatherCount: data.weather?.length,
        hasWeather: !!data.weather 
      });
      
      if (response.ok && data.weather) {
        // Transform backend format to mobile-friendly format (same as web does)
        const cities = data.weather.map((item: any) => ({
          _id: item._id?.toString() || '',
          city: item.location?.city || '',
          temperature: item.current?.temperature || 0,
          condition: item.current?.condition?.description || item.current?.condition?.main || 'Unknown',
          humidity: item.current?.humidity || 0,
          wind_speed: item.current?.windSpeed || 0,
          icon: item.current?.condition?.icon || '01d',
          lastUpdated: item.lastUpdated || new Date()
        }));
        
        setWeatherData(cities);
        console.log(`✅ [WeatherScreen] Loaded ${cities.length} cities`);
      } else {
        console.warn('⚠️ [WeatherScreen] No weather data in response:', data);
        setWeatherData([]);
      }
    } catch (error) {
      console.error('❌ [WeatherScreen] Error fetching weather:', error);
      showToast(t('error'), t('failedToLoadWeatherData'), 'error');
      setWeatherData([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchUserPreferences = async () => {
    try {
      const baseUrl = API_URL;
      const response = await fetch(`${baseUrl}/api/weather/preferences`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (response.ok && data.selectedCities) {
        setSelectedCities(data.selectedCities);
      }
    } catch (error) {
      console.error('Error fetching preferences:', error);
    }
  };

  const checkFollowStatus = async () => {
    if (!user) return;
    
    try {
      const data = await apiService.get(`${ENDPOINTS.GET_USER_PROFILE}/Weather`);
      if (data && data._id) {
        setWeatherAccountId(data._id);
        // Always use isFollowedByMe from API (queries Follow collection, more reliable)
        if (typeof data?.isFollowedByMe === 'boolean') {
          setIsFollowing(data.isFollowedByMe);
          console.log(`🌤️ [WeatherScreen] Follow status: ${data.isFollowedByMe ? 'Following' : 'Not following'}`);
        } else {
          // Fallback: check user.following array (less reliable, but better than nothing)
          const fallbackStatus = user.following?.includes(data._id) || false;
          setIsFollowing(fallbackStatus);
          console.warn(`⚠️ [WeatherScreen] isFollowedByMe not in response, using fallback: ${fallbackStatus}`);
        }
      }
    } catch (error) {
      console.error('❌ [WeatherScreen] Error checking follow status:', error);
    }
  };

  const handleFollow = async () => {
    if (!weatherAccountId || !user) return;
    
    const wasFollowing = isFollowing; // Store current state before API call
    setFollowLoading(true);
    try {
      // Backend expects POST, not PUT (same as web)
      await apiService.post(`${ENDPOINTS.FOLLOW_USER}/${weatherAccountId}`);
      
      // Re-check follow status from API to ensure accuracy (don't just toggle)
      await checkFollowStatus();
      
      // Use the opposite of what it was before (since we just toggled)
      showToast('Success', wasFollowing ? 'Unfollowed Weather' : 'Following Weather! You\'ll now see updates in your feed', 'success');
    } catch (error: any) {
      console.error('❌ [WeatherScreen] Error following/unfollowing:', error);
      showToast('Error', error.message || 'Failed to follow/unfollow', 'error');
    } finally {
      setFollowLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    // Also trigger backend to fetch fresh weather data (optional - backend cron does this hourly)
    try {
      const baseUrl = API_URL;
      // Trigger manual weather fetch (non-blocking, backend will update in background)
      fetch(`${baseUrl}/api/weather/fetch/manual`, {
        method: 'POST',
        credentials: 'include',
      }).catch(err => {
        console.log('⚠️ [WeatherScreen] Could not trigger manual fetch (non-critical):', err);
      });
    } catch (err) {
      // Non-critical, just log
      console.log('⚠️ [WeatherScreen] Error triggering manual fetch:', err);
    }
    // Fetch current data from database
    fetchWeatherData();
  };

  const toggleCitySelection = (cityName: string) => {
    // Check if city is selected (handle both string and object formats)
    const isSelected = selectedCities.some(city => {
      if (typeof city === 'string') {
        return city === cityName;
      }
      return city.name === cityName;
    });
    
    if (isSelected) {
      // Remove city
      setSelectedCities(prev => prev.filter(city => {
        if (typeof city === 'string') {
          return city !== cityName;
        }
        return city.name !== cityName;
      }));
    } else {
      // Add city
      if (selectedCities.length >= 10) {
        Alert.alert(t('limitReached'), t('youCanSelectUpTo10Cities'));
        return;
      }
      setSelectedCities(prev => [...prev, cityName]);
    }
  };

  const handleSavePreferences = async () => {
    if (selectedCities.length === 0) {
      Alert.alert(t('noCitiesSelected'), t('pleaseSelectAtLeastOneCity'));
      return;
    }

    setSaving(true);
    try {
      // Backend accepts both city names (strings) and city objects
      // Normalize: convert strings to objects if needed, or send objects directly
      const citiesToSend = selectedCities.map(city => {
        if (typeof city === 'string') {
          // If it's a string, backend will look it up
          return city;
        }
        // If it's an object, send it as-is (backend prefers objects with coordinates)
        return city;
      });
      
      const baseUrl = API_URL;
      const response = await fetch(`${baseUrl}/api/weather/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cities: citiesToSend }),
      });

      if (response.ok) {
        showToast(t('success'), t('weatherPreferencesSaved'), 'success');
        
        // Trigger weather post update so feed shows your selected cities
        try {
          await fetch(`${baseUrl}/api/weather/post/manual`, {
            method: 'POST',
            credentials: 'include',
          });
          console.log('✅ [WeatherScreen] Triggered weather post update');
        } catch (error) {
          console.warn('⚠️ [WeatherScreen] Could not trigger weather post update (non-critical):', error);
        }
        
        // Refresh weather data to show updated cities
        fetchWeatherData();
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

  const getWeatherIcon = (condition: string) => {
    const cond = condition.toLowerCase();
    if (cond.includes('clear') || cond.includes('sunny')) return '☀️';
    if (cond.includes('cloud')) return '☁️';
    if (cond.includes('rain')) return '🌧️';
    if (cond.includes('snow')) return '❄️';
    if (cond.includes('storm') || cond.includes('thunder')) return '⛈️';
    if (cond.includes('fog') || cond.includes('mist')) return '🌫️';
    return '🌤️';
  };

  // Search cities via API (like web version)
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    
    setSearchLoading(true);
    try {
      const baseUrl = API_URL;
      const response = await fetch(`${baseUrl}/api/weather/search?query=${encodeURIComponent(query)}`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (response.ok && data.cities) {
        console.log(`🔍 [WeatherScreen] Search API returned ${data.cities.length} cities for "${query}"`);
        setSearchResults(data.cities);
      } else {
        console.warn('⚠️ [WeatherScreen] Search API error:', data);
        setSearchResults([]);
      }
    } catch (error) {
      console.error('❌ [WeatherScreen] Error searching cities:', error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  // Filter local weather data (for when search is empty)
  const filteredWeather = weatherData.filter(item => {
    if (!searchQuery.trim()) return true; // Show all if search is empty
    // If searching, don't show local data - show search results instead
    return false;
  });

  const renderWeatherItem = ({ item }: { item: WeatherData }) => {
    // Check if city is selected (handle both string and object formats)
    const isSelected = selectedCities.some(city => {
      if (typeof city === 'string') {
        return city === item.city;
      }
      return city.name === item.city;
    });

    return (
      <TouchableOpacity
        style={[styles.weatherCard, isSelected && styles.selectedCard]}
        onPress={() => toggleCitySelection(item.city)}
      >
        <View style={styles.checkboxContainer}>
          <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
            {isSelected && <Text style={styles.checkmark}>✓</Text>}
          </View>
        </View>

        <View style={styles.cityInfo}>
          <Text style={styles.cityName}>{item.city}</Text>
          <Text style={styles.condition}>{item.condition}</Text>
        </View>

        <View style={styles.tempContainer}>
          <Text style={styles.weatherIcon}>{getWeatherIcon(item.condition)}</Text>
          <Text style={styles.temperature}>{Math.round(item.temperature)}°C</Text>
        </View>

        <View style={styles.detailsContainer}>
          <Text style={styles.detailText}>💧 {item.humidity}%</Text>
          <Text style={styles.detailText}>💨 {item.wind_speed} km/h</Text>
        </View>
      </TouchableOpacity>
    );
  };

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
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>{t('weather')}</Text>
            <Text style={styles.headerSubtitle}>
              {t('selected')}: {selectedCities.length}/10 {t('cities')}
            </Text>
          </View>
          {user && weatherAccountId && (
            <TouchableOpacity
              style={[styles.followButton, isFollowing && styles.followingButton]}
              onPress={handleFollow}
              disabled={followLoading}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color={isFollowing ? colors.text : '#FFFFFF'} />
              ) : (
                <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
                  {isFollowing ? t('following') : t('followWeather')}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('searchCities')}
          placeholderTextColor={colors.textGray}
          value={searchQuery}
          onChangeText={handleSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchLoading && (
          <View style={styles.searchLoading}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
      </View>

      {/* Search Results */}
      {searchQuery.trim().length >= 2 && searchResults.length > 0 && (
        <View style={styles.searchResultsContainer}>
          <Text style={styles.searchResultsTitle}>{t('searchResults')}</Text>
          <FlatList
            data={searchResults}
            keyExtractor={(item, index) => `${item.name}-${item.country}-${index}`}
            renderItem={({ item }) => {
              // Check if city is already selected (handle both string and object formats)
              const isAlreadySelected = selectedCities.some(city => {
                if (typeof city === 'string') {
                  return city === item.name;
                }
                return city.name === item.name && city.country === item.country;
              });
              
              return (
                <TouchableOpacity
                  style={[styles.searchResultItem, isAlreadySelected && styles.searchResultItemSelected]}
                  onPress={() => {
                    if (!isAlreadySelected) {
                      if (selectedCities.length >= 10) {
                        Alert.alert(t('limitReached'), t('youCanSelectUpTo10Cities'));
                        return;
                      }
                      // Save full city object with coordinates (better for backend)
                      setSelectedCities(prev => [...prev, {
                        name: item.name,
                        country: item.country,
                        lat: item.lat,
                        lon: item.lon
                      }]);
                      showToast(t('success'), `${t('added')} ${item.name}`, 'success');
                    } else {
                      showToast(t('info'), `${item.name} ${t('isAlreadySelected')}`, 'info');
                    }
                  }}
                  disabled={isAlreadySelected}
                >
                  <View style={styles.searchResultInfo}>
                    <Text style={styles.searchResultCity}>
                      {item.name}{item.country ? `, ${item.country}` : ''}
                    </Text>
                    {item.state && (
                      <Text style={styles.searchResultState}>{item.state}</Text>
                    )}
                  </View>
                  {isAlreadySelected ? (
                    <Text style={styles.searchResultAdded}>✓ {t('added')}</Text>
                  ) : (
                    <Text style={styles.searchResultAdd}>+ {t('add')}</Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {/* Show message when searching but no results */}
      {searchQuery.trim().length >= 2 && !searchLoading && searchResults.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t('noCitiesFound')} "{searchQuery}"</Text>
          <Text style={styles.emptySubtext}>{t('tryDifferentSearch')}</Text>
        </View>
      )}

      {/* Only show weather list when not searching */}
      {searchQuery.trim().length < 2 && (
        <FlatList
          data={filteredWeather}
          renderItem={renderWeatherItem}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{t('noWeatherData')}</Text>
              <Text style={styles.emptySubtext}>{t('pullToRefresh')}</Text>
            </View>
          }
        />
      )}

      <View style={styles.saveButtonContainer}>
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSavePreferences}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.saveButtonText}>{t('saveAndUpdateFeed')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default WeatherScreen;
