// StandardAIStrategy.mjs - Encapsulates all AI decision-making logic
import * as CardGame from './CardGame.mjs';

// Main entry point for AI decision making
export function decideMove(aiHand, lastPlayedHand, gameState = null) {
  // Get all valid moves the AI can play
  let possiblePlays = CardGame.calculatePossiblePlays(
    aiHand, 
    lastPlayedHand, 
    gameState?.moveHistory || [], 
    gameState?.lowestCardValue
  );
  possiblePlays = CardGame.sortPlaysByStrength(possiblePlays)

  // If no valid plays, AI must pass
  if (possiblePlays.length === 0) {
    console.log("Standard AI: No valid plays - passing");
    return { action: 'pass' };
  }

  // Gather game information for better decision making
  const opponentInfo = extractOpponentInfo(gameState);
  const gameInfo = {
    handSize: aiHand.length,
    isFirstPlay: !lastPlayedHand || lastPlayedHand.length === 0,
    isFinalCards: aiHand.length <= 5, // AI is close to winning
    opponentInfo: opponentInfo,
    round: gameState?.round || 1
  };

  // Choose play based on different strategies depending on game state
  let selectedPlay;

  // Strategy for opening play (no cards on table)
  if (gameInfo.isFirstPlay) {
    selectedPlay = selectOpeningPlay(possiblePlays, aiHand, gameInfo);
  }
  // Strategy when AI is close to winning
  else if (gameInfo.isFinalCards) {
    selectedPlay = selectEndgamePlay(possiblePlays, aiHand);
  }
  // Strategy for mid-game
  else {
    selectedPlay = selectMidgamePlay(possiblePlays, aiHand, lastPlayedHand, gameInfo);
  }

  console.log(`Standard AI: Play ${formatCards(selectedPlay)} [${getHandTypeString(selectedPlay)}]`);

  return {
    action: 'play',
    cards: selectedPlay
  };
}

// Strategy for opening play (when no cards on table)
function selectOpeningPlay(possiblePlays, aiHand, gameInfo = {}) {
  // Group plays by number of cards
  const playsBySize = groupPlaysBySize(possiblePlays);

  // DEFENSIVE STRATEGY: If opponent is close to winning, play defensively
  const opponentCloseToWinning = gameInfo.opponentInfo && Object.values(gameInfo.opponentInfo).some(
    player => player.handSize <= 2 && player.handSize > 0
  );

  if (opponentCloseToWinning) {
    // Priority: 5-card hands > high pairs > high singles
    if (playsBySize[5] && playsBySize[5].length > 0) {
      return playsBySize[5][0];
    }
    
    if (playsBySize[2] && playsBySize[2].length > 0) {
      const highPairIndex = Math.max(0, playsBySize[2].length - 1);
      return playsBySize[2][highPairIndex];
    }
    
    if (playsBySize[1] && playsBySize[1].length > 0) {
      const singles = playsBySize[1];
      const highSingleIndex = Math.max(0, Math.floor(singles.length * 0.7));
      return singles[highSingleIndex];
    }
  }

  // Normal strategy: Prioritize getting rid of low cards while preserving high value cards
  
  // For singles: Play lowest but save Aces and 2s if possible
  if (playsBySize[1] && playsBySize[1].length > 0) {
    const singles = playsBySize[1];
    const lowestSingle = singles[0];
    const cardValue = CardGame.getCardValue(lowestSingle[0]);

    // Save high value cards if we have alternatives
    if (cardValue >= 14 && singles.length > 1) {
      return singles[1]; // Play second lowest
    }
    return lowestSingle;
  }

  // For pairs: Play lowest pair
  if (playsBySize[2] && playsBySize[2].length > 0) {
    return playsBySize[2][0];
  }

  // For triples: Play lowest triple
  if (playsBySize[3] && playsBySize[3].length > 0) {
    return playsBySize[3][0];
  }

  // For 5-card hands: Prefer straights over other combinations
  if (playsBySize[5] && playsBySize[5].length > 0) {
    const fiveCardHands = playsBySize[5].map(play => {
      const handResult = CardGame.validateHand(play);
      return { play, type: handResult.type, value: handResult.value };
    });

    const straights = fiveCardHands.filter(hand => hand.type === 'straight');
    if (straights.length > 0) {
      return straights[0].play;
    }
    return playsBySize[5][0];
  }

  // Default to lowest possible play
  return possiblePlays[0];
}

