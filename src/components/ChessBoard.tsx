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
  'P': '♙', 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔',
  'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚',
};

const AnimatedPiece: React.FC<{
  piece: string;
  fromSquare: string | null;
  toSquare: string;
  orientation: 'white' | 'black';
}> = ({ piece, fromSquare, toSquare, orientation }) => {
  const getInitialPosition = () => {
    if (!fromSquare || fromSquare === toSquare) {
      return { x: 0, y: 0 };
    }
    
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    
    const fromFile = files.indexOf(fromSquare[0]);
    const fromRank = ranks.indexOf(fromSquare[1]);
    const toFile = files.indexOf(toSquare[0]);
    const toRank = ranks.indexOf(toSquare[1]);
    
    let deltaX = (toFile - fromFile) * SQUARE_SIZE;
    let deltaY = (toRank - fromRank) * SQUARE_SIZE;
    
    if (orientation === 'black') {
      deltaX = -deltaX;
      deltaY = -deltaY;
    }
    
    return { x: -deltaX, y: -deltaY };
  };

  const animatedPosition = useRef(new Animated.ValueXY(getInitialPosition())).current;
  const isWhitePiece = piece === piece.toUpperCase();

  useEffect(() => {
    if (fromSquare && fromSquare !== toSquare) {
      Animated.timing(animatedPosition, {
        toValue: { x: 0, y: 0 },
        duration: 180,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    }
  }, []);

  return (
    <Animated.View
      style={[
        styles.animatedPieceContainer,
        {
          transform: [
            { translateX: animatedPosition.x },
            { translateY: animatedPosition.y },
          ],
        },
      ]}
    >
      <Text
        style={[
          styles.piece,
          isWhitePiece ? styles.whitePiece : styles.blackPiece,
        ]}
      >
        {PIECE_SYMBOLS[piece] || piece}
      </Text>
    </Animated.View>
  );
};

const ChessBoard: React.FC<ChessBoardProps> = memo(({
  fen,
  orientation,
  onSquarePress,
  selectedSquare,
  legalMoves,
}) => {
  const prevFen = useRef(fen);
  const [lastMove, setLastMove] = useState<{ from: string; to: string; piece: string } | null>(null);
  const [animatingSquare, setAnimatingSquare] = useState<string | null>(null);

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
        setLastMove({ from: moveFrom, to: moveTo, piece: movedPiece });
        setAnimatingSquare(moveTo);
        setTimeout(() => {
          setLastMove(null);
          setAnimatingSquare(null);
        }, 180);
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
    
    const isAnimating = lastMove?.to === squareName;
    const shouldHideStatic = animatingSquare === squareName;
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
        {piece && isAnimating && lastMove ? (
          <AnimatedPiece
            piece={piece}
            fromSquare={lastMove.from}
            toSquare={lastMove.to}
            orientation={orientation}
          />
        ) : piece && !shouldHideStatic ? (
          <Text
            style={[
              styles.piece,
              isWhitePiece ? styles.whitePiece : styles.blackPiece,
            ]}
          >
            {PIECE_SYMBOLS[piece] || piece}
          </Text>
        ) : null}
        {isLegalMove && !piece && <View style={styles.legalMoveDot} />}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <View key={row} style={styles.row}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((col) => renderSquare(row, col))}
        </View>
      ))}
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
  animatedPieceContainer: {
    position: 'absolute',
    width: SQUARE_SIZE,
    height: SQUARE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    top: 0,
    left: 0,
  },
  piece: {
    fontSize: SQUARE_SIZE * 0.85,
    fontWeight: 'bold',
    lineHeight: SQUARE_SIZE,
  },
  whitePiece: {
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: -2, height: -2 },
    textShadowRadius: 5,
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
