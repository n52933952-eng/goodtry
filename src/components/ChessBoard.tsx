import React, { memo, useMemo, useRef, useLayoutEffect, useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, useWindowDimensions, Animated, Easing } from 'react-native';
import { COLORS } from '../utils/constants';
import LichessPieceSvg from './LichessPieceSvg';
import {
  CHESS_PIECE_SETS,
  DEFAULT_CHESS_PIECE_SET_ID,
  fenCharToPieceCode,
  lichessPieceSvgUrl,
} from '../utils/chessPieceSets';

const MIN_BOARD_SIZE = 176;
/** Exported so review “step back” can delay FEN until the slide finishes. */
export const CHESS_MOVE_ANIMATION_DURATION_MS = 320;
const MOVE_DURATION_MS = CHESS_MOVE_ANIMATION_DURATION_MS;

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
  /** Lichess piece-set folder id (same CDN as web). */
  pieceSetId?: string;
  /** Light square color (defaults to the original wood palette). */
  lightColor?: string;
  /** Dark square color (defaults to the original wood palette). */
  darkColor?: string;
  /**
   * Board edge length in dp. When omitted the board fits the shorter window side,
   * so it stays square on any screen and after rotation.
   */
  size?: number;
}

const ChessBoard: React.FC<ChessBoardProps> = memo(({
  fen,
  orientation,
  onSquarePress,
  selectedSquare,
  legalMoves,
  moveAnimation,
  lightColor = '#F0D9B5',
  darkColor = '#B58863',
  pieceSetId = DEFAULT_CHESS_PIECE_SET_ID,
  size,
}) => {
  const setForPieces = CHESS_PIECE_SETS.some((s) => s.id === pieceSetId)
    ? pieceSetId!
    : DEFAULT_CHESS_PIECE_SET_ID;

  const { width: winWidth, height: winHeight } = useWindowDimensions();

  // Square size must be whole dp, otherwise rows drift and hairline gaps appear.
  const squareSize = useMemo(() => {
    const requested = size && size > 0 ? size : Math.min(winWidth, winHeight) - 32;
    return Math.max(MIN_BOARD_SIZE, Math.floor(requested)) / 8;
  }, [size, winWidth, winHeight]);

  const boardSize = squareSize * 8;
  const pieceSize = squareSize * 0.88;

  const dynamicStyles = useMemo(
    () => ({
      container: { width: boardSize, height: boardSize },
      row: { width: boardSize, height: squareSize },
      square: { width: squareSize, height: squareSize },
      overlayPiece: { width: squareSize, height: squareSize },
      pieceSvgWrap: { width: pieceSize, height: pieceSize },
      legalMoveDot: {
        width: squareSize * 0.25,
        height: squareSize * 0.25,
        borderRadius: squareSize * 0.125,
      },
    }),
    [boardSize, squareSize, pieceSize],
  );

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
        x: file * squareSize,
        y: rank * squareSize,
      };
    }
    return {
      x: (7 - file) * squareSize,
      y: (7 - rank) * squareSize,
    };
  }, [orientation, squareSize]);

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
    return (row + col) % 2 === 0 ? lightColor : darkColor;
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

    const hideForSlide =
      isSliding &&
      moveAnimation &&
      (squareName === moveAnimation.from || squareName === moveAnimation.to);

    return (
      <TouchableOpacity
        key={`${row}-${col}`}
        style={[
          styles.square,
          dynamicStyles.square,
          { backgroundColor: getSquareColor(row, col) },
          isSelected && styles.selectedSquare,
          isLegalMove && styles.legalMoveSquare,
        ]}
        onPress={() => onSquarePress(squareName)}
      >
        {piece && !hideForSlide && (
          <View style={[styles.pieceSvgWrap, dynamicStyles.pieceSvgWrap]} pointerEvents="none">
            <LichessPieceSvg
              width={pieceSize}
              height={pieceSize}
              uri={lichessPieceSvgUrl(setForPieces, fenCharToPieceCode(piece))}
            />
          </View>
        )}
        {isLegalMove && !piece && (
          <View style={[styles.legalMoveDot, dynamicStyles.legalMoveDot]} />
        )}
      </TouchableOpacity>
    );
  };

  const slidingPiece = moveAnimation?.piece;

  return (
    <View style={[styles.container, dynamicStyles.container]}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <View key={row} style={[styles.row, dynamicStyles.row]}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((col) => renderSquare(row, col))}
        </View>
      ))}

      {isSliding && slidingPiece && (
        <Animated.View
          style={[
            styles.overlayPiece,
            dynamicStyles.overlayPiece,
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
          <View style={[styles.pieceSvgWrap, dynamicStyles.pieceSvgWrap]} pointerEvents="none">
            <LichessPieceSvg
              width={pieceSize}
              height={pieceSize}
              uri={lichessPieceSvgUrl(
                setForPieces,
                fenCharToPieceCode(slidingPiece),
              )}
            />
          </View>
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
    prevProps.pieceSetId === nextProps.pieceSetId &&
    prevProps.lightColor === nextProps.lightColor &&
    prevProps.darkColor === nextProps.darkColor &&
    prevProps.size === nextProps.size &&
    JSON.stringify(prevProps.legalMoves) === JSON.stringify(nextProps.legalMoves)
  );
});

const styles = StyleSheet.create({
  /** Chess files must always run a→h left-to-right, even when the app is RTL (Arabic). */
  container: {
    borderWidth: 2,
    borderColor: COLORS.border,
    alignSelf: 'center',
    overflow: 'visible',
    direction: 'ltr',
  },
  row: {
    flexDirection: 'row',
    direction: 'ltr',
  },
  square: {
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
    justifyContent: 'center',
    alignItems: 'center',
    top: 0,
    left: 0,
    zIndex: 1000,
  },
  pieceSvgWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalMoveDot: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
});

export default ChessBoard;