// Strategy for mid-game plays
function selectMidgamePlay(possiblePlays, aiHand, lastPlayedHand, gameInfo) {
  const playsBySize = groupPlaysBySize(possiblePlays);
  const playHandSize = lastPlayedHand.length;
  const handDistribution = analyzeHandDistribution(aiHand);
  
  // Check if any opponent is close to winning
  const opponentCloseToWinning = gameInfo.opponentInfo && Object.values(gameInfo.opponentInfo).some(
    player => player.handSize <= 3 && player.handSize > 0
  );

  // Counter high-value plays efficiently
  const lastHandResult = CardGame.validateHand(lastPlayedHand);
  const isHighLastPlay = isHighValuePlay(lastHandResult);
  
  if (isHighLastPlay && playsBySize[playHandSize] && playsBySize[playHandSize].length > 0) {
    return playsBySize[playHandSize][0]; // Play minimum to beat high card
  }

  // Early game (>10 cards): Focus on clearing low cards
  if (gameInfo.handSize > 10) {
    return possiblePlays[0];
  }
  
  // Mid game (6-10 cards): Strategic play based on hand composition
  else if (gameInfo.handSize > 5) {
    // Defensive play if opponent close to winning
    if (opponentCloseToWinning && playHandSize === 1 && playsBySize[1] && playsBySize[1].length > 1) {
      const highIndex = Math.min(Math.floor(playsBySize[1].length * 0.7), playsBySize[1].length - 1);
      return playsBySize[1][highIndex];
    }

    // Prioritize clearing excess singles
    if (handDistribution.singletons.length > 3 && playsBySize[1] && playsBySize[1].length > 0) {
      return playsBySize[1][0];
    }

    // Clear pairs if we have many
    if (handDistribution.pairs.length > 2 && playsBySize[2] && playsBySize[2].length > 0) {
      return playsBySize[2][0];
    }

    // Play triples to reduce hand size
    if (handDistribution.triples.length > 0 && playsBySize[3] && playsBySize[3].length > 0) {
      return playsBySize[3][0];
    }

    // Add some unpredictability in later rounds
    if (possiblePlays.length > 2 && gameInfo.round > 3 && Math.random() < 0.3) {
      const midIndex = Math.floor(possiblePlays.length / 2);
      return possiblePlays[midIndex];
    }

    return possiblePlays[0];
  }
  
  // Approaching endgame (≤5 cards): Aggressive play
  else {
    // Block opponents aggressively in late rounds
    if (gameInfo.round > 3 && opponentCloseToWinning) {
      const strongPlay = findStrongPlayToBlock(possiblePlays, lastPlayedHand);
      if (strongPlay) {
        return strongPlay;
      }
    }

    // Optimize for fewer dead cards
    const playsWithScores = possiblePlays.map(play => {
      const remainingCards = removeCardsFromHand(aiHand, play);
      const deadCardScore = evaluateDeadCards(remainingCards);
      return { play, score: deadCardScore };
    });

    playsWithScores.sort((a, b) => a.score - b.score);

    // 70% best option, 30% second best for unpredictability
    if (playsWithScores.length > 1 && Math.random() < 0.3) {
      return playsWithScores[1].play;
    }

    return playsWithScores[0].play;
  }
}

// Strategy for endgame (AI has 5 or fewer cards left)
function selectEndgamePlay(possiblePlays, aiHand) {
  const playsBySize = groupPlaysBySize(possiblePlays);

  // Prioritize multi-card plays to empty hand faster
  const multiCardPlays = possiblePlays.filter(play => play.length > 1);

  if (multiCardPlays.length > 0) {
    // Sort by number of cards (largest first)
    multiCardPlays.sort((a, b) => b.length - a.length);
    return multiCardPlays[0];
  }

  // For singles: Prioritize low-value cards, save high cards for later
  if (playsBySize[1] && playsBySize[1].length > 0) {
    const singlePlays = playsBySize[1];

    // Score singles based on strategic value
    const scoredSingles = singlePlays.map(play => {
      const cardValue = CardGame.getCardValue(play[0]);
      let score = 0;

      if (cardValue >= 14) { // Ace or 2 - save these
        score += 10;
      } else if (cardValue >= 10) { // Face cards - moderate priority to save
        score += 5;
      }
      // Low cards get score 0 - prioritize playing these

      return { play, score };
    });

    // Sort by score (lowest first = cards we want to play first)
    scoredSingles.sort((a, b) => a.score - b.score);
    return scoredSingles[0].play;
  }

  // Default fallback
  return possiblePlays[0];
}

// Helper Functions

