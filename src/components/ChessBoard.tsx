import React, { memo, useMemo, useRef, useLayoutEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Animated, Easing } from 'react-native';
import { COLORS } from '../utils/constants';

const { width } = Dimensions.get('window');
const SQUARE_SIZE = (width - 32) / 8;
const BOARD_SIZE = SQUARE_SIZE * 8;
const MOVE_DURATION_MS = 320;

export interface ChessMoveAnimation {
  key: number;
  from: string;
  to: string;
  /** FEN piece char e.g. P, n, Q */
  piece: string;
}

interface ChessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  onSquarePress: (square: string) => void;
  selectedSquare: string | null;
  legalMoves: string[];
  /** When key changes, animates piece sliding from → to (both local and opponent moves). */
  moveAnimation?: ChessMoveAnimation | null;
}

const PIECE_SYMBOLS: { [key: string]: string } = {
  'P': '♟', 'N': '♞', 'B': '♝', 'R': '♜', 'Q': '♛', 'K': '♚',
  'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚',
};

const ChessBoard: React.FC<ChessBoardProps> = memo(({
  fen,
  orientation,
  onSquarePress,
  selectedSquare,
  legalMoves,
  moveAnimation,
}) => {
  const overlayPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  /** Prevents restarting the same moveAnimation.key when parent re-renders mid-flight. */
  const startedAnimKeyRef = useRef<number | null>(null);

  /** When this equals moveAnimation.key, the slide for that move is done (squares use FEN again). */
  const [completedMoveKey, setCompletedMoveKey] = useState<number | null>(null);

  const isSliding =
    moveAnimation != null &&
    completedMoveKey !== moveAnimation.key;

  const board = useMemo(() => {
    const parsedBoard: (string | null)[][] = [];
    const rows = fen.split(' ')[0].split('/');

    for (const row of rows) {
      const boardRow: (string | null)[] = [];
      for (const char of row) {
        if (isNaN(parseInt(char))) {
          boardRow.push(char);
        } else {
          for (let i = 0; i < parseInt(char); i++) {
            boardRow.push(null);
          }
        }
      }
      parsedBoard.push(boardRow);
    }

    return parsedBoard;
  }, [fen]);

  const getSquarePixelPosition = useCallback((square: string): { x: number; y: number } => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

    const file = files.indexOf(square[0]);
    const rank = ranks.indexOf(square[1]);

    if (orientation === 'white') {
      return {
        x: file * SQUARE_SIZE,
        y: rank * SQUARE_SIZE,
      };
    }
    return {
      x: (7 - file) * SQUARE_SIZE,
      y: (7 - rank) * SQUARE_SIZE,
    };
  }, [orientation]);

  useLayoutEffect(() => {
    if (!moveAnimation) {
      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }
      startedAnimKeyRef.current = null;
      return;
    }

    const { key, from, to, piece } = moveAnimation;
    if (!from || !to || !piece) return;

    if (startedAnimKeyRef.current === key) {
      return;
    }

    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }

    startedAnimKeyRef.current = key;

    const fromPos = getSquarePixelPosition(from);
    const toPos = getSquarePixelPosition(to);

    overlayPosition.setValue({ x: fromPos.x, y: fromPos.y });
    overlayOpacity.setValue(1);

    const moveAnimationRun = Animated.timing(overlayPosition, {
      toValue: { x: toPos.x, y: toPos.y },
      duration: MOVE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    animRef.current = moveAnimationRun;
    moveAnimationRun.start(({ finished }) => {
      animRef.current = null;
      if (finished) {
        setCompletedMoveKey(key);
      }
    });

    return () => {
      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }
      startedAnimKeyRef.current = null;
    };
  }, [
    moveAnimation?.key,
    moveAnimation?.from,
    moveAnimation?.to,
    moveAnimation?.piece,
    getSquarePixelPosition,
    overlayPosition,
    overlayOpacity,
  ]);

  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

  const getSquareColor = (row: number, col: number) => {
    return (row + col) % 2 === 0 ? '#F0D9B5' : '#B58863';
  };

  const getSquareName = (row: number, col: number) => {
    const file = orientation === 'white' ? files[col] : files[7 - col];
    const rank = orientation === 'white' ? ranks[row] : ranks[7 - row];
    return file + rank;
  };

  const renderSquare = (row: number, col: number) => {
    const actualRow = orientation === 'white' ? row : 7 - row;
    const actualCol = orientation === 'white' ? col : 7 - col;
    const piece = board[actualRow][actualCol];
    const squareName = getSquareName(row, col);
    const isSelected = squareName === selectedSquare;
    const isLegalMove = legalMoves.includes(squareName);
    const isWhitePiece = piece && piece === piece.toUpperCase();

    const hideForSlide =
      isSliding &&
      moveAnimation &&
      (squareName === moveAnimation.from || squareName === moveAnimation.to);

    return (
      <TouchableOpacity
        key={`${row}-${col}`}
        style={[
          styles.square,
          { backgroundColor: getSquareColor(row, col) },
          isSelected && styles.selectedSquare,
          isLegalMove && styles.legalMoveSquare,
        ]}
        onPress={() => onSquarePress(squareName)}
      >
        {piece && !hideForSlide && (
          <Text
            style={[
              styles.piece,
              isWhitePiece ? styles.whitePiece : styles.blackPiece,
            ]}
          >
            {PIECE_SYMBOLS[piece] || piece}
          </Text>
        )}
        {isLegalMove && !piece && <View style={styles.legalMoveDot} />}
      </TouchableOpacity>
    );
  };

  const slidingPiece = moveAnimation?.piece;
  const overlayIsWhite =
    slidingPiece && slidingPiece === slidingPiece.toUpperCase();

  return (
    <View style={styles.container}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <View key={row} style={styles.row}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((col) => renderSquare(row, col))}
        </View>
      ))}

      {isSliding && slidingPiece && (
        <Animated.View
          style={[
            styles.overlayPiece,
            {
              transform: [
                { translateX: overlayPosition.x },
                { translateY: overlayPosition.y },
              ],
              opacity: overlayOpacity,
            },
          ]}
          pointerEvents="none"
        >
          <Text
            style={[
              styles.piece,
              overlayIsWhite ? styles.whitePiece : styles.blackPiece,
            ]}
          >
            {PIECE_SYMBOLS[slidingPiece] || slidingPiece}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.fen === nextProps.fen &&
    prevProps.orientation === nextProps.orientation &&
    prevProps.selectedSquare === nextProps.selectedSquare &&
    prevProps.moveAnimation?.key === nextProps.moveAnimation?.key &&
    JSON.stringify(prevProps.legalMoves) === JSON.stringify(nextProps.legalMoves)
  );
});

