import React from 'react';
import { TouchableOpacity, Image, StyleSheet, ViewStyle } from 'react-native';
import { COLORS } from '../utils/constants';

interface CardProps {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  value: number; // 1-13 (1=Ace, 11=Jack, 12=Queen, 13=King)
  style?: ViewStyle;
  rotation?: number;
  onPress?: () => void;
  faceDown?: boolean;
  width?: number;
  height?: number;
}

// Card image mapping - all images must be statically required in React Native
const cardImages: { [key: string]: any } = {
  // Hearts
  'ace_of_hearts': require('../assets/cards/ace_of_hearts.png'),
  '2_of_hearts': require('../assets/cards/2_of_hearts.png'),
  '3_of_hearts': require('../assets/cards/3_of_hearts.png'),
  '4_of_hearts': require('../assets/cards/4_of_hearts.png'),
  '5_of_hearts': require('../assets/cards/5_of_hearts.png'),
  '6_of_hearts': require('../assets/cards/6_of_hearts.png'),
  '7_of_hearts': require('../assets/cards/7_of_hearts.png'),
  '8_of_hearts': require('../assets/cards/8_of_hearts.png'),
  '9_of_hearts': require('../assets/cards/9_of_hearts.png'),
  '10_of_hearts': require('../assets/cards/10_of_hearts.png'),
  'jack_of_hearts': require('../assets/cards/jack_of_hearts2.png'),
  'queen_of_hearts': require('../assets/cards/queen_of_hearts2.png'),
  'king_of_hearts': require('../assets/cards/king_of_hearts2.png'),
  
  // Diamonds
  'ace_of_diamonds': require('../assets/cards/ace_of_diamonds.png'),
  '2_of_diamonds': require('../assets/cards/2_of_diamonds.png'),
  '3_of_diamonds': require('../assets/cards/3_of_diamonds.png'),
  '4_of_diamonds': require('../assets/cards/4_of_diamonds.png'),
  '5_of_diamonds': require('../assets/cards/5_of_diamonds.png'),
  '6_of_diamonds': require('../assets/cards/6_of_diamonds.png'),
  '7_of_diamonds': require('../assets/cards/7_of_diamonds.png'),
  '8_of_diamonds': require('../assets/cards/8_of_diamonds.png'),
  '9_of_diamonds': require('../assets/cards/9_of_diamonds.png'),
  '10_of_diamonds': require('../assets/cards/10_of_diamonds.png'),
  'jack_of_diamonds': require('../assets/cards/jack_of_diamonds2.png'),
  'queen_of_diamonds': require('../assets/cards/queen_of_diamonds2.png'),
  'king_of_diamonds': require('../assets/cards/king_of_diamonds2.png'),
  
  // Clubs
  'ace_of_clubs': require('../assets/cards/ace_of_clubs.png'),
  '2_of_clubs': require('../assets/cards/2_of_clubs.png'),
  '3_of_clubs': require('../assets/cards/3_of_clubs.png'),
  '4_of_clubs': require('../assets/cards/4_of_clubs.png'),
  '5_of_clubs': require('../assets/cards/5_of_clubs.png'),
  '6_of_clubs': require('../assets/cards/6_of_clubs.png'),
  '7_of_clubs': require('../assets/cards/7_of_clubs.png'),
  '8_of_clubs': require('../assets/cards/8_of_clubs.png'),
  '9_of_clubs': require('../assets/cards/9_of_clubs.png'),
  '10_of_clubs': require('../assets/cards/10_of_clubs.png'),
  'jack_of_clubs': require('../assets/cards/jack_of_clubs2.png'),
  'queen_of_clubs': require('../assets/cards/queen_of_clubs2.png'),
  'king_of_clubs': require('../assets/cards/king_of_clubs2.png'),
  
  // Spades
  'ace_of_spades': require('../assets/cards/ace_of_spades.png'),
  '2_of_spades': require('../assets/cards/2_of_spades.png'),
  '3_of_spades': require('../assets/cards/3_of_spades.png'),
  '4_of_spades': require('../assets/cards/4_of_spades.png'),
  '5_of_spades': require('../assets/cards/5_of_spades.png'),
  '6_of_spades': require('../assets/cards/6_of_spades.png'),
  '7_of_spades': require('../assets/cards/7_of_spades.png'),
  '8_of_spades': require('../assets/cards/8_of_spades.png'),
  '9_of_spades': require('../assets/cards/9_of_spades.png'),
  '10_of_spades': require('../assets/cards/10_of_spades.png'),
  'jack_of_spades': require('../assets/cards/jack_of_spades2.png'),
  'queen_of_spades': require('../assets/cards/queen_of_spades2.png'),
  'king_of_spades': require('../assets/cards/king_of_spades2.png'),
  
  // Card back
  'back': require('../assets/cards/back.png'),
};

const Card: React.FC<CardProps> = ({
  suit,
  value,
  style,
  rotation = 0,
  onPress,
  faceDown = false,
  width = 80,
  height = 112,
}) => {
  // Map value to card image name
  const getCardImage = () => {
    if (faceDown) {
      return cardImages['back'];
    }

    const suitMap: { [key: string]: string } = {
      hearts: 'hearts',
      diamonds: 'diamonds',
      clubs: 'clubs',
      spades: 'spades',
    };

    const valueMap: { [key: number]: string } = {
      1: 'ace',
      2: '2',
      3: '3',
      4: '4',
      5: '5',
      6: '6',
      7: '7',
      8: '8',
      9: '9',
      10: '10',
      11: 'jack',
      12: 'queen',
      13: 'king',
    };

    const imageKey = `${valueMap[value]}_of_${suitMap[suit]}`;
    return cardImages[imageKey] || cardImages['back'];
  };

  // Extract width/height from style prop if provided
  const styleWidth = (style as any)?.width;
  const styleHeight = (style as any)?.height;
  const finalWidth = styleWidth || width;
  const finalHeight = styleHeight || height;
  
  // Remove width/height from style to avoid conflicts
  const { width: _, height: __, ...restStyle } = (style as any) || {};
  
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.card,
        {
          width: finalWidth,
          height: finalHeight,
          transform: [{ rotate: `${rotation}deg` }],
        },
        restStyle,
      ]}
      activeOpacity={0.7}
    >
      <Image
        source={getCardImage()}
        style={styles.cardImage}
        resizeMode="stretch"
      />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
});

export default Card;
