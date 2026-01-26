import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { Chess } from 'chess.js';
import Sound from 'react-native-sound';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { usePost } from '../../context/PostContext';
import { API_URL, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import ChessBoard from '../../components/ChessBoard';

const { width } = Dimensions.get('window');

interface ChessGameScreenProps {
  navigation: any;
  route: any;
}

const ChessGameScreen: React.FC<ChessGameScreenProps> = ({ navigation, route }) => {
  const { roomId, opponentId, color, isSpectator } = route.params || {};
  const { user } = useUser();
  const { socket } = useSocket();
  const { deletePost, posts } = usePost();
  const showToast = useShowToast();

  console.log('♟️ [ChessGameScreen] Initializing with:', { roomId, opponentId, color, isSpectator });

  const chess = useMemo(() => new Chess(), []);
  const [fen, setFen] = useState(chess.fen());
  const [orientation, setOrientation] = useState<'white' | 'black'>(color || 'white');
  const [opponent, setOpponent] = useState<any>(null);
  // For spectators: track both players
  const [player1, setPlayer1] = useState<any>(null); // WHITE player (challenger)
  const [player2, setPlayer2] = useState<any>(null); // BLACK player (accepter)
  const [gameLive, setGameLive] = useState(true);
  const [gameOver, setGameOver] = useState(false);
  const [gameResult, setGameResult] = useState('');
  const [capturedWhite, setCapturedWhite] = useState<string[]>([]);
  const [capturedBlack, setCapturedBlack] = useState<string[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  // Track current roomId to prevent processing events from old rooms
  const currentRoomIdRef = useRef<string | null>(null);
  // Track previous roomId to detect game switches
  const previousRoomIdRef = useRef<string | null>(null);
  
  // Sound effects
  const sounds = useRef<{
    move?: Sound;
    capture?: Sound;
    check?: Sound;
    gameStart?: Sound;
  }>({});

  // Initialize sounds
  useEffect(() => {
    // Enable playback in silence mode (iOS)
    Sound.setCategory('Playback', true);
    
    // Load sound files
    // For Android: files should be in android/app/src/main/res/raw/
    // For iOS: files are bundled via require()
    sounds.current.move = new Sound('p.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [ChessGameScreen] Failed to load move sound:', error);
        // Fallback: try require() for iOS/bundled assets
        try {
          sounds.current.move = new Sound(require('../../assets/sounds/p.mp3'), (error2) => {
            if (error2) {
              console.error('❌ [ChessGameScreen] Failed to load move sound (fallback):', error2);
            }
          });
        } catch (e) {
          console.error('❌ [ChessGameScreen] Could not load move sound:', e);
        }
      }
    });
    
    sounds.current.capture = new Sound('k.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [ChessGameScreen] Failed to load capture sound:', error);
        try {
          sounds.current.capture = new Sound(require('../../assets/sounds/k.mp3'), (error2) => {
            if (error2) {
              console.error('❌ [ChessGameScreen] Failed to load capture sound (fallback):', error2);
            }
          });
        } catch (e) {
          console.error('❌ [ChessGameScreen] Could not load capture sound:', e);
        }
      }
    });
    
    sounds.current.check = new Sound('c.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [ChessGameScreen] Failed to load check sound:', error);
        try {
          sounds.current.check = new Sound(require('../../assets/sounds/c.mp3'), (error2) => {
            if (error2) {
              console.error('❌ [ChessGameScreen] Failed to load check sound (fallback):', error2);
            }
          });
        } catch (e) {
          console.error('❌ [ChessGameScreen] Could not load check sound:', e);
        }
      }
    });
    
    sounds.current.gameStart = new Sound('start.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [ChessGameScreen] Failed to load game start sound:', error);
        try {
          sounds.current.gameStart = new Sound(require('../../assets/sounds/start.mp3'), (error2) => {
            if (error2) {
              console.error('❌ [ChessGameScreen] Failed to load game start sound (fallback):', error2);
            }
          });
        } catch (e) {
          console.error('❌ [ChessGameScreen] Could not load game start sound:', e);
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

  const playSound = useCallback((type: 'move' | 'capture' | 'check' | 'gameStart') => {
    const sound = sounds.current[type];
    if (sound) {
      sound.stop(() => {
        sound.play((success) => {
          if (!success) {
            console.warn(`⚠️ [ChessGameScreen] Failed to play ${type} sound`);
          }
        });
      });
    }
  }, []);

  useEffect(() => {
    if (!socket || !roomId) {
      console.warn('⚠️ [ChessGameScreen] Socket or roomId not available');
      return;
    }

    // CRITICAL: Remove ALL listeners FIRST to prevent interference from old handlers
    // This must happen BEFORE we update refs or set up new listeners
    console.log('♟️ [ChessGameScreen] Removing all chess listeners before setup');
    socket.off('gameState');
    socket.off('chessGameState');
    socket.off('opponentMove');
    socket.off('gameOver');
    socket.off('opponentLeft');
    socket.off('opponentResigned');
    socket.off('chessGameEnded');
    socket.off('chessGameCleanup');
    socket.off('chessMove');
    
    // CRITICAL: Clear ref IMMEDIATELY to prevent any events from being processed during transition
    currentRoomIdRef.current = null;

    // CRITICAL: Clear all game state when roomId changes to prevent interference
    const isSwitchingGames = previousRoomIdRef.current && previousRoomIdRef.current !== roomId;
    
    if (isSwitchingGames) {
      console.log('♟️ [ChessGameScreen] Switching games:', {
        from: previousRoomIdRef.current,
        to: roomId
      });
    }
    
    console.log('♟️ [ChessGameScreen] RoomId changed, clearing state for:', roomId);
    chess.reset();
    setFen(chess.fen());
    setCapturedWhite([]);
    setCapturedBlack([]);
    setGameOver(false);
    setGameResult('');
    setSelectedSquare(null);
    setLegalMoves([]);
    setGameLive(false); // Will be set to true when game state is received
    // Clear player states when switching games
    setPlayer1(null);
    setPlayer2(null);
    setOpponent(null);

    // Store current roomId to track which room we're in
    const currentRoomId = roomId;
    const oldRoomId = previousRoomIdRef.current;
    
    // Update refs AFTER clearing old listeners
    previousRoomIdRef.current = currentRoomId;
    currentRoomIdRef.current = currentRoomId; // Update ref immediately
    
    console.log('♟️ [ChessGameScreen] Joining chess room:', currentRoomId, { isSpectator, oldRoomId });
    
    // Join the new room (backend will automatically leave old chess rooms)
    socket.emit('joinChessRoom', { roomId: currentRoomId, userId: user?._id });
    socket.emit('requestChessGameState', { roomId: currentRoomId });

    // Create wrapped handlers that check roomId using closure to capture currentRoomId
    // This ensures we only process events for the current room, even if roomId changes
    const wrappedHandleGameState = (data: any) => {
      // CRITICAL: Only apply if roomId matches (prevent switching to other games)
      const activeRoomId = currentRoomIdRef.current;
      if (!activeRoomId) {
        console.log('⚠️ [ChessGameScreen] Ignoring gameState - no active roomId');
        return;
      }
      if (data.roomId && data.roomId !== activeRoomId) {
        console.log('⚠️ [ChessGameScreen] Ignoring gameState - roomId mismatch:', {
          received: data.roomId,
          active: activeRoomId
        });
        return;
      }
      // Only process if activeRoomId matches the current roomId prop (double check)
      if (activeRoomId === roomId) {
        handleGameState(data);
      } else {
        console.log('⚠️ [ChessGameScreen] Ignoring gameState - roomId changed:', {
          activeRoomId,
          currentRoomId: roomId
        });
      }
    };

    const wrappedHandleOpponentMove = (data: any) => {
      // CRITICAL: Only process moves for the current room (prevent interference from other games)
      const activeRoomId = currentRoomIdRef.current;
      
      // First check: verify we're still viewing the same room
      if (!activeRoomId || activeRoomId !== roomId) {
        console.log('⚠️ [ChessGameScreen] Ignoring opponentMove - roomId changed:', {
          activeRoomId,
          currentRoomId: roomId
        });
        return;
      }
      
      // Second check: if roomId is in data, verify it matches (backend now includes roomId)
      if (data.roomId && data.roomId !== activeRoomId) {
        console.log('⚠️ [ChessGameScreen] Ignoring opponentMove - roomId in data mismatch:', {
          received: data.roomId,
          active: activeRoomId
        });
        return;
      }
      
      // Process the move
      handleOpponentMove(data);
    };

    const wrappedHandleGameOver = (data: any) => {
      // CRITICAL: Only apply if roomId matches (prevent switching to other games)
      const activeRoomId = currentRoomIdRef.current;
      if (!activeRoomId) {
        console.log('⚠️ [ChessGameScreen] Ignoring gameOver - no active roomId');
        return;
      }
      if (data?.roomId && data.roomId !== activeRoomId) {
        console.log('⚠️ [ChessGameScreen] Ignoring gameOver - roomId mismatch:', {
          received: data?.roomId,
          active: activeRoomId
        });
        return;
      }
      // Only process if activeRoomId matches the current roomId prop (double check)
      if (activeRoomId === roomId) {
        handleGameOver(data);
      } else {
        console.log('⚠️ [ChessGameScreen] Ignoring gameOver - roomId changed:', {
          activeRoomId,
          currentRoomId: roomId
        });
      }
    };

    socket.on('gameState', wrappedHandleGameState);
    socket.on('chessGameState', wrappedHandleGameState);
    socket.on('opponentMove', wrappedHandleOpponentMove);
    socket.on('gameOver', wrappedHandleGameOver);
    socket.on('opponentLeft', handleOpponentLeft);
    socket.on('opponentResigned', handleOpponentResigned);
    
    // Listen for game ended/canceled events (for spectators and players)
    const handleGameEnded = (data: any) => {
      console.log('♟️ [ChessGameScreen] Game ended event:', data);
      // CRITICAL: Only process if roomId matches current room
      const activeRoomId = currentRoomIdRef.current;
      if (data.roomId && data.roomId !== activeRoomId) {
        console.log('⚠️ [ChessGameScreen] Ignoring chessGameEnded - roomId mismatch:', {
          received: data.roomId,
          active: activeRoomId
        });
        return;
      }
      if (activeRoomId === currentRoomId) {
        setGameOver(true);
        setGameResult(data.reason || 'Game ended');
        setGameLive(false);
        // Show toast and navigate back
        const reasonText = data.reason === 'resigned' ? 'A player resigned' :
                          data.reason === 'player_disconnected' ? 'A player disconnected' :
                          data.reason === 'checkmate' ? 'Game ended - Checkmate!' :
                          data.reason === 'draw' ? 'Game ended - Draw!' :
                          'Game ended';
        showToast('Game Ended', reasonText, 'info');
        // Navigate back after a short delay
        setTimeout(() => {
          navigation.goBack();
        }, 2000);
      }
    };

    const handleGameCleanup = () => {
      // CRITICAL: Only process cleanup if we're still in the same room
      const activeRoomId = currentRoomIdRef.current;
      if (activeRoomId !== currentRoomId) {
        console.log('⚠️ [ChessGameScreen] Ignoring chessGameCleanup - roomId changed');
        return;
      }
      console.log('♟️ [ChessGameScreen] Game cleanup event');
      setGameOver(true);
      setGameLive(false);
      // Show toast and navigate back immediately for cleanup
      showToast('Game Ended', 'Game was canceled or ended', 'info');
      setTimeout(() => {
        navigation.goBack();
      }, 1000);
    };

    socket.on('chessGameEnded', handleGameEnded);
    socket.on('chessGameCleanup', handleGameCleanup);
    
    socket.on('chessMove', (data: any) => {
      console.log('♟️ [ChessGameScreen] Received chessMove event:', data);
      // Match web version: Trust Socket.IO room filtering, but verify we're still viewing the same room
      const activeRoomId = currentRoomIdRef.current;
      
      // Simple check: only process if we're still viewing the same room
      if (!activeRoomId || activeRoomId !== roomId) {
        console.log('⚠️ [ChessGameScreen] Ignoring chessMove - roomId changed:', {
          activeRoomId,
          currentRoomId: roomId
        });
        return;
      }
      
      // If roomId is in data, verify it matches (extra safety)
      if (data.roomId && data.roomId !== activeRoomId) {
        console.log('⚠️ [ChessGameScreen] Ignoring chessMove - roomId in data mismatch:', {
          received: data.roomId,
          active: activeRoomId
        });
        return;
      }
      
      // Process the move
      handleOpponentMove(data);
    });

    return () => {
      console.log('♟️ [ChessGameScreen] Cleanup function called for room:', currentRoomId);
      // Clear the ref FIRST to prevent any events from being processed
      currentRoomIdRef.current = null;
      // Remove ALL listeners (without handler reference to remove all instances)
      socket.off('gameState');
      socket.off('chessGameState');
      socket.off('opponentMove');
      socket.off('gameOver');
      socket.off('opponentLeft');
      socket.off('opponentResigned');
      socket.off('chessGameEnded');
      socket.off('chessGameCleanup');
      socket.off('chessMove');
    };
  }, [socket, roomId]);

  useEffect(() => {
    // Clear opponent immediately when opponentId changes to prevent showing wrong name
    setOpponent(null);
    // Fetch new opponent
    if (opponentId) {
      fetchOpponent();
    }
  }, [opponentId]);

  const fetchOpponent = async () => {
    if (!opponentId) {
      setOpponent(null);
      return;
    }

    // Store opponentId to verify response is still relevant
    const currentOpponentId = opponentId;
    
    try {
      const baseUrl = API_URL;
      const response = await fetch(`${baseUrl}/api/user/getUserPro/${currentOpponentId}`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      // Verify we're still viewing the same opponent (prevent stale data)
      if (currentOpponentId === opponentId && response.ok) {
        console.log('✅ [ChessGameScreen] Setting opponent:', data.name);
        setOpponent(data);
      } else if (currentOpponentId !== opponentId) {
        console.log('⚠️ [ChessGameScreen] OpponentId changed during fetch, ignoring response');
      }
    } catch (error) {
      console.error('❌ [ChessGameScreen] Error fetching opponent:', error);
      // Only clear if we're still viewing the same opponent
      if (currentOpponentId === opponentId) {
        setOpponent(null);
      }
    }
  };

  const handleGameState = (data: any) => {
    console.log('📥 [ChessGameScreen] Game state received:', data);
    
    // CRITICAL: Only apply game state if roomId matches (prevent switching to other games)
    if (data.roomId && data.roomId !== roomId) {
      console.log('⚠️ [ChessGameScreen] Ignoring game state - roomId mismatch:', {
        received: data.roomId,
        current: roomId
      });
      return;
    }
    
    if (data.fen) {
      try {
        chess.load(data.fen);
        setFen(data.fen);
      } catch (error) {
        console.error('❌ [ChessGameScreen] Failed to load game state FEN:', error);
      }
    }
    
    if (data.orientation) {
      setOrientation(data.orientation);
    }
    
    if (data.capturedWhite && Array.isArray(data.capturedWhite)) {
      setCapturedWhite(data.capturedWhite);
    }
    
    if (data.capturedBlack && Array.isArray(data.capturedBlack)) {
      setCapturedBlack(data.capturedBlack);
    }
    
    // For spectators: fetch both players' info from game state
    if (isSpectator && data.player1Id && data.player2Id) {
      console.log('👁️ [ChessGameScreen] Spectator: Fetching both players:', {
        player1Id: data.player1Id,
        player2Id: data.player2Id
      });
      fetchPlayer(data.player1Id, true);  // WHITE player (challenger)
      fetchPlayer(data.player2Id, false); // BLACK player (accepter)
    }
    
    setGameLive(true);
    
    // Play game start sound when game state is first loaded (game is starting)
    if (data.fen && chess.fen() === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
      // Only play if it's the starting position (new game)
      playSound('gameStart');
    }
  };

  const fetchPlayer = async (playerId: string, isPlayer1: boolean) => {
    if (!playerId) return;
    
    try {
      const baseUrl = API_URL;
      const response = await fetch(`${baseUrl}/api/user/getUserPro/${playerId}`, {
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        if (isPlayer1) {
          console.log('✅ [ChessGameScreen] Set player1 (WHITE):', data.name);
          setPlayer1(data);
        } else {
          console.log('✅ [ChessGameScreen] Set player2 (BLACK):', data.name);
          setPlayer2(data);
        }
      }
    } catch (error) {
      console.error(`❌ [ChessGameScreen] Error fetching ${isPlayer1 ? 'player1' : 'player2'}:`, error);
    }
  };

  const handleOpponentMove = useCallback((data: any) => {
    console.log('📥 ========== RECEIVED MOVE ==========');
    
    // CRITICAL: Only apply moves if roomId matches (prevent switching to other games)
    if (data.roomId && data.roomId !== roomId) {
      console.log('⚠️ [ChessGameScreen] Ignoring move - roomId mismatch:', {
        received: data.roomId,
        current: roomId
      });
      return;
    }
    
    if (data.move && data.move.after) {
      const currentFen = chess.fen();
      if (currentFen === data.move.after) {
        console.log('✅ This is MY OWN move echoed back - IGNORING');
        return;
      }
    }
    
    if (data.move) {
      if (data.move.after) {
        try {
          const beforeFen = chess.fen();
          chess.load(data.move.after);
          setFen(data.move.after);
          
          // Play appropriate sound for opponent's move
          if (chess.inCheck()) {
            playSound('check');
          } else if (data.move.captured) {
            playSound('capture');
          } else {
            playSound('move');
          }
          
          if (data.move.captured) {
            if (data.move.color === 'w') {
              setCapturedBlack(prev => [...prev, data.move.captured]);
            } else {
              setCapturedWhite(prev => [...prev, data.move.captured]);
            }
          }
        } catch (error) {
          console.error('❌ [ChessGameScreen] Failed to load after FEN:', error);
        }
      } else {
        if (data.move.before) {
          const currentFen = chess.fen();
          if (currentFen !== data.move.before) {
            try {
              chess.load(data.move.before);
              setFen(data.move.before);
            } catch (error) {
              return;
            }
          }
        }
        
        try {
          const moveObj: any = {
            from: data.move.from,
            to: data.move.to,
          };
          
          if (data.move.promotion) {
            moveObj.promotion = data.move.promotion;
          }
          
          const moveResult = chess.move(moveObj);
          
          if (moveResult) {
            const newFen = chess.fen();
            setFen(newFen);
            
            // Play appropriate sound for opponent's move
            if (chess.inCheck()) {
              playSound('check');
            } else if (moveResult.captured) {
              playSound('capture');
            } else {
              playSound('move');
            }
            
            if (moveResult.captured) {
              if (moveResult.color === 'w') {
                setCapturedBlack(prev => [...prev, moveResult.captured]);
              } else {
                setCapturedWhite(prev => [...prev, moveResult.captured]);
              }
            }
          }
        } catch (error: any) {
          console.error('❌ [ChessGameScreen] Move application failed:', error.message);
        }
      }
    } else if (data.fen) {
      try {
        chess.load(data.fen);
        setFen(data.fen);
      } catch (error) {
        console.error('❌ [ChessGameScreen] Failed to load FEN:', error);
      }
      
      if (data.captured) {
        if (data.color === 'w') {
          setCapturedBlack(prev => [...prev, data.captured]);
        } else {
          setCapturedWhite(prev => [...prev, data.captured]);
        }
      }
    }
    
    setSelectedSquare(null);
    setLegalMoves([]);
    
    if (chess.isGameOver()) {
      handleLocalGameOver();
    }
  }, [chess, playSound]);

  const removeOwnChessPost = () => {
    // Remove chess game post from feed (frontend only)
    // Backend will handle actual deletion and broadcast to followers
    if (!roomId) {
      console.log('⚠️ [ChessGameScreen] No roomId to remove post');
      return;
    }
    
    // Find and delete all posts with matching roomId in chessGameData
    const postsToDelete: string[] = [];
    posts.forEach((post: any) => {
      if (post.chessGameData) {
        try {
          const chessData = typeof post.chessGameData === 'string' 
            ? JSON.parse(post.chessGameData) 
            : post.chessGameData;
          if (chessData && chessData.roomId === roomId) {
            postsToDelete.push(post._id);
          }
        } catch (error) {
          console.error('❌ [ChessGameScreen] Error parsing chessGameData:', error);
        }
      }
    });
    
    // Delete all matching posts
    postsToDelete.forEach((postId) => {
      deletePost(postId);
      console.log(`🗑️ [ChessGameScreen] Removed chess game post: ${postId}`);
    });
    
    if (postsToDelete.length === 0) {
      console.log('ℹ️ [ChessGameScreen] No chess game posts found to remove');
    }
  };

  const handleGameOver = (data: any) => {
    // CRITICAL: Only apply game over if roomId matches (prevent switching to other games)
    if (data?.roomId && data.roomId !== roomId) {
      console.log('⚠️ [ChessGameScreen] Ignoring game over - roomId mismatch:', {
        received: data.roomId,
        current: roomId
      });
      return;
    }
    
    setGameOver(true);
    setGameResult(data.message || 'Game Over');
    showToast('Game Over', data.message, 'info');
    // Remove own chess game post from feed immediately (frontend only)
    if (!isSpectator) {
      removeOwnChessPost();
    }
  };

  const handleOpponentLeft = () => {
    // Remove own chess game post from feed immediately (frontend only)
    if (!isSpectator) {
      removeOwnChessPost();
    }
    
    if (isSpectator) {
      // For spectators, just navigate back
      showToast('Game Ended', 'A player left the game', 'info');
      setTimeout(() => navigation.goBack(), 1000);
      return;
    }
    Alert.alert(
      'Opponent Left',
      'Your opponent has left the game. You win by forfeit!',
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  };

  const handleOpponentResigned = () => {
    // Remove own chess game post from feed immediately (frontend only)
    if (!isSpectator) {
      removeOwnChessPost();
    }
    
    if (isSpectator) {
      // For spectators, just navigate back
      showToast('Game Ended', 'A player resigned', 'info');
      setTimeout(() => navigation.goBack(), 1000);
      return;
    }
    Alert.alert(
      'Opponent Resigned',
      'Your opponent has resigned. You win!',
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  };

  const handleLocalGameOver = () => {
    let message = '';
    
    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White';
      message = `Checkmate! ${winner} wins!`;
    } else if (chess.isDraw()) {
      message = 'Draw!';
    } else if (chess.isStalemate()) {
      message = 'Stalemate!';
    } else if (chess.isThreefoldRepetition()) {
      message = 'Draw by threefold repetition!';
    } else if (chess.isInsufficientMaterial()) {
      message = 'Draw by insufficient material!';
    }
    
    setGameOver(true);
    setGameResult(message);
    
    // Remove own chess game post from feed immediately (frontend only)
    if (!isSpectator) {
      removeOwnChessPost();
    }
    
    // Only emit chessGameEnd if user is a player (not a spectator)
    // Spectators should never emit game end events
    if (socket && roomId && !isSpectator) {
      // Extract player IDs from roomId (format: chess_player1Id_player2Id_timestamp)
      let player1Id = null;
      let player2Id = null;
      if (roomId && roomId.startsWith('chess_')) {
        const roomIdParts = roomId.split('_');
        if (roomIdParts.length >= 3) {
          player1Id = roomIdParts[1]; // Challenger (WHITE)
          player2Id = roomIdParts[2]; // Accepter (BLACK)
        }
      }
      
      socket.emit('chessGameEnd', {
        roomId,
        player1: player1Id,
        player2: player2Id,
        reason: chess.isCheckmate() ? 'checkmate' : 'draw',
      });
    } else if (isSpectator) {
      console.log('👁️ [ChessGameScreen] Spectator detected game over locally, but not emitting (spectators cannot end games)');
    }
  };

  const handleSquarePress = useCallback((square: string) => {
    // Spectators cannot make moves
    if (isSpectator) {
      return;
    }
    
    const currentTurn = chess.turn();
    const playerColor = orientation[0];
    
    if (currentTurn !== playerColor || gameOver) {
      return;
    }

    if (!selectedSquare) {
      const piece = chess.get(square);
      if (piece && piece.color === playerColor) {
        setSelectedSquare(square);
        const moves = chess.moves({ square, verbose: true });
        setLegalMoves(moves.map(m => m.to));
      }
    } else {
      if (square === selectedSquare) {
        setSelectedSquare(null);
        setLegalMoves([]);
      } else {
        try {
          const piece = chess.get(selectedSquare);
          const isPawn = piece?.type === 'p';
          const toRank = square[1];
          const isPromotion = isPawn && (toRank === '8' || toRank === '1');
          
          const moveObj: any = {
            from: selectedSquare,
            to: square,
          };
          
          if (isPromotion) {
            moveObj.promotion = 'q';
          }
          
          const move = chess.move(moveObj);
          
          if (move) {
            const beforeFen = move.before;
            const newFen = chess.fen();
            setFen(newFen);
            setSelectedSquare(null);
            setLegalMoves([]);
            
            // Play appropriate sound
            if (chess.inCheck()) {
              playSound('check');
            } else if (move.captured) {
              playSound('capture');
            } else {
              playSound('move');
            }
            
            if (move.captured) {
              if (move.color === 'w') {
                setCapturedBlack(prev => [...prev, move.captured]);
              } else {
                setCapturedWhite(prev => [...prev, move.captured]);
              }
            }
            
            if (socket && roomId && opponentId) {
              const moveData = {
                roomId,
                move: {
                  from: move.from,
                  to: move.to,
                  promotion: move.promotion,
                  before: beforeFen,
                  after: newFen,
                  captured: move.captured,
                  color: move.color,
                },
                to: opponentId,
                fen: newFen,
                capturedWhite: capturedWhite,
                capturedBlack: capturedBlack,
              };
              socket.emit('chessMove', moveData);
            }
            
            if (chess.isGameOver()) {
              handleLocalGameOver();
            }
          } else {
            const piece = chess.get(square);
            if (piece && piece.color === playerColor) {
              setSelectedSquare(square);
              const moves = chess.moves({ square, verbose: true });
              setLegalMoves(moves.map(m => m.to));
            } else {
              setSelectedSquare(null);
              setLegalMoves([]);
            }
          }
        } catch (error) {
          console.error('Move error:', error);
          setSelectedSquare(null);
          setLegalMoves([]);
        }
      }
    }
  }, [chess, orientation, gameOver, selectedSquare, socket, roomId, opponentId, capturedWhite, capturedBlack, playSound]);

  const handleBack = () => {
    // Only emit resign if user is a player (not a spectator)
    // Spectators should just leave silently without ending the game
    if (!isSpectator && socket && roomId && opponentId) {
      socket.emit('resignChess', { roomId, to: opponentId });
      // Remove own chess game post immediately (frontend only)
      // Backend will also delete and broadcast to followers
      removeOwnChessPost();
    } else if (isSpectator) {
      console.log('👁️ [ChessGameScreen] Spectator leaving - not emitting any game end events');
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
              socket.emit('resignChess', { roomId, to: opponentId });
            }
            // Remove own chess game post from feed immediately (frontend only)
            removeOwnChessPost();
            navigation.goBack();
          },
        },
      ]
    );
  };

  const renderCapturedPieces = (pieces: string[], pieceColor: 'white' | 'black', label: string) => {
    const pieceSymbols: { [key: string]: string } = {
      p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
    };
    
    // Always render container with fixed height to prevent board jumping
    return (
      <View style={styles.capturedContainer}>
        {pieces.length > 0 && (
          <>
            <Text style={styles.capturedTitle}>{label}</Text>
            <View style={styles.capturedPieces}>
              {pieces.map((piece, index) => {
                const isWhitePiece = pieceColor === 'white';
                return (
                  <View
                    key={index}
                    style={[
                      styles.capturedPieceContainer,
                      isWhitePiece ? styles.capturedPieceWhiteBg : styles.capturedPieceBlackBg,
                    ]}
                  >
                    <Text
                      style={[
                        styles.capturedPiece,
                        isWhitePiece ? styles.capturedPieceWhite : styles.capturedPieceBlack,
                      ]}
                    >
                      {pieceSymbols[piece.toLowerCase()] || piece}
                    </Text>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </View>
    );
  };

  if (!gameLive) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Waiting for game to start...</Text>
      </View>
    );
  }

  const isPlayerTurn = chess.turn() === orientation[0];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isSpectator ? 'Watching Chess Game' : 'Chess Game'}
        </Text>
        {!isSpectator && (
          <TouchableOpacity onPress={handleResign} style={styles.resignButton}>
            <Text style={styles.resignText}>Resign</Text>
          </TouchableOpacity>
        )}
        {isSpectator && <View style={styles.resignButton} />}
      </View>

      <View style={styles.playerInfo}>
        <Text style={styles.playerName}>
          {isSpectator 
            ? (orientation === 'white' ? player2?.name || 'Black' : player1?.name || 'White')
            : (opponent?.name || 'Opponent')
          } ({orientation === 'white' ? 'Black' : 'White'})
        </Text>
        <View style={styles.turnIndicatorContainer}>
          {!isPlayerTurn && !gameOver && (
            <Text style={styles.turnIndicator}>Thinking...</Text>
          )}
        </View>
      </View>

      {renderCapturedPieces(
        orientation === 'white' ? capturedWhite : capturedBlack,
        orientation === 'white' ? 'white' : 'black',
        isSpectator
          ? (orientation === 'white' ? `${player2?.name || 'Black'} captured` : `${player1?.name || 'White'} captured`)
          : (opponent?.name ? `${opponent.name} captured` : 'Opponent captured')
      )}

      <View style={styles.boardWrapper}>
        <View style={styles.boardContainer}>
          <ChessBoard
            fen={fen}
            orientation={orientation}
            onSquarePress={handleSquarePress}
            selectedSquare={selectedSquare}
            legalMoves={legalMoves}
          />
        </View>
      </View>

      {renderCapturedPieces(
        orientation === 'white' ? capturedBlack : capturedWhite,
        orientation === 'white' ? 'black' : 'white',
        isSpectator
          ? (orientation === 'white' ? `${player1?.name || 'White'} captured` : `${player2?.name || 'Black'} captured`)
          : 'You captured'
      )}

      <View style={styles.playerInfo}>
        <Text style={styles.playerName}>
          {isSpectator
            ? (orientation === 'white' ? player1?.name || 'White' : player2?.name || 'Black')
            : (user?.name || 'You')
          } ({orientation === 'white' ? 'White' : 'Black'})
        </Text>
        <View style={styles.turnIndicatorContainer}>
          {isPlayerTurn && !gameOver && (
            <Text style={[styles.turnIndicator, styles.yourTurn]}>Your Turn</Text>
          )}
        </View>
      </View>

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
  },
  resignButton: {
    padding: 5,
  },
  resignText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: 'bold',
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
  turnIndicatorContainer: {
    minHeight: 22,
    marginTop: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  turnIndicator: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  yourTurn: {
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  capturedContainer: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    height: 50, // Fixed height to prevent board jumping
  },
  capturedTitle: {
    fontSize: 12,
    color: COLORS.textGray,
    marginBottom: 4,
  },
  capturedPieces: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  capturedPieceContainer: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 4,
    marginBottom: 2,
  },
  capturedPiece: {
    fontSize: 20,
  },
  capturedPieceWhite: {
    color: '#FFFFFF',
  },
  capturedPieceBlack: {
    color: '#1a1a1a',
  },
  capturedPieceWhiteBg: {
    backgroundColor: '#1a1a1a',
  },
  capturedPieceBlackBg: {
    backgroundColor: '#E8E8E8',
  },
  boardWrapper: {
    width: '100%',
    aspectRatio: 1,
    maxWidth: width,
    alignSelf: 'center',
  },
  boardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
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
  otherGamesContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  otherGamesTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  otherGamesScroll: {
    flexGrow: 0,
  },
  otherGamesContent: {
    paddingRight: 16,
  },
  otherGameCard: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
    width: 180,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  otherGamePlayers: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  otherGamePlayer: {
    alignItems: 'center',
    flex: 1,
  },
  otherGameAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginBottom: 4,
  },
  otherGameAvatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  otherGameAvatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  otherGamePlayerName: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  otherGameVs: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.textGray,
    marginHorizontal: 8,
  },
  otherGameLiveBadge: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'center',
  },
  otherGameLiveText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
});

export default ChessGameScreen;
