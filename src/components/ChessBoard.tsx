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

// Helper function to convert square name to pixel coordinates on the board
const getSquarePixelPosition = (
  square: string,
  orientation: 'white' | 'black'
): { x: number; y: number } => {
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
    // For black orientation, flip both axes
    return {
      x: (7 - file) * SQUARE_SIZE,
      y: (7 - rank) * SQUARE_SIZE,
    };
  }
};

const ChessBoard: React.FC<ChessBoardProps> = memo(({
  fen,
  orientation,
  onSquarePress,
  selectedSquare,
  legalMoves,
}) => {
  const prevFen = useRef(fen);
  // Overlay animation state - single ghost piece that moves across the board
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

  useEffect(() => {
    if (prevFen.current !== fen) {
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
        // Calculate pixel positions for overlay animation
        const fromPos = getSquarePixelPosition(moveFrom, orientation);
        const toPos = getSquarePixelPosition(moveTo, orientation);
        
        // Set overlay state and start animation
        setOverlayMove({
          piece: movedPiece,
          fromPos,
          toPos,
        });
        
        // Reset position and opacity to start
        overlayPosition.setValue({ x: fromPos.x, y: fromPos.y });
        overlayOpacity.setValue(1);
        
        // Create parallel animations: move position and fade out much earlier
        // Longer duration for smoother, more visible animation
        const moveAnimation = Animated.timing(overlayPosition, {
          toValue: { x: toPos.x, y: toPos.y },
          duration: 300, // Slightly longer for smoother effect
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        });
        
        // Fade out starting at 25% of the animation to completely prevent overlap
        // This ensures the ghost piece is completely gone well before reaching the target
        const fadeAnimation = Animated.sequence([
          Animated.delay(75), // Start fading at 25% (75ms of 300ms)
          Animated.timing(overlayOpacity, {
            toValue: 0,
            duration: 100, // Fade out quickly over 100ms
            easing: Easing.in(Easing.quad), // Accelerate fade for faster disappearance
            useNativeDriver: true,
          }),
        ]);
        
        // Run both animations in parallel
        Animated.parallel([moveAnimation, fadeAnimation]).start(({ finished }) => {
          if (finished) {
            // Clear overlay after animation completes
            setOverlayMove(null);
            overlayOpacity.setValue(1); // Reset for next animation
          }
        });
      }
      
      prevFen.current = fen;
    }
  }, [fen]);

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
      
      {/* Overlay ghost piece that animates across the board */}
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
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1,
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
