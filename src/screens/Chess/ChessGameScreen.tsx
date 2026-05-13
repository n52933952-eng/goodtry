import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Chess } from 'chess.js';
import Sound from 'react-native-sound';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { usePost } from '../../context/PostContext';
import { useLanguage } from '../../context/LanguageContext';
import { API_URL, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import ChessBoard, { ChessMoveAnimation } from '../../components/ChessBoard';
import {
  CHESS_BOARD_THEMES,
  DEFAULT_CHESS_BOARD_THEME_ID,
  BOARD_THEME_STORAGE_KEY,
  getBoardThemeById,
} from '../../utils/chessThemes';

const { width, height: SCREEN_HEIGHT } = Dimensions.get('window');

/** Delay before showing the Game Over overlay (review / lobby) so the final position is visible. */
const GAME_OVER_OVERLAY_DELAY_MS = 4000;

/** Metro-bundled MP3 ids — `res/raw` on Android is still preferred; these back dev / missing raw. */
const CHESS_ASSET_P = require('../../assets/sounds/p.mp3');
const CHESS_ASSET_K = require('../../assets/sounds/k.mp3');
const CHESS_ASSET_KING = require('../../assets/sounds/king.mp3');
const CHESS_ASSET_C = require('../../assets/sounds/c.mp3');
const CHESS_ASSET_START = require('../../assets/sounds/start.mp3');

/**
 * `react-native-sound` expects a string path/URI. Passing `require()` directly hits `filename.startsWith` with a non-string.
 * After a failed `MAIN_BUNDLE` load, resolve a playable URI (works in dev with Metro and in release).
 */
function loadChessSoundFromBundledAsset(
  asset: number,
  label: string,
  assign: (s: Sound) => void,
): void {
  try {
    const resolved = Image.resolveAssetSource(asset);
    if (!resolved?.uri) {
      console.error(`❌ [ChessGameScreen] Could not resolve ${label} asset URI`);
      return;
    }
    assign(
      new Sound(resolved.uri, (error) => {
        if (error) {
          console.error(`❌ [ChessGameScreen] Failed to load ${label} (bundle URI):`, error);
        }
      }),
    );
  } catch (e) {
    console.error(`❌ [ChessGameScreen] Could not load ${label}:`, e);
  }
}

/** Piece char for board glyphs (P/N/B/R/Q/K) — uses promotion when present. */
function getPieceCharForAnimation(
  beforeFen: string,
  from: string,
  promotion: string | undefined,
  color: 'w' | 'b',
): string {
  if (promotion) {
    const t = promotion.toLowerCase();
    return color === 'w' ? t.toUpperCase() : t;
  }
  try {
    const c = new Chess(beforeFen);
    const p = c.get(from as any);
    if (!p) return 'p';
    return p.color === 'w' ? (p.type as string).toUpperCase() : p.type;
  } catch {
    return 'p';
  }
}

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
  const { isRTL } = useLanguage();

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
  /** Shown after {@link GAME_OVER_OVERLAY_DELAY_MS} when the game ends (not used for immediate resign). */
  const [gameOverOverlayVisible, setGameOverOverlayVisible] = useState(false);
  const gameOverOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gameResult, setGameResult] = useState('');

  const clearGameOverOverlayDelay = () => {
    if (gameOverOverlayTimeoutRef.current != null) {
      clearTimeout(gameOverOverlayTimeoutRef.current);
      gameOverOverlayTimeoutRef.current = null;
    }
  };

  /** After checkmate/draw/etc., keep the board clear briefly before showing Review / Lobby. */
  const scheduleGameOverOverlayDelay = () => {
    clearGameOverOverlayDelay();
    setGameOverOverlayVisible(false);
    gameOverOverlayTimeoutRef.current = setTimeout(() => {
      gameOverOverlayTimeoutRef.current = null;
      setGameOverOverlayVisible(true);
    }, GAME_OVER_OVERLAY_DELAY_MS);
  };
  const [capturedWhite, setCapturedWhite] = useState<string[]>([]);
  const [capturedBlack, setCapturedBlack] = useState<string[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  const [moveAnimation, setMoveAnimation] = useState<ChessMoveAnimation | null>(null);
  const moveAnimKeyRef = useRef(0);
  /** Played moves (from / to / promotion) — used so both players can step through the finished game. */
  const [moveHistory, setMoveHistory] = useState<Array<{ from: string; to: string; promotion?: string }>>([]);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewFen, setReviewFen] = useState<string>(chess.fen());
  const [reviewCapturedWhite, setReviewCapturedWhite] = useState<string[]>([]);
  const [reviewCapturedBlack, setReviewCapturedBlack] = useState<string[]>([]);
  /** User-selectable board palette (light/dark square colors), persisted in AsyncStorage. */
  const [boardThemeId, setBoardThemeId] = useState<string>(DEFAULT_CHESS_BOARD_THEME_ID);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const boardTheme = getBoardThemeById(boardThemeId);
  /** If the user picks a theme before the async hydrate finishes, do not let hydrate overwrite their choice. */
  const userPickedBoardThemeRef = useRef(false);

  // Load saved board theme on mount (async — can finish after first paint).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(BOARD_THEME_STORAGE_KEY);
        if (cancelled || userPickedBoardThemeRef.current) return;
        if (saved && CHESS_BOARD_THEMES.some((t) => t.id === saved)) {
          setBoardThemeId(saved);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectBoardTheme = useCallback(async (id: string) => {
    userPickedBoardThemeRef.current = true;
    setBoardThemeId(id);
    setThemePickerOpen(false);
    try {
      await AsyncStorage.setItem(BOARD_THEME_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);
  // Track current roomId to prevent processing events from old rooms
  const currentRoomIdRef = useRef<string | null>(null);
  // Track previous roomId to detect game switches
  const previousRoomIdRef = useRef<string | null>(null);
  
  // Sound effects
  const sounds = useRef<{
    move?: Sound;
    capture?: Sound;
    /** King in check (not mate) — `king.mp3` */
    inCheck?: Sound;
    /** Checkmate — `c.mp3` (unchanged) */
    checkmate?: Sound;
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
        loadChessSoundFromBundledAsset(CHESS_ASSET_P, 'move sound', (s) => {
          sounds.current.move = s;
        });
      }
    });
    
    sounds.current.capture = new Sound('k.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [ChessGameScreen] Failed to load capture sound:', error);
        loadChessSoundFromBundledAsset(CHESS_ASSET_K, 'capture sound', (s) => {
          sounds.current.capture = s;
        });
      }
    });
    
    sounds.current.inCheck = new Sound('king.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [ChessGameScreen] Failed to load in-check sound:', error);
        loadChessSoundFromBundledAsset(CHESS_ASSET_KING, 'in-check sound', (s) => {
          sounds.current.inCheck = s;
        });
      }
    });

    sounds.current.checkmate = new Sound('c.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [ChessGameScreen] Failed to load checkmate sound:', error);
        loadChessSoundFromBundledAsset(CHESS_ASSET_C, 'checkmate sound', (s) => {
          sounds.current.checkmate = s;
        });
      }
    });
    
    sounds.current.gameStart = new Sound('start.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [ChessGameScreen] Failed to load game start sound:', error);
        loadChessSoundFromBundledAsset(CHESS_ASSET_START, 'game start sound', (s) => {
          sounds.current.gameStart = s;
        });
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

  const triggerMoveAnimation = useCallback((from: string, to: string, piece: string) => {
    moveAnimKeyRef.current += 1;
    setMoveAnimation({ key: moveAnimKeyRef.current, from, to, piece });
  }, []);

  // Replay moves up to `reviewIndex` so the board shows that position with correct captured pieces.
  useEffect(() => {
    if (!reviewMode) return;
    const replay = new Chess();
    const cw: string[] = [];
    const cb: string[] = [];
    for (let i = 0; i < reviewIndex && i < moveHistory.length; i++) {
      try {
        const m = replay.move(moveHistory[i] as any);
        if (m && m.captured) {
          if (m.color === 'w') cb.push(m.captured);
          else cw.push(m.captured);
        }
      } catch (e) {
        // If the recorded move is somehow illegal in replay, stop here so we still show a valid FEN.
        break;
      }
    }
    setReviewFen(replay.fen());
    setReviewCapturedWhite(cw);
    setReviewCapturedBlack(cb);
  }, [reviewMode, reviewIndex, moveHistory]);

  const enterReview = useCallback(() => {
    setMoveAnimation(null);
    setSelectedSquare(null);
    setLegalMoves([]);
    setReviewIndex(moveHistory.length);
    setReviewMode(true);
  }, [moveHistory.length]);

  const exitReview = useCallback(() => {
    setMoveAnimation(null);
    setReviewMode(false);
  }, []);

  /**
   * Step forward animates the piece sliding from its origin to its destination
   * (same animation the live board uses). Backward / jumps just teleport.
   */
  const reviewStep = useCallback((delta: number) => {
    const next = Math.max(0, Math.min(reviewIndex + delta, moveHistory.length));
    if (next === reviewIndex) return;

    if (delta === 1 && next > 0) {
      const move = moveHistory[next - 1];
      try {
        const replay = new Chess();
        for (let k = 0; k < reviewIndex; k++) {
          replay.move(moveHistory[k] as any);
        }
        const piece = replay.get(move.from as any);
        if (piece && move.from && move.to) {
          const pieceChar = move.promotion
            ? (piece.color === 'w'
                ? move.promotion.toUpperCase()
                : move.promotion.toLowerCase())
            : (piece.color === 'w'
                ? piece.type.toUpperCase()
                : piece.type.toLowerCase());
          triggerMoveAnimation(move.from, move.to, pieceChar);
        }
      } catch (e) {
        // If the recorded move can't be replayed for some reason, skip the animation.
        setMoveAnimation(null);
      }
    } else {
      // Stepping back or any other transition — no slide animation.
      setMoveAnimation(null);
    }

    setReviewIndex(next);
  }, [reviewIndex, moveHistory, triggerMoveAnimation]);

  const reviewJumpToStart = useCallback(() => {
    setMoveAnimation(null);
    setReviewIndex(0);
  }, []);

  const reviewJumpToEnd = useCallback(() => {
    setMoveAnimation(null);
    setReviewIndex(moveHistory.length);
  }, [moveHistory.length]);

  const playSound = useCallback((type: 'move' | 'capture' | 'inCheck' | 'checkmate' | 'gameStart') => {
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
    if (gameOverOverlayTimeoutRef.current != null) {
      clearTimeout(gameOverOverlayTimeoutRef.current);
      gameOverOverlayTimeoutRef.current = null;
    }
    setGameOverOverlayVisible(false);
    chess.reset();
    setFen(chess.fen());
    setCapturedWhite([]);
    setCapturedBlack([]);
    setGameOver(false);
    setGameResult('');
    setSelectedSquare(null);
    setLegalMoves([]);
    setMoveAnimation(null);
    setGameLive(false); // Will be set to true when game state is received
    // Clear player states when switching games
    setPlayer1(null);
    setPlayer2(null);
    setOpponent(null);
    // Reset review state for a fresh game
    setMoveHistory([]);
    setReviewMode(false);
    setReviewIndex(0);
    setReviewCapturedWhite([]);
    setReviewCapturedBlack([]);

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
        const reasonText = data.reason === 'resigned' ? 'A player resigned'
          : data.reason === 'player_disconnected' ? 'A player disconnected'
          : data.reason === 'checkmate' ? 'Checkmate!'
          : data.reason === 'draw' ? 'Draw!'
          : 'Game ended';
        setGameOver(true);
        setGameResult(reasonText);
        scheduleGameOverOverlayDelay();
        // Keep `gameLive=true` so the board + Game Over overlay stay rendered.
        // (Setting it false hides the whole screen behind the "Waiting for game to start…" spinner.)
        showToast('Game Ended', reasonText, 'info');
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
      scheduleGameOverOverlayDelay();
      // Do NOT set gameLive=false — that hides the board behind the "Waiting for game…" spinner.
      // The user needs to see the final position and the "Review game" / "Back to Lobby" buttons.
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
      if (gameOverOverlayTimeoutRef.current != null) {
        clearTimeout(gameOverOverlayTimeoutRef.current);
        gameOverOverlayTimeoutRef.current = null;
      }
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
          const beforeFen = data.move.before || chess.fen();
          const moveColor = (data.move.color as 'w' | 'b') || 'w';
          const pieceChar = getPieceCharForAnimation(
            beforeFen,
            data.move.from,
            data.move.promotion,
            moveColor,
          );
          triggerMoveAnimation(data.move.from, data.move.to, pieceChar);
          chess.load(data.move.after);
          setFen(data.move.after);
          
          // Checkmate uses c.mp3; normal check uses king.mp3
          if (chess.isCheckmate()) {
            playSound('checkmate');
          } else if (chess.inCheck()) {
            playSound('inCheck');
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

          // Record opponent move for game review (after-FEN path).
          if (data.move.from && data.move.to) {
            setMoveHistory(prev => [
              ...prev,
              { from: data.move.from, to: data.move.to, promotion: data.move.promotion },
            ]);
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
          const fenBeforeMove = chess.fen();
          const moveObj: any = {
            from: data.move.from,
            to: data.move.to,
          };
          
          if (data.move.promotion) {
            moveObj.promotion = data.move.promotion;
          }
          
          const moveResult = chess.move(moveObj);
          
          if (moveResult) {
            const pieceChar = getPieceCharForAnimation(
              fenBeforeMove,
              moveResult.from,
              moveResult.promotion,
              moveResult.color,
            );
            triggerMoveAnimation(moveResult.from, moveResult.to, pieceChar);
            const newFen = chess.fen();
            setFen(newFen);
            
            // Checkmate uses c.mp3; normal check uses king.mp3
            if (chess.isCheckmate()) {
              playSound('checkmate');
            } else if (chess.inCheck()) {
              playSound('inCheck');
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

            // Record opponent move for game review (chess.move path).
            setMoveHistory(prev => [
              ...prev,
              { from: moveResult.from, to: moveResult.to, promotion: moveResult.promotion },
            ]);
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
  }, [chess, playSound, triggerMoveAnimation]);

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
    scheduleGameOverOverlayDelay();
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
      // For spectators, just navigate back (nothing to review for them)
      showToast('Game Ended', 'A player left the game', 'info');
      setTimeout(() => navigation.goBack(), 1000);
      return;
    }

    // Player: keep them on the board so they can press "Review game" or "Back".
    setGameOver(true);
    setGameResult('Your opponent left the game. You win by forfeit!');
    scheduleGameOverOverlayDelay();
    showToast('Opponent Left', 'You win by forfeit', 'info');
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

    // Player: keep them on the board so they can review.
    setGameOver(true);
    setGameResult('Your opponent resigned. You win!');
    scheduleGameOverOverlayDelay();
    showToast('Opponent Resigned', 'You win!', 'info');
  };

  const handleLocalGameOver = () => {
    // Order matters: chess.js `isDraw()` returns true for stalemate / threefold / insufficient too,
    // so check the specific reasons FIRST and fall through to generic draw last.
    let message = '';

    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White';
      message = `Checkmate — ${winner} wins!`;
    } else if (chess.isStalemate()) {
      message = 'Stalemate — Draw (no legal moves, not in check)';
    } else if (chess.isThreefoldRepetition()) {
      message = 'Draw by threefold repetition';
    } else if (chess.isInsufficientMaterial()) {
      message = 'Draw by insufficient material';
    } else if (chess.isDraw()) {
      message = 'Draw (50-move rule)';
    } else {
      message = 'Game over';
    }

    setGameOver(true);
    setGameResult(message);
    scheduleGameOverOverlayDelay();
    
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
    // Review mode is read-only: arrows step through history, board is not interactive.
    if (reviewMode) {
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
            const pieceChar = getPieceCharForAnimation(
              beforeFen,
              move.from,
              move.promotion,
              move.color,
            );
            triggerMoveAnimation(move.from, move.to, pieceChar);
            setFen(newFen);
            setSelectedSquare(null);
            setLegalMoves([]);
            
            // Checkmate uses c.mp3; normal check uses king.mp3
            if (chess.isCheckmate()) {
              playSound('checkmate');
            } else if (chess.inCheck()) {
              playSound('inCheck');
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

            // Record for game review (step-by-step replay after game ends).
            setMoveHistory(prev => [
              ...prev,
              { from: move.from, to: move.to, promotion: move.promotion },
            ]);

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
  }, [chess, orientation, gameOver, selectedSquare, socket, roomId, opponentId, capturedWhite, capturedBlack, playSound, triggerMoveAnimation]);

  const handleBack = () => {
    // Only emit resign if user is a player (not a spectator)
    // Spectators should just leave silently without ending the game
    // Only emit resign if the game is still active. After game over, the back arrow just leaves.
    if (!isSpectator && !gameOver && socket && roomId && opponentId) {
      socket.emit('resignChess', { roomId, to: opponentId });
      removeOwnChessPost();
    } else if (isSpectator) {
      console.log('👁️ [ChessGameScreen] Spectator leaving - not emitting any game end events');
    }
    navigation.goBack();
  };

  const handleResign = () => {
    if (gameOver) return; // Already over — nothing to resign.
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
            removeOwnChessPost();
            // Stay on the board with the Game Over overlay so the player can review the game.
            setGameOver(true);
            setGameResult('You resigned.');
            clearGameOverOverlayDelay();
            setGameOverOverlayVisible(true);
            setSelectedSquare(null);
            setLegalMoves([]);
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
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setThemePickerOpen(true)}
            style={styles.themeButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.themeButtonIcon}>🎨</Text>
          </TouchableOpacity>
          {!isSpectator && !gameOver && (
            <TouchableOpacity onPress={handleResign} style={styles.resignButton}>
              <Text style={styles.resignText}>Resign</Text>
            </TouchableOpacity>
          )}
        </View>
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
        orientation === 'white'
          ? (reviewMode ? reviewCapturedWhite : capturedWhite)
          : (reviewMode ? reviewCapturedBlack : capturedBlack),
        orientation === 'white' ? 'white' : 'black',
        isSpectator
          ? (orientation === 'white' ? `${player2?.name || 'Black'} captured` : `${player1?.name || 'White'} captured`)
          : (opponent?.name ? `${opponent.name} captured` : 'Opponent captured')
      )}

      <View style={styles.boardWrapper}>
        <View style={styles.boardContainer}>
          <ChessBoard
            key={`board-theme-${boardThemeId}`}
            fen={reviewMode ? reviewFen : fen}
            orientation={orientation}
            onSquarePress={handleSquarePress}
            selectedSquare={reviewMode ? null : selectedSquare}
            legalMoves={reviewMode ? [] : legalMoves}
            moveAnimation={moveAnimation}
            lightColor={boardTheme.light}
            darkColor={boardTheme.dark}
          />
        </View>
      </View>

      {renderCapturedPieces(
        orientation === 'white'
          ? (reviewMode ? reviewCapturedBlack : capturedBlack)
          : (reviewMode ? reviewCapturedWhite : capturedWhite),
        orientation === 'white' ? 'black' : 'white',
        isSpectator
          ? (orientation === 'white' ? `${player1?.name || 'White'} captured` : `${player2?.name || 'Black'} captured`)
          : 'You captured'
      )}

      {reviewMode && (
        <View style={styles.reviewToolbar}>
          <TouchableOpacity
            style={[styles.reviewBtn, reviewIndex === 0 && styles.reviewBtnDisabled]}
            onPress={reviewJumpToStart}
            disabled={reviewIndex === 0}
          >
            <Text style={styles.reviewBtnText}>|◀</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reviewBtn, reviewIndex === 0 && styles.reviewBtnDisabled]}
            onPress={() => reviewStep(-1)}
            disabled={reviewIndex === 0}
          >
            <Text style={styles.reviewBtnText}>◀</Text>
          </TouchableOpacity>
          <View style={styles.reviewCounterWrap}>
            <Text style={styles.reviewCounter}>{reviewIndex} / {moveHistory.length}</Text>
          </View>
          <TouchableOpacity
            style={[styles.reviewBtn, reviewIndex >= moveHistory.length && styles.reviewBtnDisabled]}
            onPress={() => reviewStep(1)}
            disabled={reviewIndex >= moveHistory.length}
          >
            <Text style={styles.reviewBtnText}>▶</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reviewBtn, reviewIndex >= moveHistory.length && styles.reviewBtnDisabled]}
            onPress={reviewJumpToEnd}
            disabled={reviewIndex >= moveHistory.length}
          >
            <Text style={styles.reviewBtnText}>▶|</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reviewBtn, styles.reviewExitBtn]}
            onPress={exitReview}
          >
            <Text style={styles.reviewExitText}>Exit</Text>
          </TouchableOpacity>
        </View>
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

      <Modal
        visible={themePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setThemePickerOpen(false)}
      >
        <Pressable
          style={styles.themeModalBackdrop}
          onPress={() => setThemePickerOpen(false)}
        >
          <Pressable
            style={styles.themeModalCard}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.themeModalHeader}>
              <Text style={styles.themeModalTitle}>
                {isRTL ? 'مظهر الرقعة' : 'Board theme'}
              </Text>
              <TouchableOpacity
                onPress={() => setThemePickerOpen(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.themeModalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.themeModalScroll}
              contentContainerStyle={styles.themeGrid}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {CHESS_BOARD_THEMES.map((t) => {
                const selected = t.id === boardThemeId;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[
                      styles.themeCard,
                      selected && styles.themeCardSelected,
                    ]}
                    onPress={() => selectBoardTheme(t.id)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.themePreview}>
                      {[0, 1, 2, 3].map((r) => (
                        <View key={r} style={styles.themePreviewRow}>
                          {[0, 1, 2, 3].map((c) => (
                            <View
                              key={c}
                              style={{
                                width: 18,
                                height: 18,
                                backgroundColor: (r + c) % 2 === 0 ? t.light : t.dark,
                              }}
                            />
                          ))}
                        </View>
                      ))}
                    </View>
                    <Text style={styles.themeName} numberOfLines={1}>
                      {isRTL ? t.nameAr : t.nameEn}
                    </Text>
                    {selected && (
                      <View style={styles.themeSelectedBadge}>
                        <Text style={styles.themeSelectedBadgeText}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {gameOver && gameOverOverlayVisible && !reviewMode && (
        <View style={styles.gameOverOverlay}>
          <View style={styles.gameOverBox}>
            <Text style={styles.gameOverTitle}>Game Over</Text>
            <Text style={styles.gameOverMessage}>{gameResult}</Text>
            <View style={styles.gameOverActions}>
              {moveHistory.length > 0 && (
                <TouchableOpacity
                  style={[styles.gameOverButton, styles.gameOverReviewBtn]}
                  onPress={enterReview}
                >
                  <Text style={styles.gameOverButtonText}>Review game</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.gameOverButton, styles.gameOverBackBtn]}
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.gameOverButtonText}>Back to Lobby</Text>
              </TouchableOpacity>
            </View>
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  themeButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 4,
  },
  themeButtonIcon: {
    fontSize: 20,
  },
  themeModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  themeModalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: Math.min(SCREEN_HEIGHT * 0.88, 640),
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 14,
    flexDirection: 'column',
    overflow: 'hidden',
  },
  themeModalScroll: {
    flexGrow: 1,
    flexShrink: 1,
    maxHeight: Math.min(SCREEN_HEIGHT * 0.72, 520),
  },
  themeModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  themeModalTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
  },
  themeModalClose: {
    color: COLORS.textGray,
    fontSize: 22,
    paddingHorizontal: 4,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingBottom: 36,
    paddingTop: 4,
  },
  themeCard: {
    width: '48%',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 12,
    alignItems: 'center',
    position: 'relative',
  },
  themeCardSelected: {
    borderColor: COLORS.primary,
    borderWidth: 2,
  },
  themePreview: {
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 8,
  },
  themePreviewRow: {
    flexDirection: 'row',
  },
  themeName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  themeSelectedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeSelectedBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
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
  gameOverActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  gameOverButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginHorizontal: 4,
    marginVertical: 4,
  },
  gameOverReviewBtn: {
    backgroundColor: COLORS.primary,
  },
  gameOverBackBtn: {
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  gameOverButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  reviewToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: COLORS.backgroundLight,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  reviewBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
  },
  reviewBtnDisabled: {
    opacity: 0.4,
  },
  reviewBtnText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  reviewCounterWrap: {
    paddingHorizontal: 10,
    minWidth: 64,
    alignItems: 'center',
  },
  reviewCounter: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  reviewExitBtn: {
    marginLeft: 10,
    backgroundColor: COLORS.error,
    borderColor: COLORS.error,
  },
  reviewExitText: {
    color: '#FFFFFF',
    fontSize: 14,
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
