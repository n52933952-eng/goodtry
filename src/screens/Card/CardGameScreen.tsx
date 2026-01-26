import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  ScrollView,
  Modal,
} from 'react-native';
import Sound from 'react-native-sound';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { usePost } from '../../context/PostContext';
import { API_URL, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import Card from '../../components/Card';

const { width } = Dimensions.get('window');

interface CardGameScreenProps {
  navigation: any;
  route: any;
}

interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  value: number;
}

interface GameState {
  roomId: string;
  players: Array<{
    userId: string;
    hand?: Card[]; // Only for current player
    handCount?: number; // For opponent
    score: number;
    books: number[];
  }>;
  deckCount: number;
  table: Card[];
  turn: number;
  gameStatus: 'playing' | 'finished';
  winner: string | null;
  lastMove: {
    playerId: string;
    action: string;
    rank?: number;
    gotCards?: boolean;
    cardsReceived?: number;
    newBooks?: number;
    timestamp: number;
  } | null;
}

const CardGameScreen: React.FC<CardGameScreenProps> = ({ navigation, route }) => {
  const { roomId, opponentId, isSpectator } = route.params || {};
  const { user } = useUser();
  const { socket } = useSocket();
  const { deletePost, posts } = usePost();
  const showToast = useShowToast();

  // Only log on actual roomId changes, not every render
  const prevRoomIdRef = useRef<string | undefined>(undefined);
  if (prevRoomIdRef.current !== roomId) {
    console.log('🃏 [CardGameScreen] RoomId changed:', { 
      from: prevRoomIdRef.current, 
      to: roomId, 
      opponentId, 
      isSpectator 
    });
    prevRoomIdRef.current = roomId;
  }

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [opponent, setOpponent] = useState<any>(null);
  const [gameLive, setGameLive] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [gameResult, setGameResult] = useState('');
  const [myHand, setMyHand] = useState<Card[]>([]);
  const handInitializedRef = useRef(false); // Track if we've received a valid hand
  const [myScore, setMyScore] = useState(0);
  const [myBooks, setMyBooks] = useState<number[]>([]);
  const [opponentHandCount, setOpponentHandCount] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [opponentBooks, setOpponentBooks] = useState<number[]>([]);
  const [deckCount, setDeckCount] = useState(0);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [showRankModal, setShowRankModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [lastMoveMessage, setLastMoveMessage] = useState<string>('');
  
  // Track current roomId to prevent processing events from old rooms
  const currentRoomIdRef = useRef<string | null>(null);
  const previousRoomIdRef = useRef<string | null>(null);
  
  // Track previous score and books count to detect when a book is made
  const previousScoreRef = useRef<number>(0);
  const previousBooksCountRef = useRef<number>(0);
  
  // Track if we've already played the game start sound for this room
  const gameStartSoundPlayedRef = useRef<boolean>(false);
  
  // Track previous turn index to detect when turn actually switches to us (not just when we make a move)
  const previousTurnIndexRef = useRef<number | null>(null);

  // Sound effects
  const sounds = useRef<{
    book?: Sound; // Sound when a book (4 of a kind) is made
    cardFlip?: Sound; // Sound for card actions (Go Fish)
    gameStart?: Sound; // Sound when game starts
    play?: Sound; // Sound when it's your turn
  }>({});

  // Initialize sounds
  useEffect(() => {
    // Enable playback in silence mode (iOS)
    Sound.setCategory('Playback', true);
    
    // Load sound files
    // For Android: files should be in android/app/src/main/res/raw/
    // For iOS: files are bundled via require()
    
    // Book sound (when 4 of a kind is collected) - using cardbook.mp3
    sounds.current.book = new Sound('cardbook.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [CardGameScreen] Failed to load book sound:', error);
        // Fallback: try require() for iOS/bundled assets
        try {
          sounds.current.book = new Sound(require('../../assets/sounds/card-book.mp3'), (error2) => {
            if (error2) console.error('❌ [CardGameScreen] Failed to load book sound (fallback):', error2);
          });
        } catch (e) {
          console.error('❌ [CardGameScreen] Could not load book sound:', e);
        }
      }
    });
    
    // Card flip/action sound - using cardflip.mp3
    sounds.current.cardFlip = new Sound('cardflip.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [CardGameScreen] Failed to load card flip sound:', error);
        try {
          sounds.current.cardFlip = new Sound(require('../../assets/sounds/card-flip.mp3'), (error2) => {
            if (error2) console.error('❌ [CardGameScreen] Failed to load card flip sound (fallback):', error2);
          });
        } catch (e) {
          console.error('❌ [CardGameScreen] Could not load card flip sound:', e);
        }
      }
    });
    
    // Game start sound - using cardstart.mp3
    sounds.current.gameStart = new Sound('cardstart.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [CardGameScreen] Failed to load game start sound:', error);
        try {
          sounds.current.gameStart = new Sound(require('../../assets/sounds/card-start.mp3'), (error2) => {
            if (error2) console.error('❌ [CardGameScreen] Failed to load game start sound (fallback):', error2);
          });
        } catch (e) {
          console.error('❌ [CardGameScreen] Could not load game start sound:', e);
        }
      }
    });
    
    // Play sound (when it's your turn) - using play.mp3
    sounds.current.play = new Sound('play.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [CardGameScreen] Failed to load play sound:', error);
        try {
          sounds.current.play = new Sound(require('../../assets/sounds/play.mp3'), (error2) => {
            if (error2) console.error('❌ [CardGameScreen] Failed to load play sound (fallback):', error2);
          });
        } catch (e) {
          console.error('❌ [CardGameScreen] Could not load play sound:', e);
        }
      }
    });
    
    return () => {
      // Cleanup sounds on unmount
      Object.values(sounds.current).forEach(sound => {
        if (sound) {
          sound.release();
        }
      });
    };
  }, []);

  const playSound = useCallback((type: 'book' | 'cardFlip' | 'gameStart' | 'play') => {
    const sound = sounds.current[type];
    if (sound) {
      sound.stop(() => {
        sound.play((success) => {
          if (!success) {
            console.warn(`⚠️ [CardGameScreen] Failed to play ${type} sound`);
          } else {
            console.log(`🔊 [CardGameScreen] Played ${type} sound`);
          }
        });
      });
    }
  }, []);

  // Get rank name for display
  const getRankName = (value: number): string => {
    const rankMap: { [key: number]: string } = {
      1: 'Ace',
      2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
      11: 'Jack',
      12: 'Queen',
      13: 'King',
    };
    return rankMap[value] || value.toString();
  };

  // Get available ranks in player's hand (for Go Fish - can only ask for ranks you have)
  const getAvailableRanks = (hand: Card[]): number[] => {
    const ranks = new Set<number>();
    hand.forEach(card => {
      ranks.add(card.value);
    });
    return Array.from(ranks).sort((a, b) => a - b);
  };

  useEffect(() => {
    if (!socket || !roomId) {
      console.warn('⚠️ [CardGameScreen] Socket or roomId not available');
      return;
    }

    // Remove all listeners first
    console.log('🃏 [CardGameScreen] Removing all card game listeners before setup');
    socket.off('cardGameState');
    socket.off('opponentMove');
    socket.off('cardGameEnded');
    socket.off('cardGameCleanup');
    socket.off('cardMove');
    
    currentRoomIdRef.current = null;

    const isSwitchingGames = previousRoomIdRef.current && previousRoomIdRef.current !== roomId;
    
    if (isSwitchingGames) {
      console.log('🃏 [CardGameScreen] Switching games:', {
        from: previousRoomIdRef.current,
        to: roomId
      });
    }
    
    console.log('🃏 [CardGameScreen] RoomId changed, clearing state for:', roomId);
    setGameState(null);
    setMyHand([]);
    handInitializedRef.current = false; // Reset initialization flag
    setMyScore(0);
    setMyBooks([]);
    setOpponentHandCount(0);
    setOpponentScore(0);
    setOpponentBooks([]);
    setDeckCount(0);
    setGameOver(false);
    setGameResult('');
    setGameLive(false);
    setOpponent(null);
    setIsMyTurn(false);
    setLastMoveMessage('');
    // Reset score tracking refs
    previousScoreRef.current = 0;
    previousBooksCountRef.current = 0;
    gameStartSoundPlayedRef.current = false; // Reset game start sound flag
    previousTurnIndexRef.current = null; // Reset turn tracking

    const currentRoomId = roomId;
    previousRoomIdRef.current = currentRoomId;
    currentRoomIdRef.current = currentRoomId;
    
    console.log('🃏 [CardGameScreen] Joining card game room:', currentRoomId, { isSpectator });
    
    // Socket event handlers - MUST be defined before return statement
    const handleGameState = (data: any) => {
      const activeRoomId = currentRoomIdRef.current || roomId;
      
      // Validate roomId matches
      if (data.roomId && data.roomId !== activeRoomId && data.roomId !== roomId) {
        console.log('⚠️ [CardGameScreen] Ignoring gameState - roomId mismatch', {
          dataRoomId: data.roomId,
          activeRoomId,
          routeRoomId: roomId
        });
        return;
      }
      
      // Update ref if needed
      if (data.roomId && !currentRoomIdRef.current) {
        currentRoomIdRef.current = data.roomId;
      }
      
      console.log('📥 [CardGameScreen] Game state received:', {
        roomId: data.roomId,
        gameStatus: data.gameStatus,
        turn: data.turn,
        playersCount: data.players?.length,
        activeRoomId,
        routeRoomId: roomId
      });
      
      setGameState(data);
        
        // Set player's hand and opponent info
        if (data.players) {
          const myUserId = user?._id?.toString()
          const myPlayer = data.players.find((p: any) => {
            const pUserId = p.userId?.toString()
            return pUserId === myUserId
          });
          const opponentPlayer = data.players.find((p: any) => {
            const pUserId = p.userId?.toString()
            return pUserId !== myUserId
          });
          
          console.log(`🃏 [CardGameScreen] Finding player:`, {
            myUserId,
            players: data.players.map((p: any) => ({
              userId: p.userId?.toString(),
              hasHand: !!p.hand,
              handLength: p.hand?.length || p.handCount || 0
            })),
            foundMyPlayer: !!myPlayer
          });
          
          if (myPlayer) {
            // Only update hand if we actually received a hand array (not just handCount)
            // This prevents overwriting a valid hand with empty array from requestCardGameState
            if (myPlayer.hand !== undefined && Array.isArray(myPlayer.hand)) {
              const hand = myPlayer.hand;
              
              // Only update if:
              // 1. We haven't initialized yet (first time), OR
              // 2. The new hand has cards (valid update), OR
              // 3. Current hand is empty and we're getting a valid hand
              if (!handInitializedRef.current || hand.length > 0 || myHand.length === 0) {
                console.log(`🃏 [CardGameScreen] Setting my hand: ${hand.length} cards`, {
                  handLength: hand.length,
                  hand: hand.slice(0, 3), // Log first 3 cards
                  wasInitialized: handInitializedRef.current,
                  previousHandLength: myHand.length,
                  myPlayer: {
                    userId: myPlayer.userId?.toString(),
                    score: myPlayer.score,
                    books: myPlayer.books
                  }
                });
                setMyHand(hand);
                handInitializedRef.current = true;
                
                // Debug: Log if hand is empty
                if (hand.length === 0 && data.gameStatus === 'playing') {
                  console.error(`❌ [CardGameScreen] ERROR: Player ${myUserId} has 0 cards in active game!`, {
                    myPlayer,
                    allPlayers: data.players.map((p: any) => ({
                      userId: p.userId?.toString(),
                      hasHand: !!p.hand,
                      handLength: p.hand?.length || p.handCount || 0,
                      hand: p.hand || 'N/A (opponent)'
                    })),
                    gameState: {
                      roomId: data.roomId,
                      turn: data.turn,
                      deckCount: data.deckCount,
                      gameStatus: data.gameStatus
                    }
                  });
                }
              } else {
                console.log(`🃏 [CardGameScreen] Ignoring empty hand update (keeping existing ${myHand.length} cards)`, {
                  receivedHandLength: hand.length,
                  currentHandLength: myHand.length
                });
              }
            } else {
              // If we didn't receive a hand, don't overwrite existing hand
              console.log(`🃏 [CardGameScreen] No hand in state update (only handCount), keeping existing hand`, {
                myPlayer,
                currentHandLength: myHand.length,
                handInitialized: handInitializedRef.current
              });
            }
            
            // Always update score and books
            const newScore = myPlayer.score || 0;
            const newBooksCount = (myPlayer.books || []).length;
            const previousScore = previousScoreRef.current;
            const previousBooksCount = previousBooksCountRef.current;
            
            // Play book sound if we made a new book (score increased or books count increased)
            if (newScore > previousScore || newBooksCount > previousBooksCount) {
              console.log(`🎉 [CardGameScreen] New book detected! Score: ${previousScore} -> ${newScore}, Books: ${previousBooksCount} -> ${newBooksCount}`);
              playSound('book');
            }
            
            // Update refs for next comparison
            previousScoreRef.current = newScore;
            previousBooksCountRef.current = newBooksCount;
            
            setMyScore(newScore);
            setMyBooks(myPlayer.books || []);
          } else {
            console.error(`❌ [CardGameScreen] Could not find my player in game state`, {
              myUserId,
              players: data.players.map((p: any) => ({
                userId: p.userId?.toString(),
                userIdType: typeof p.userId,
                hasHand: !!p.hand,
                handLength: p.hand?.length || p.handCount || 0
              }))
            });
          }
          
          if (opponentPlayer) {
            setOpponentHandCount(opponentPlayer.handCount || opponentPlayer.hand?.length || 0);
            setOpponentScore(opponentPlayer.score || 0);
            setOpponentBooks(opponentPlayer.books || []);
          }
        }
        
      setDeckCount(data.deckCount || 0);
      
      const myPlayerIndex = data.players?.findIndex((p: any) => {
        const pUserId = p.userId?.toString();
        const myUserId = user?._id?.toString();
        return pUserId === myUserId;
      });
      const newIsMyTurn = data.turn === myPlayerIndex;
      const currentTurnIndex = data.turn;
      
      // Play sound ONLY when turn switches from opponent to us
      // Conditions:
      // 1. Game is live
      // 2. It's now our turn
      // 3. We have a previous turn index to compare
      // 4. The turn index actually changed
      // 5. The previous turn was NOT ours (it was opponent's)
      const turnSwitchedToUs = gameLive && 
          newIsMyTurn && 
          previousTurnIndexRef.current !== null && 
          previousTurnIndexRef.current !== currentTurnIndex &&
          previousTurnIndexRef.current !== myPlayerIndex;
      
      if (turnSwitchedToUs) {
        // Turn switched from opponent to us - play sound
        console.log('🔔 [CardGameScreen] Turn switched to us, playing sound', {
          previousTurn: previousTurnIndexRef.current,
          currentTurn: currentTurnIndex,
          myPlayerIndex
        });
        playSound('play');
      }
      
      // Always update the turn index ref (even if it's still our turn after our move)
      // This ensures we track the actual game state from the server
      previousTurnIndexRef.current = currentTurnIndex;
      setIsMyTurn(newIsMyTurn);
      
      // Update last move message and play sounds
      if (data.lastMove) {
        const move = data.lastMove;
        if (move.action === 'ask') {
          const rankName = getRankName(move.rank || 0);
          
          // Play book sound if a book was made (4 of a kind)
          if (move.newBooks && move.newBooks > 0) {
            console.log(`🎉 [CardGameScreen] Book made! Playing book sound...`);
            playSound('book');
          }
          
          if (move.gotCards) {
            setLastMoveMessage(`${move.cardsReceived} ${rankName}${move.cardsReceived! > 1 ? 's' : ''} received! ${move.newBooks! > 0 ? `Made ${move.newBooks} book${move.newBooks! > 1 ? 's' : ''}!` : ''}`);
          } else {
            setLastMoveMessage(`Go Fish! ${move.drewMatchingCard ? 'Got it!' : ''}`);
            // Play card flip sound for Go Fish action (when opponent doesn't have the card)
            // This happens whenever gotCards is false, regardless of deck status
            playSound('cardFlip');
          }
        }
      }
      
      // Play game start sound when game first becomes live (only once per game)
      if (data.gameStatus === 'playing' && !gameStartSoundPlayedRef.current) {
        playSound('gameStart');
        gameStartSoundPlayedRef.current = true; // Mark as played
      }
      
      // Set gameLive based on gameStatus
      if (data.gameStatus === 'playing') {
        console.log('✅ [CardGameScreen] Setting gameLive=true (gameStatus: playing)');
        setGameLive(true);
      } else if (data.gameStatus === 'finished') {
        console.log('🏁 [CardGameScreen] Game finished');
        setGameLive(false);
        setGameOver(true);
      }
    };

    const handleOpponentMove = (data: any) => {
      const activeRoomId = currentRoomIdRef.current;
      if (!activeRoomId || activeRoomId !== roomId) {
        console.log('⚠️ [CardGameScreen] Ignoring opponentMove - roomId changed');
        return;
      }
      
      if (data.roomId && data.roomId !== activeRoomId) {
        console.log('⚠️ [CardGameScreen] Ignoring opponentMove - roomId mismatch');
        return;
      }
      
      console.log('📥 [CardGameScreen] Opponent move received:', data);
      
      // Request updated game state from server
      if (socket && roomId) {
        socket.emit('requestCardGameState', { roomId });
      }
    };

    const handleGameOver = (data: any) => {
      const activeRoomId = currentRoomIdRef.current;
      if (!activeRoomId || (data?.roomId && data.roomId !== activeRoomId)) {
        return;
      }
      
      if (activeRoomId === roomId) {
        setGameOver(true);
        setGameResult(data.message || 'Game Over');
        showToast('Game Over', data.message, 'info');
        // Remove own card game post from feed immediately (frontend only)
        // Backend will also delete and broadcast to followers
        if (!isSpectator) {
          removeOwnCardPost();
        }
      }
    };

    // Register event listeners
    socket.on('cardGameState', handleGameState);
    socket.on('opponentMove', handleOpponentMove);
    socket.on('cardGameEnded', handleGameOver);
    socket.on('cardGameCleanup', () => {
      const activeRoomId = currentRoomIdRef.current;
      if (activeRoomId === currentRoomId) {
        setGameOver(true);
        setGameLive(false);
        // Remove own card game post from feed immediately (frontend only)
        if (!isSpectator) {
          removeOwnCardPost();
        }
        showToast('Game Ended', 'Game was canceled or ended', 'info');
        setTimeout(() => {
          navigation.goBack();
        }, 1000);
      }
    });

    // Join the room
    socket.emit('joinCardRoom', { roomId: currentRoomId, userId: user?._id });
    // Don't request state immediately - joinCardRoom will send it
    // Only request if we don't receive state within 1 second
    const stateRequestTimeout = setTimeout(() => {
      if (!gameLive) {
        console.log('🃏 [CardGameScreen] No state received from joinCardRoom, requesting...');
        socket.emit('requestCardGameState', { roomId: currentRoomId });
      }
    }, 1000);

    // Cleanup function
    return () => {
      console.log('🃏 [CardGameScreen] Cleanup function called for room:', currentRoomId);
      clearTimeout(stateRequestTimeout);
      currentRoomIdRef.current = null;
      socket.off('cardGameState');
      socket.off('opponentMove');
      socket.off('cardGameEnded');
      socket.off('cardGameCleanup');
      socket.off('cardMove');
    };
  }, [socket, roomId]);

  useEffect(() => {
    setOpponent(null);
    if (opponentId) {
      fetchOpponent();
    }
  }, [opponentId]);

  const fetchOpponent = async () => {
    if (!opponentId) {
      setOpponent(null);
      return;
    }

    const currentOpponentId = opponentId;
    
    try {
      const baseUrl = API_URL;
      const response = await fetch(`${baseUrl}/api/user/getUserPro/${currentOpponentId}`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (currentOpponentId === opponentId && response.ok) {
        console.log('✅ [CardGameScreen] Setting opponent:', data.name);
        setOpponent(data);
      }
    } catch (error) {
      console.error('❌ [CardGameScreen] Error fetching opponent:', error);
    }
  };

  const handleAskForRank = useCallback((rank: number) => {
    if (!socket || !roomId || !opponentId || !isMyTurn || gameOver) {
      return;
    }

    // Validate: player must have at least one card of this rank
    if (!myHand.some(card => card.value === rank)) {
      showToast('Invalid Move', 'You must have at least one card of that rank to ask for it', 'error');
      return;
    }

    setShowRankModal(false);
    setIsMyTurn(false); // Will be updated by server response

    // Send "ask" move to server
    const moveData = {
      roomId,
      move: {
        action: 'ask',
        rank: rank,
      },
      to: opponentId,
    };
    
    socket.emit('cardMove', moveData);
  }, [socket, roomId, opponentId, isMyTurn, gameOver, myHand, showToast]);

  const handleBack = () => {
    // Only emit resign if user is a player (not a spectator)
    // Spectators should just leave silently without ending the game
    if (!isSpectator && socket && roomId && opponentId) {
      socket.emit('resignCard', { roomId, to: opponentId });
      // Remove own card game post immediately (frontend only)
      // Backend will also delete and broadcast to followers
      removeOwnCardPost();
    } else if (isSpectator) {
      console.log('👁️ [CardGameScreen] Spectator leaving - not emitting any game end events');
    }
    navigation.goBack();
  };

  const handleResign = () => {
    Alert.alert(
      'Resign',
      'Are you sure you want to resign?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resign',
          style: 'destructive',
          onPress: () => {
            if (socket && roomId && opponentId) {
              socket.emit('resignCard', { roomId, to: opponentId });
            }
            removeOwnCardPost();
            navigation.goBack();
          },
        },
      ]
    );
  };

  const removeOwnCardPost = () => {
    // Remove card game post from feed (frontend only)
    // Backend will handle actual deletion
    if (!roomId) {
      console.log('⚠️ [CardGameScreen] No roomId to remove post');
      return;
    }
    
    // Find and delete all posts with matching roomId in cardGameData
    const postsToDelete: string[] = [];
    posts.forEach((post: any) => {
      if (post.cardGameData) {
        try {
          const cardData = typeof post.cardGameData === 'string' 
            ? JSON.parse(post.cardGameData) 
            : post.cardGameData;
          if (cardData && cardData.roomId === roomId) {
            postsToDelete.push(post._id);
          }
        } catch (error) {
          console.error('❌ [CardGameScreen] Error parsing cardGameData:', error);
        }
      }
    });
    
    // Delete all matching posts
    postsToDelete.forEach((postId) => {
      deletePost(postId);
      console.log(`🗑️ [CardGameScreen] Removed card game post: ${postId}`);
    });
    
    if (postsToDelete.length === 0) {
      console.log('ℹ️ [CardGameScreen] No card game posts found to remove');
    }
  };

  if (!gameLive) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton} activeOpacity={0.7}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isSpectator ? 'Watching Go Fish' : 'Go Fish'}
          </Text>
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={() => setShowHelpModal(true)} style={styles.helpButton}>
              <Text style={styles.helpButtonText}>?</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Waiting for game to start...</Text>
        </View>
      </View>
    );
  }

  const availableRanks = getAvailableRanks(myHand);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isSpectator ? 'Watching Go Fish' : 'Go Fish'}
        </Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => setShowHelpModal(true)} style={styles.helpButton}>
            <Text style={styles.helpButtonText}>?</Text>
          </TouchableOpacity>
          {!isSpectator && (
            <TouchableOpacity onPress={handleResign} style={styles.resignButton}>
              <Text style={styles.resignText}>Resign</Text>
            </TouchableOpacity>
          )}
          {isSpectator && <View style={styles.resignButton} />}
        </View>
      </View>

      {/* Scores */}
      <View style={styles.scoresContainer}>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>You</Text>
          <Text style={styles.scoreValue}>{myScore}</Text>
          <Text style={styles.booksText}>{myBooks.length} book{myBooks.length !== 1 ? 's' : ''}</Text>
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>{opponent?.name || 'Opponent'}</Text>
          <Text style={styles.scoreValue}>{opponentScore}</Text>
          <Text style={styles.booksText}>{opponentBooks.length} book{opponentBooks.length !== 1 ? 's' : ''}</Text>
        </View>
      </View>

      {/* Opponent Info */}
      <View style={styles.playerInfo}>
        <Text style={styles.playerName}>
          {opponent?.name || 'Opponent'} ({opponentHandCount} cards)
        </Text>
        <View style={styles.turnIndicatorContainer}>
          {!isMyTurn && !gameOver && (
            <Text style={styles.turnIndicator}>Their Turn</Text>
          )}
        </View>
      </View>

      {/* Last Move Message */}
      <View style={styles.lastMoveContainer}>
        {lastMoveMessage ? (
          <Text style={styles.lastMoveText}>{lastMoveMessage}</Text>
        ) : null}
      </View>

      {/* Deck Count */}
      <View style={styles.deckInfo}>
        <Text style={styles.deckText}>Deck: {deckCount} cards remaining</Text>
      </View>

      {/* Player's Hand */}
      <View style={styles.handArea}>
        <View style={styles.handHeader}>
          <Text style={styles.handTitle}>Your Hand ({myHand.length} cards)</Text>
          <View style={styles.askButtonContainer}>
            {isMyTurn && !gameOver && availableRanks.length > 0 && (
              <TouchableOpacity 
                onPress={() => setShowRankModal(true)} 
                style={styles.askButton}
              >
                <Text style={styles.askButtonText}>Ask for Rank</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <ScrollView 
          style={styles.handScrollContainer}
          contentContainerStyle={styles.handContainer}
          showsVerticalScrollIndicator={false}
        >
          {myHand.length > 0 ? (
            myHand.map((card, index) => {
              const isClickable = isMyTurn && !gameOver && availableRanks.includes(card.value);
              return (
                <Card
                  key={index}
                  suit={card.suit}
                  value={card.value}
                  style={[
                    styles.handCard,
                    isClickable && styles.clickableCard,
                    !isClickable && styles.disabledCard
                  ]}
                  onPress={isClickable ? () => handleAskForRank(card.value) : undefined}
                />
              );
            })
          ) : (
            <Text style={styles.emptyHandText}>No cards left</Text>
          )}
        </ScrollView>
        
        {/* Turn Instructions - Fixed height container to prevent layout shift */}
        <View style={styles.turnActionContainer}>
          {isMyTurn && !gameOver && availableRanks.length > 0 && (
            <>
              <Text style={styles.yourTurn}>Your Turn - Tap a card to ask for that rank!</Text>
              <Text style={styles.helpHint}>💡 Tip: Tap any card you have to ask your opponent for that rank</Text>
            </>
          )}
          {isMyTurn && !gameOver && availableRanks.length === 0 && myHand.length === 0 && (
            <>
              <Text style={styles.yourTurnWarning}>⚠️ Your Turn - But you have no cards! Game may be stuck.</Text>
              <Text style={styles.helpText}>Please wait or contact support if this persists.</Text>
            </>
          )}
          {isMyTurn && !gameOver && availableRanks.length === 0 && myHand.length > 0 && (
            <>
              <Text style={styles.yourTurnWarning}>⚠️ Your Turn - But you have no valid ranks to ask for!</Text>
              <Text style={styles.helpText}>This shouldn't happen. Please wait or contact support.</Text>
            </>
          )}
          {!isMyTurn && !gameOver && (
            <Text style={styles.waitingText}>Waiting for {opponent?.name || 'opponent'}'s turn...</Text>
          )}
        </View>
      </View>

      {/* My Books */}
      {myBooks.length > 0 && (
        <View style={styles.booksContainer}>
          <Text style={styles.booksTitle}>Your Books:</Text>
          <View style={styles.booksList}>
            {myBooks.map((rank, index) => (
              <View key={index} style={styles.bookBadge}>
                <Text style={styles.bookText}>{getRankName(rank)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Help/Instructions Modal */}
      <Modal
        visible={showHelpModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowHelpModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.helpModalContent}>
            <View style={styles.helpModalHeader}>
              <Text style={styles.helpModalTitle}>🃏 How to Play Go Fish</Text>
              <TouchableOpacity 
                onPress={() => setShowHelpModal(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.helpContent}>
              <View style={styles.helpSection}>
                <Text style={styles.helpSectionTitle}>📖 Objective</Text>
                <Text style={styles.helpText}>
                  Collect "books" (4 cards of the same rank) to score points. The player with the most books wins!
                </Text>
              </View>

              <View style={styles.helpSection}>
                <Text style={styles.helpSectionTitle}>🎮 How to Play</Text>
                <Text style={styles.helpStep}>1. On your turn, tap "Ask for a Rank"</Text>
                <Text style={styles.helpStep}>2. Select a rank (Ace, 2, 3, etc.) that you have in your hand</Text>
                <Text style={styles.helpStep}>3. Ask your opponent: "Do you have any [rank]s?"</Text>
                <Text style={styles.helpStep}>4. If they have it: They give you ALL cards of that rank</Text>
                <Text style={styles.helpStep}>5. If they don't: You "Go Fish" - draw a card from the deck</Text>
                <Text style={styles.helpStep}>6. If you get 4 of a kind, you score a "book"!</Text>
              </View>

              <View style={styles.helpSection}>
                <Text style={styles.helpSectionTitle}>💡 Tips</Text>
                <Text style={styles.helpTip}>• You can only ask for ranks you have in your hand</Text>
                <Text style={styles.helpTip}>• If you get cards from your opponent, you get another turn!</Text>
                <Text style={styles.helpTip}>• If you "Go Fish" and get the card you asked for, you get another turn!</Text>
                <Text style={styles.helpTip}>• The game ends when someone runs out of cards or the deck is empty</Text>
              </View>

              <View style={styles.helpSection}>
                <Text style={styles.helpSectionTitle}>🏆 Winning & Game End</Text>
                <Text style={styles.helpText}>
                  The game ends when:
                </Text>
                <Text style={styles.helpStep}>• Both players run out of cards, OR</Text>
                <Text style={styles.helpStep}>• The deck is empty and both players have no cards left</Text>
                <Text style={styles.helpText} style={{ marginTop: 10 }}>
                  The player with the most books (4 of a kind) wins the game!
                </Text>
                <Text style={styles.helpText}>
                  If both players have the same number of books, it's a tie.
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Rank Selection Modal */}
      <Modal
        visible={showRankModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRankModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.rankModalContent}>
            <Text style={styles.rankModalTitle}>Ask for a Rank</Text>
            <Text style={styles.rankModalSubtitle}>Select a rank you have in your hand:</Text>
            <ScrollView style={styles.ranksList}>
              {availableRanks.map((rank) => {
                const count = myHand.filter(c => c.value === rank).length;
                return (
                  <TouchableOpacity
                    key={rank}
                    style={styles.rankButton}
                    onPress={() => handleAskForRank(rank)}
                  >
                    <Text style={styles.rankButtonText}>
                      {getRankName(rank)} ({count} card{count !== 1 ? 's' : ''})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowRankModal(false)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Game Over Overlay */}
      {gameOver && (
        <View style={styles.gameOverOverlay}>
          <View style={styles.gameOverBox}>
            <Text style={styles.gameOverTitle}>Game Over</Text>
            <Text style={styles.gameOverMessage}>{gameResult}</Text>
            <TouchableOpacity
              style={styles.gameOverButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.gameOverButtonText}>Back to Lobby</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
  loadingText: {
    color: COLORS.text,
    fontSize: 16,
    marginTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
    height: 50, // Fixed compact height
  },
  backButton: {
    padding: 8,
    minWidth: 40,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backArrow: {
    fontSize: 28,
    color: COLORS.text,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  helpButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  helpButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  resignButton: {
    padding: 5,
  },
  resignText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: 'bold',
  },
  scoresContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: COLORS.backgroundLight,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    height: 50, // Reduced from 70 to give more space to cards
  },
  scoreBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  scoreLabel: {
    fontSize: 10,
    color: COLORS.textGray,
    marginBottom: 1,
  },
  scoreValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  booksText: {
    fontSize: 9,
    color: COLORS.textGray,
    marginTop: 1,
  },
  playerInfo: {
    paddingVertical: 6,
    paddingHorizontal: 15,
    alignItems: 'center',
    height: 50, // Reduced from 70 to give more space to cards
    justifyContent: 'center',
  },
  playerName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  turnIndicatorContainer: {
    height: 18, // Reduced from 22
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  turnIndicator: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  lastMoveContainer: {
    height: 30, // Reduced from 40 to give more space to cards
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: COLORS.backgroundLight,
    marginHorizontal: 15,
    marginBottom: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastMoveText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  deckInfo: {
    paddingHorizontal: 15,
    paddingVertical: 4,
    alignItems: 'center',
    height: 28, // Reduced from 35 to give more space to cards
    justifyContent: 'center',
  },
  deckText: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  handArea: {
    flex: 1,
    padding: 15,
    backgroundColor: COLORS.backgroundLight,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  handHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    height: 40, // Fixed height to prevent layout shift when button appears/disappears
  },
  handTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  askButtonContainer: {
    width: 120, // Fixed width to reserve space for button (prevents layout shift)
    alignItems: 'flex-end',
  },
  askButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  askButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  turnActionContainer: {
    marginTop: 15,
    alignItems: 'center',
    height: 70, // Fixed height to prevent layout shift when turn messages appear/disappear (not minHeight)
    justifyContent: 'center',
  },
  askButtonLarge: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginTop: 10,
    minWidth: 200,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  askButtonLargeText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  helpText: {
    color: COLORS.textGray,
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  waitingText: {
    color: COLORS.textGray,
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  handScrollContainer: {
    flex: 1, // Take available space - but parent handArea has flex:1 so this is constrained
  },
  handContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    paddingHorizontal: 5,
    paddingBottom: 10,
  },
  handCard: {
    marginRight: 5,
    marginBottom: 10,
    width: (width - 50) / 4, // 4 columns: (screen width - padding) / 4
    height: ((width - 50) / 4) * 1.4, // Maintain card aspect ratio (height = width * 1.4)
  },
  clickableCard: {
    borderWidth: 2,
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  disabledCard: {
    opacity: 0.5,
  },
  emptyHandText: {
    color: COLORS.textGray,
    fontSize: 14,
    fontStyle: 'italic',
  },
  helpHint: {
    color: COLORS.textGray,
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  turnActionContainer: {
    marginTop: 15,
    alignItems: 'center',
    height: 70, // Fixed height to prevent layout shift when turn messages appear/disappear (not minHeight)
    justifyContent: 'center',
  },
  yourTurn: {
    color: COLORS.primary,
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
  yourTurnWarning: {
    color: COLORS.error,
    fontWeight: 'bold',
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },
  askButtonLarge: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginTop: 10,
    minWidth: 200,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  askButtonLargeText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  helpText: {
    color: COLORS.textGray,
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  waitingText: {
    color: COLORS.textGray,
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  booksContainer: {
    padding: 2,
    paddingBottom: 4,
    backgroundColor: COLORS.backgroundLight,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  booksTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  booksList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  bookBadge: {
    backgroundColor: COLORS.success,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginRight: 4,
    marginBottom: 4,
  },
  bookText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  rankModalContent: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rankModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  rankModalSubtitle: {
    fontSize: 14,
    color: COLORS.textGray,
    marginBottom: 16,
    textAlign: 'center',
  },
  ranksList: {
    maxHeight: 300,
  },
  rankButton: {
    backgroundColor: COLORS.background,
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rankButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  cancelButton: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: COLORS.error,
  },
  cancelButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  helpModalContent: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  helpModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  helpModalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
    flex: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  helpContent: {
    maxHeight: 500,
  },
  helpSection: {
    marginBottom: 20,
  },
  helpSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 10,
  },
  helpText: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 8,
  },
  helpStep: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 22,
    marginBottom: 6,
    paddingLeft: 8,
  },
  helpTip: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 6,
    paddingLeft: 8,
    fontStyle: 'italic',
  },
  gameOverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gameOverBox: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    minWidth: 280,
  },
  gameOverTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  gameOverMessage: {
    fontSize: 16,
    color: COLORS.textGray,
    textAlign: 'center',
    marginBottom: 24,
  },
  gameOverButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  gameOverButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default CardGameScreen;
