import React, { useState, useEffect } from 'react';
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
import { COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';

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

  const [weatherData, setWeatherData] = useState<WeatherData[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchWeatherData();
    fetchUserPreferences();
  }, []);

  const fetchWeatherData = async () => {
    try {
      const baseUrl = 'https://media-1-aue5.onrender.com';
      const response = await fetch(`${baseUrl}/api/weather/all`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (response.ok && data.cities) {
        setWeatherData(data.cities);
      }
    } catch (error) {
      console.error('Error fetching weather:', error);
      showToast('Error', 'Failed to load weather data', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchUserPreferences = async () => {
    try {
      const baseUrl = 'https://media-1-aue5.onrender.com';
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

  const handleRefresh = () => {
    setRefreshing(true);
    fetchWeatherData();
  };

  const toggleCitySelection = (city: string) => {
    if (selectedCities.includes(city)) {
      setSelectedCities(prev => prev.filter(c => c !== city));
    } else {
      if (selectedCities.length >= 10) {
        Alert.alert('Limit Reached', 'You can select up to 10 cities only.');
        return;
      }
      setSelectedCities(prev => [...prev, city]);
    }
  };

  const handleSavePreferences = async () => {
    if (selectedCities.length === 0) {
      Alert.alert('No Cities Selected', 'Please select at least one city.');
      return;
    }

    setSaving(true);
    try {
      const baseUrl = 'https://media-1-aue5.onrender.com';
      const response = await fetch(`${baseUrl}/api/weather/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cities: selectedCities }),
      });

      if (response.ok) {
        showToast('Success', '✅ Weather preferences saved!', 'success');
        await fetch(`${baseUrl}/api/weather/post/manual`, {
          method: 'POST',
          credentials: 'include',
        });
      } else {
        showToast('Error', 'Failed to save preferences', 'error');
      }
    } catch (error) {
      console.error('Error saving preferences:', error);
      showToast('Error', 'Failed to save preferences', 'error');
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

  const filteredWeather = weatherData.filter(item =>
    item.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderWeatherItem = ({ item }: { item: WeatherData }) => {
    const isSelected = selectedCities.includes(item.city);

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
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Weather</Text>
        <Text style={styles.headerSubtitle}>
          Selected: {selectedCities.length}/10 cities
        </Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search cities..."
          placeholderTextColor={COLORS.textGray}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <FlatList
        data={filteredWeather}
        renderItem={renderWeatherItem}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No cities found</Text>
          </View>
        }
      />

      <View style={styles.saveButtonContainer}>
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSavePreferences}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.saveButtonText}>Save & Update Feed</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  header: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  searchContainer: {
    padding: 15,
  },
  searchInput: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 15,
    color: COLORS.text,
    fontSize: 16,
  },
  listContainer: {
    padding: 15,
    paddingBottom: 100,
  },
  weatherCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedCard: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.backgroundLight,
  },
  checkboxContainer: {
    marginRight: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.textGray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
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
    color: COLORS.text,
    marginBottom: 4,
  },
  condition: {
    fontSize: 14,
    color: COLORS.textGray,
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
    color: COLORS.text,
  },
  detailsContainer: {
    alignItems: 'flex-end',
  },
  detailText: {
    fontSize: 13,
    color: COLORS.textGray,
    marginBottom: 4,
  },
  emptyContainer: {
    padding: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textGray,
  },
  saveButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 15,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
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
});

export default WeatherScreen;
