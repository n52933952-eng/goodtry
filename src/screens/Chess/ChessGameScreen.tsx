import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { API_URL, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import ChessBoard from '../../components/ChessBoard';

const { width } = Dimensions.get('window');

interface ChessGameScreenProps {
  navigation: any;
  route: any;
}

const ChessGameScreen: React.FC<ChessGameScreenProps> = ({ navigation, route }) => {
  const { roomId, opponentId, color } = route.params;
  const { user } = useUser();
  const { socket } = useSocket();
  const showToast = useShowToast();

  console.log('♟️ [ChessGameScreen] Initializing with:', { roomId, opponentId, color });

  const chess = useMemo(() => new Chess(), []);
  const [fen, setFen] = useState(chess.fen());
  const [orientation, setOrientation] = useState<'white' | 'black'>(color || 'white');
  const [opponent, setOpponent] = useState<any>(null);
  const [gameLive, setGameLive] = useState(true);
  const [gameOver, setGameOver] = useState(false);
  const [gameResult, setGameResult] = useState('');
  const [capturedWhite, setCapturedWhite] = useState<string[]>([]);
  const [capturedBlack, setCapturedBlack] = useState<string[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<string[]>([]);

  useEffect(() => {
    if (!socket || !roomId) {
      console.warn('⚠️ [ChessGameScreen] Socket or roomId not available');
      return;
    }

    console.log('♟️ [ChessGameScreen] Joining chess room:', roomId);
    socket.emit('joinChessRoom', { roomId, userId: user?._id });
    socket.emit('requestChessGameState', { roomId });

    socket.on('gameState', handleGameState);
    socket.on('chessGameState', handleGameState);
    socket.on('opponentMove', handleOpponentMove);
    socket.on('gameOver', handleGameOver);
    socket.on('opponentLeft', handleOpponentLeft);
    socket.on('opponentResigned', handleOpponentResigned);
    
    socket.on('chessMove', (data: any) => {
      console.log('♟️ [ChessGameScreen] Received chessMove event:', data);
      if (data.roomId === roomId) {
        handleOpponentMove(data);
      }
    });

    return () => {
      console.log('♟️ [ChessGameScreen] Leaving chess room');
      socket.off('gameState', handleGameState);
      socket.off('chessGameState', handleGameState);
      socket.off('opponentMove', handleOpponentMove);
      socket.off('gameOver', handleGameOver);
      socket.off('opponentLeft', handleOpponentLeft);
      socket.off('opponentResigned', handleOpponentResigned);
      socket.off('chessMove');
    };
  }, [socket, roomId]);

  useEffect(() => {
    fetchOpponent();
  }, [opponentId]);

  const fetchOpponent = async () => {
    if (!opponentId) return;

    try {
      const baseUrl = API_URL;
      const response = await fetch(`${baseUrl}/api/user/getUserPro/${opponentId}`, {
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        setOpponent(data);
      }
    } catch (error) {
      console.error('❌ [ChessGameScreen] Error fetching opponent:', error);
    }
  };

  const handleGameState = (data: any) => {
    console.log('📥 [ChessGameScreen] Game state received:', data);
    
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
    
    setGameLive(true);
  };

  const handleOpponentMove = (data: any) => {
    console.log('📥 ========== RECEIVED MOVE ==========');
    
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
          chess.load(data.move.after);
          setFen(data.move.after);
          
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
  };

  const handleGameOver = (data: any) => {
    setGameOver(true);
    setGameResult(data.message || 'Game Over');
    showToast('Game Over', data.message, 'info');
  };

  const handleOpponentLeft = () => {
    Alert.alert(
      'Opponent Left',
      'Your opponent has left the game. You win by forfeit!',
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  };

  const handleOpponentResigned = () => {
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
    
    if (socket && roomId) {
      socket.emit('chessGameEnd', {
        roomId,
        reason: chess.isCheckmate() ? 'checkmate' : 'draw',
      });
    }
  };

  const handleSquarePress = useCallback((square: string) => {
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
  }, [chess, orientation, gameOver, selectedSquare, socket, roomId, opponentId, capturedWhite, capturedBlack]);

  const handleBack = () => {
    // Resign the game for both users when going back
    if (socket && roomId && opponentId) {
      socket.emit('resignChess', { roomId, to: opponentId });
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
        <Text style={styles.headerTitle}>Chess Game</Text>
        <TouchableOpacity onPress={handleResign} style={styles.resignButton}>
          <Text style={styles.resignText}>Resign</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.playerInfo}>
        <Text style={styles.playerName}>
          {opponent?.name || 'Opponent'} ({orientation === 'white' ? 'Black' : 'White'})
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
        opponent?.name ? `${opponent.name} captured` : 'Opponent captured'
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
        'You captured'
      )}

      <View style={styles.playerInfo}>
        <Text style={styles.playerName}>
          {user?.name} ({orientation === 'white' ? 'White' : 'Black'})
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
});

export default ChessGameScreen;
