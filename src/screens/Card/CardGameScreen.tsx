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
  const { deletePost } = usePost();
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
            setMyScore(myPlayer.score || 0);
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
      setIsMyTurn(data.turn === myPlayerIndex);
      
      // Update last move message
      if (data.lastMove) {
        const move = data.lastMove;
        if (move.action === 'ask') {
          const rankName = getRankName(move.rank || 0);
          if (move.gotCards) {
            setLastMoveMessage(`${move.cardsReceived} ${rankName}${move.cardsReceived! > 1 ? 's' : ''} received! ${move.newBooks! > 0 ? `Made ${move.newBooks} book${move.newBooks! > 1 ? 's' : ''}!` : ''}`);
          } else {
            setLastMoveMessage(`Go Fish! ${move.drewMatchingCard ? 'Got it!' : ''}`);
          }
        }
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
    if (!isSpectator && socket && roomId && opponentId) {
      socket.emit('resignCard', { roomId, to: opponentId });
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
    if (gameState?.roomId) {
      console.log('🗑️ [CardGameScreen] Removing card game post');
    }
  };

  if (!gameLive) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Waiting for game to start...</Text>
      </View>
    );
  }

  const availableRanks = getAvailableRanks(myHand);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
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
        {!isMyTurn && !gameOver && (
          <Text style={styles.turnIndicator}>Their Turn</Text>
        )}
      </View>

      {/* Last Move Message */}
      {lastMoveMessage ? (
        <View style={styles.lastMoveContainer}>
          <Text style={styles.lastMoveText}>{lastMoveMessage}</Text>
        </View>
      ) : null}

      {/* Deck Count */}
      <View style={styles.deckInfo}>
        <Text style={styles.deckText}>Deck: {deckCount} cards remaining</Text>
      </View>

      {/* Player's Hand */}
      <View style={styles.handArea}>
        <View style={styles.handHeader}>
          <Text style={styles.handTitle}>Your Hand ({myHand.length} cards)</Text>
          {isMyTurn && !gameOver && availableRanks.length > 0 && (
            <TouchableOpacity 
              onPress={() => setShowRankModal(true)} 
              style={styles.askButton}
            >
              <Text style={styles.askButtonText}>Ask for Rank</Text>
            </TouchableOpacity>
          )}
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
        
        {/* Turn Instructions */}
        {isMyTurn && !gameOver && availableRanks.length > 0 && (
          <View style={styles.turnActionContainer}>
            <Text style={styles.yourTurn}>Your Turn - Tap a card to ask for that rank!</Text>
            <Text style={styles.helpHint}>💡 Tip: Tap any card you have to ask your opponent for that rank</Text>
          </View>
        )}
        {isMyTurn && !gameOver && availableRanks.length === 0 && myHand.length === 0 && (
          <View style={styles.turnActionContainer}>
            <Text style={styles.yourTurnWarning}>⚠️ Your Turn - But you have no cards! Game may be stuck.</Text>
            <Text style={styles.helpText}>Please wait or contact support if this persists.</Text>
          </View>
        )}
        {isMyTurn && !gameOver && availableRanks.length === 0 && myHand.length > 0 && (
          <View style={styles.turnActionContainer}>
            <Text style={styles.yourTurnWarning}>⚠️ Your Turn - But you have no valid ranks to ask for!</Text>
            <Text style={styles.helpText}>This shouldn't happen. Please wait or contact support.</Text>
          </View>
        )}
        {!isMyTurn && !gameOver && (
          <Text style={styles.waitingText}>Waiting for {opponent?.name || 'opponent'}'s turn...</Text>
        )}
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
                <Text style={styles.helpSectionTitle}>🏆 Winning</Text>
                <Text style={styles.helpText}>
                  The player with the most books (4 of a kind) wins the game!
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
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 5,
  },
  backArrow: {
    fontSize: 24,
    color: COLORS.text,
  },
  headerTitle: {
    fontSize: 18,
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
    padding: 8,
    backgroundColor: COLORS.backgroundLight,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  scoreBox: {
    alignItems: 'center',
    flex: 1,
  },
  scoreLabel: {
    fontSize: 12,
    color: COLORS.textGray,
    marginBottom: 2,
  },
  scoreValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  booksText: {
    fontSize: 10,
    color: COLORS.textGray,
    marginTop: 2,
  },
  playerInfo: {
    padding: 15,
    alignItems: 'center',
  },
  playerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  turnIndicator: {
    fontSize: 14,
    color: COLORS.textGray,
    marginTop: 4,
  },
  lastMoveContainer: {
    padding: 10,
    backgroundColor: COLORS.backgroundLight,
    marginHorizontal: 15,
    marginBottom: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  lastMoveText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  deckInfo: {
    paddingHorizontal: 15,
    paddingBottom: 10,
    alignItems: 'center',
  },
  deckText: {
    fontSize: 14,
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
  },
  handTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
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
    maxHeight: 800, // Increased height for more cards visibility
    flex: 1, // Take available space
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
