import React, { memo, useMemo, useRef, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Animated, Easing } from 'react-native';
import { COLORS } from '../utils/constants';

const { width } = Dimensions.get('window');
const SQUARE_SIZE = (width - 32) / 8;
const BOARD_SIZE = SQUARE_SIZE * 8;

interface ChessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  onSquarePress: (square: string) => void;
  selectedSquare: string | null;
  legalMoves: string[];
}

const PIECE_SYMBOLS: { [key: string]: string } = {
  // NOTE: Unicode "white" chess glyphs tend to look much bolder/heavier on Android.
  // To better match the web (SVG) look, render WHITE pieces using the slimmer glyph shapes
  // (same shapes as black pieces) but keep them styled as white via `styles.whitePiece`.
  'P': '♟', 'N': '♞', 'B': '♝', 'R': '♜', 'Q': '♛', 'K': '♚',
  'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚',
};

const ChessBoard: React.FC<ChessBoardProps> = memo(({
  fen,
  orientation,
  onSquarePress,
  selectedSquare,
  legalMoves,
}) => {
  const prevFen = useRef(fen);
  const prevSelectedSquare = useRef(selectedSquare);
  // Overlay animation state - only for opponent moves
  const [overlayMove, setOverlayMove] = useState<{
    piece: string;
    fromPos: { x: number; y: number };
    toPos: { x: number; y: number };
  } | null>(null);
  const overlayPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

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

  // Helper function to convert square name to pixel coordinates
  const getSquarePixelPosition = (square: string): { x: number; y: number } => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    
    const file = files.indexOf(square[0]);
    const rank = ranks.indexOf(square[1]);
    
    if (orientation === 'white') {
      return {
        x: file * SQUARE_SIZE,
        y: rank * SQUARE_SIZE,
      };
    } else {
      return {
        x: (7 - file) * SQUARE_SIZE,
        y: (7 - rank) * SQUARE_SIZE,
      };
    }
  };

  const parseFen = (fenString: string) => {
    const parsedBoard: (string | null)[][] = [];
    const rows = fenString.split(' ')[0].split('/');
    
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
  };

  useEffect(() => {
    // Check if this is a user move (selectedSquare was just cleared) or opponent move
    const isUserMove = prevSelectedSquare.current !== null && selectedSquare === null;
    prevSelectedSquare.current = selectedSquare;

    if (prevFen.current !== fen && !isUserMove) {
      // This is an opponent move - add subtle animation
      const prevBoard = parseFen(prevFen.current);
      const currBoard = parseFen(fen);
      
      let moveFrom: string | null = null;
      let moveTo: string | null = null;
      let movedPiece: string | null = null;
      
      const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
      
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const prevPiece = prevBoard[row][col];
          const currPiece = currBoard[row][col];
          const squareName = files[col] + ranks[row];
          
          if (prevPiece && !currPiece) {
            moveFrom = squareName;
            movedPiece = prevPiece;
          }
          if (!prevPiece && currPiece) {
            moveTo = squareName;
            if (!movedPiece) movedPiece = currPiece;
          }
          if (prevPiece && currPiece && prevPiece !== currPiece) {
            moveTo = squareName;
            if (!movedPiece) movedPiece = currPiece;
          }
        }
      }
      
      if (moveFrom && moveTo && movedPiece) {
        // Subtle animation for opponent moves only
        const fromPos = getSquarePixelPosition(moveFrom);
        const toPos = getSquarePixelPosition(moveTo);
        
        setOverlayMove({
          piece: movedPiece,
          fromPos,
          toPos,
        });
        
        overlayPosition.setValue({ x: fromPos.x, y: fromPos.y });
        overlayOpacity.setValue(1);
        
        // Quick, subtle animation (200ms)
        const moveAnimation = Animated.timing(overlayPosition, {
          toValue: { x: toPos.x, y: toPos.y },
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        });
        
        // Fade out quickly to prevent overlap
        const fadeAnimation = Animated.sequence([
          Animated.delay(50), // Start fading early
          Animated.timing(overlayOpacity, {
            toValue: 0,
            duration: 80,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]);
        
        Animated.parallel([moveAnimation, fadeAnimation]).start(({ finished }) => {
          if (finished) {
            setOverlayMove(null);
            overlayOpacity.setValue(1);
          }
        });
      }
    }
    
    prevFen.current = fen;
  }, [fen, selectedSquare, orientation]);

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
        {piece && (
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

  const isWhitePiece = overlayMove?.piece && overlayMove.piece === overlayMove.piece.toUpperCase();

  return (
    <View style={styles.container}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <View key={row} style={styles.row}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((col) => renderSquare(row, col))}
        </View>
      ))}
      
      {/* Subtle animation overlay - only for opponent moves */}
      {overlayMove && (
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
              isWhitePiece ? styles.whitePiece : styles.blackPiece,
            ]}
          >
            {PIECE_SYMBOLS[overlayMove.piece] || overlayMove.piece}
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