// Group plays by the number of cards they contain
function groupPlaysBySize(plays) {
  const groups = {};

  plays.forEach(play => {
    const size = play.length;
    if (!groups[size]) {
      groups[size] = [];
    }
    groups[size].push(play);
  });

  return groups;
}

// Analyze the hand to find singletons, pairs, and triples
function analyzeHandDistribution(hand) {
  const cardsByValue = CardGame.groupCardsByValue(hand);

  const distribution = {
    singletons: [], // Cards with no matches
    pairs: [],      // Values with exactly 2 cards
    triples: [],    // Values with 3 cards
    quads: []       // Values with 4 cards
  };

  Object.entries(cardsByValue).forEach(([value, cards]) => {
    if (cards.length === 1) {
      distribution.singletons.push(cards[0]);
    } else if (cards.length === 2) {
      distribution.pairs.push(cards);
    } else if (cards.length === 3) {
      distribution.triples.push(cards);
    } else if (cards.length === 4) {
      distribution.quads.push(cards);
    }
  });

  return distribution;
}

// Remove a set of cards from a hand and return the remaining cards
function removeCardsFromHand(hand, cardsToRemove) {
  const handCopy = [...hand];

  cardsToRemove.forEach(cardToRemove => {
    const index = handCopy.findIndex(card =>
      card.suit === cardToRemove.suit && card.value === cardToRemove.value);

    if (index !== -1) {
      handCopy.splice(index, 1);
    }
  });

  return handCopy;
}

// Evaluate how many "dead" cards would be left in hand after a play
function evaluateDeadCards(remainingCards) {
  const distribution = analyzeHandDistribution(remainingCards);
  let deadCardScore = 0;

  // Count low singleton cards as potential dead cards
  distribution.singletons.forEach(card => {
    const value = CardGame.getCardValue(card);
    if (value < 12) deadCardScore += 1;
  });

  // Penalize isolated high cards if no pairs/triples exist
  const highCards = remainingCards.filter(card => CardGame.getCardValue(card) >= 14);
  if (highCards.length > 0 && distribution.pairs.length === 0 && distribution.triples.length === 0) {
    deadCardScore += highCards.length * 0.5;
  }

  return deadCardScore;
}

// Extract information about opponents from the game state
function extractOpponentInfo(gameState) {
  if (!gameState?.players) return null;

  const opponentInfo = {};
  
  gameState.players.forEach(player => {
    // Include all players (both human and AI opponents)
    if (player.name !== gameState.currentPlayerName) {
      const handSize = player.handSize || 0;
      opponentInfo[player.name] = {
        handSize,
        isCloseToWinning: handSize <= 3 && handSize > 0
      };
    }
  });

  return Object.keys(opponentInfo).length > 0 ? opponentInfo : null;
}

// Find a stronger play to block opponents who are close to winning
function findStrongPlayToBlock(possiblePlays, lastPlayedHand) {
  if (possiblePlays.length <= 1) return null;

  // Look at the stronger 30% of available plays
  const strongIndex = Math.max(Math.floor(possiblePlays.length * 0.7), 1);
  const strongPlays = possiblePlays.slice(strongIndex);

  // Return the weakest of the strong plays (most conservative blocking move)
  return strongPlays.length > 0 ? strongPlays[0] : null;
}

// Check if a play is a high-value play (contains Aces or 2s)
function isHighValuePlay(handResult) {
  if (!handResult || !handResult.valid) return false;

  // For single, pair, triple - check the value directly
  if (['single', 'pair', 'triple'].includes(handResult.type)) {
    // Values above 14 are Aces and 2s
    return handResult.value >= 14;
  }

  // For 5-card hands, the overall hand value doesn't tell us if it has high cards
  // We'd need the actual cards, but we just return false as a simplification
  return false;
}

// Helper to check if two card arrays are equal
function arraysEqual(arr1, arr2) {
  if (!arr1 || !arr2) return false;
  if (arr1.length !== arr2.length) return false;

  for (let i = 0; i < arr1.length; i++) {
    const card1 = arr1[i];
    const card2 = arr2[i];

    if (card1.suit !== card2.suit || card1.value !== card2.value) {
      return false;
    }
  }

  return true;
}

// Format cards for better logging
function formatCards(cards) {
  if (!cards || cards.length === 0) return "[]";
  return "[" + cards.map(card => `${card.value}${card.suit}`).join(", ") + "]";
}

// Get a readable string for the hand type
function getHandTypeString(play) {
  if (!play || play.length === 0) return "invalid";

  const handResult = CardGame.validateHand(play);
  if (!handResult.valid) return "invalid";

  return handResult.type;
}