const styles = StyleSheet.create({
  container: {
    width: BOARD_SIZE,
    height: BOARD_SIZE,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignSelf: 'center',
    overflow: 'visible',
  },
  row: {
    flexDirection: 'row',
    width: BOARD_SIZE,
    height: SQUARE_SIZE,
  },
  square: {
    width: SQUARE_SIZE,
    height: SQUARE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
  },
  selectedSquare: {
    backgroundColor: '#7FC97F !important',
    opacity: 0.8,
  },
  legalMoveSquare: {
    opacity: 0.9,
  },
  overlayPiece: {
    position: 'absolute',
    width: SQUARE_SIZE,
    height: SQUARE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    top: 0,
    left: 0,
    zIndex: 1000,
  },
  piece: {
    fontSize: SQUARE_SIZE * 0.85,
    fontWeight: '400',
    lineHeight: SQUARE_SIZE,
  },
  whitePiece: {
    color: '#F5F5F5',
    fontWeight: '500',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0.5, height: 0.5 },
    textShadowRadius: 2,
  },
  blackPiece: {
    color: '#1a1a1a',
    textShadowColor: 'rgba(255, 255, 255, 0.9)',
    textShadowOffset: { width: -1.5, height: -1.5 },
    textShadowRadius: 4,
  },
  legalMoveDot: {
    width: SQUARE_SIZE * 0.25,
    height: SQUARE_SIZE * 0.25,
    borderRadius: SQUARE_SIZE * 0.125,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
});

export default ChessBoard;
