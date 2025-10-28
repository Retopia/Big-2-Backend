// StandardAIStrategy.mjs - Encapsulates all AI decision-making logic
import * as CardGame from './CardGame.mjs';

// Main entry point for AI decision making
export function decideMove(aiHand, lastPlayedHand, gameState = null) {
  console.log("\n=== AI DECISION MAKING PROCESS ===");
  console.log(`AI hand size: ${aiHand.length} cards`);
  console.log(`AI hand: ${formatCards(aiHand)}`);

  if (lastPlayedHand && lastPlayedHand.length > 0) {
    console.log(`Last played hand: ${formatCards(lastPlayedHand)}`);
  } else {
    console.log("No cards on table - this is a fresh play");
  }

  // Get all valid moves the AI can play
  let possiblePlays = CardGame.calculatePossiblePlays(aiHand, lastPlayedHand);
  possiblePlays = CardGame.sortPlaysByStrength(possiblePlays)

  // If no valid plays, AI must pass
  if (possiblePlays.length === 0) {
    console.log("❌ NO VALID PLAYS AVAILABLE - AI MUST PASS");
    return { action: 'pass' };
  }

  console.log(`AI has ${possiblePlays.length} possible plays:`);
  possiblePlays.forEach((play, index) => {
    console.log(`  ${index + 1}. ${formatCards(play)} [${getHandTypeString(play)}]`);
  });

  // Gather game information for better decision making
  const opponentInfo = extractOpponentInfo(gameState);
  const gameInfo = {
    handSize: aiHand.length,
    isFirstPlay: !lastPlayedHand || lastPlayedHand.length === 0,
    isFinalCards: aiHand.length <= 5, // AI is close to winning
    opponentInfo: opponentInfo,
    round: gameState?.round || 1
  };

  console.log(`\nGame context:`);
  console.log(`- Round: ${gameInfo.round}`);
  console.log(`- First play: ${gameInfo.isFirstPlay}`);
  console.log(`- Final cards: ${gameInfo.isFinalCards}`);

  if (opponentInfo) {
    console.log("\nOpponent information:");
    Object.entries(opponentInfo).forEach(([name, info]) => {
      console.log(`- ${name}: ${info.handSize} cards${info.isCloseToWinning ? ' (CLOSE TO WINNING!)' : ''}`);
    });
  }

  // Choose play based on different strategies depending on game state
  let selectedPlay;

  // Strategy for opening play (no cards on table)
  if (gameInfo.isFirstPlay) {
    console.log("\n🎮 USING OPENING PLAY STRATEGY");
    selectedPlay = selectOpeningPlay(possiblePlays, aiHand);
  }
  // Strategy when AI is close to winning
  else if (gameInfo.isFinalCards) {
    console.log("\n🎮 USING ENDGAME STRATEGY (FEW CARDS LEFT)");
    selectedPlay = selectEndgamePlay(possiblePlays, aiHand);
  }
  // Strategy for mid-game
  else {
    console.log("\n🎮 USING MID-GAME STRATEGY");
    selectedPlay = selectMidgamePlay(possiblePlays, aiHand, lastPlayedHand, gameInfo);
  }

  const selectedIndex = possiblePlays.findIndex(play =>
    arraysEqual(play, selectedPlay)
  );

  console.log(`\n✅ FINAL DECISION: Play #${selectedIndex + 1}: ${formatCards(selectedPlay)} [${getHandTypeString(selectedPlay)}]`);
  console.log("=== END OF AI DECISION PROCESS ===\n");

  return {
    action: 'play',
    cards: selectedPlay
  };
}

// Strategy for opening play (when no cards on table)
function selectOpeningPlay(possiblePlays, aiHand) {
  console.log("Analyzing opening play options...");

  // Group plays by number of cards
  const playsBySize = groupPlaysBySize(possiblePlays);
  console.log("Grouping plays by size:", Object.keys(playsBySize).map(size => `${size} cards: ${playsBySize[size]?.length || 0} plays`).join(", "));

  // Singles strategy: Play low singles but save very high value cards
  if (playsBySize[1] && playsBySize[1].length > 0) {
    console.log("Considering single card plays...");
    const singles = playsBySize[1];
    const lowestSingle = singles[0]; // Already sorted by CardGame.sortPlaysByStrength

    // If our lowest card is a 2 or Ace and we have alternatives, save it
    const cardValue = CardGame.getCardValue(lowestSingle[0]);
    console.log(`Lowest single: ${formatCards([lowestSingle[0]])} (value: ${cardValue})`);

    if ((cardValue >= 14) && singles.length > 1) { // 14 is Ace, 15 is 2
      console.log("  ↪ This is a high-value card (A/2), saving it and playing second lowest single");
      return singles[1]; // Play second lowest single
    }

    console.log("  ↪ Playing lowest single");
    return lowestSingle;
  }

  // If we have pairs, prefer playing lower pairs first
  if (playsBySize[2] && playsBySize[2].length > 0) {
    console.log("Playing lowest pair");
    return playsBySize[2][0]; // Lowest pair
  }

  // If we have triples, consider playing them early
  if (playsBySize[3] && playsBySize[3].length > 0) {
    console.log("Playing lowest triple");
    return playsBySize[3][0]; // Lowest triple
  }

  // For 5-card combinations, play the lowest straight if available
  if (playsBySize[5] && playsBySize[5].length > 0) {
    console.log("Analyzing 5-card combinations...");
    const fiveCardHands = playsBySize[5].map(play => {
      const handResult = CardGame.validateHand(play);
      return { play, type: handResult.type, value: handResult.value };
    });

    // Look for the lowest straight
    const straights = fiveCardHands.filter(hand => hand.type === 'straight');
    if (straights.length > 0) {
      console.log("  ↪ Found a straight, playing lowest straight");
      return straights[0].play;
    }

    // If no straight, play the lowest 5-card hand
    console.log("  ↪ No straight found, playing lowest 5-card hand");
    return playsBySize[5][0];
  }

  // Default to the lowest possible play
  console.log("No special case, defaulting to lowest valid play");
  return possiblePlays[0];
}

// Strategy for mid-game plays
function selectMidgamePlay(possiblePlays, aiHand, lastPlayedHand, gameInfo) {
  console.log("Analyzing mid-game options...");

  // Group plays by number of cards
  const playsBySize = groupPlaysBySize(possiblePlays);
  const playHandSize = lastPlayedHand.length;

  // Get hand distribution info
  const handDistribution = analyzeHandDistribution(aiHand);
  console.log(`Hand distribution: ${handDistribution.singletons.length} singles, ${handDistribution.pairs.length} pairs, ${handDistribution.triples.length} triples, ${handDistribution.quads.length} quads`);

  // Get information about the last played hand
  const lastHandResult = CardGame.validateHand(lastPlayedHand);
  const isHighLastPlay = isHighValuePlay(lastHandResult);
  console.log(`Last play is high-value (A/2): ${isHighLastPlay}`);

  // Consider opponent hand sizes when making decisions
  const opponentInfo = gameInfo.opponentInfo;

  // Strategy depends on player hand size and opponents' status
  // Check if any opponent is close to winning
  const opponentCloseToWinning = opponentInfo && Object.values(opponentInfo).some(
    player => player.handSize <= 3 && player.handSize > 0
  );

  if (opponentCloseToWinning) {
    console.log("⚠️ An opponent is close to winning - considering defensive play");
  }

  // Counter strategy: If opponent played high value card (Ace, 2), 
  // try to play the minimum required to win
  if (isHighLastPlay && playsBySize[playHandSize] && playsBySize[playHandSize].length > 0) {
    // Play the lowest card that can beat the high play
    console.log("Opponent played high value card, using counter strategy (play minimum required)");
    return playsBySize[playHandSize][0];
  }

  if (gameInfo.handSize > 10) {
    // Early game: Play lowest cards first to get rid of weak cards
    console.log("Early game strategy: play lowest cards to get rid of weak cards");
    return possiblePlays[0]; // Lowest valid play
  }
  else if (gameInfo.handSize > 5) {
    // Mid game: Be more strategic based on hand distribution
    console.log("Mid-game strategy: be more strategic with card selection");

    // If opponent is close to winning, play stronger cards to block them
    if (opponentCloseToWinning && playHandSize === 1 && playsBySize[1] && playsBySize[1].length > 1) {
      // Play a higher single than we normally would to block opponent
      const highIndex = Math.min(Math.floor(playsBySize[1].length * 0.7), playsBySize[1].length - 1);
      console.log(`Playing stronger single (ranked ${highIndex + 1}/${playsBySize[1].length}) to block opponent`);
      return playsBySize[1][highIndex];
    }

    // If we have many singles, prioritize getting rid of them
    if (handDistribution.singletons.length > 3 && playsBySize[1] && playsBySize[1].length > 0) {
      // Play lowest single
      console.log("Too many singleton cards, prioritizing getting rid of lowest single");
      return playsBySize[1][0];
    }

    // If we have many pairs, prioritize getting rid of weaker ones
    if (handDistribution.pairs.length > 2 && playsBySize[2] && playsBySize[2].length > 0) {
      // Play lowest pair
      console.log("Multiple pairs in hand, prioritizing getting rid of lowest pair");
      return playsBySize[2][0];
    }

    // If we have trips, consider playing them
    if (handDistribution.triples.length > 0 && playsBySize[3] && playsBySize[3].length > 0) {
      // Play lowest triple
      console.log("Have triples, playing lowest triple");
      return playsBySize[3][0];
    }

    // Middle range play: sometimes play middle strength to avoid using all strong cards
    if (possiblePlays.length > 2) {
      const midIndex = Math.floor(possiblePlays.length / 2);

      const randomThreshold = gameInfo.round > 3 ? 0.4 : 0.25; // Increase randomness in later rounds
      if (Math.random() < randomThreshold) {
        console.log(`Using mixed strategy (30% chance): playing middle-strength card (ranked ${midIndex + 1}/${possiblePlays.length})`);
        return possiblePlays[midIndex];
      }
    }

    // Default to lowest play
    console.log("No special case, defaulting to lowest valid play");
    return possiblePlays[0];
  }
  else {
    // Approaching endgame: Be more aggressive to get rid of cards
    console.log("Approaching endgame strategy: be more aggressive to empty hand");

    // If we're in a later round and opponent is close to winning,
    // play more aggressively with stronger cards
    if (gameInfo.round > 3 && opponentCloseToWinning) {
      // Try to play cards that will definitely win this round
      console.log("Late round + opponent close to winning: looking for a strong play to block");
      const strongPlay = findStrongPlayToBlock(possiblePlays, lastPlayedHand);
      if (strongPlay) {
        console.log("Found stronger play to block opponent from winning");
        return strongPlay;
      }
    }

    // Look for plays that would leave us with good follow-up options
    console.log("Evaluating plays based on what cards would remain...");

    // Try to avoid creating "dead" cards (cards that will be difficult to play)
    const playsWithScores = possiblePlays.map(play => {
      const remainingCards = removeCardsFromHand(aiHand, play);
      const deadCardScore = evaluateDeadCards(remainingCards);
      console.log(`  Play ${formatCards(play)}: dead card score = ${deadCardScore}`);
      return { play, score: deadCardScore };
    });

    // Sort by score (lower is better - fewer dead cards)
    playsWithScores.sort((a, b) => a.score - b.score);

    // 70% chance to play the best option, 30% chance to play the second best if available
    if (playsWithScores.length > 1 && Math.random() < 0.3) {
      console.log("Using mixed strategy (30% chance): playing second-best option to avoid predictability");
      return playsWithScores[1].play;
    }

    console.log("Playing option with fewest dead cards afterward");
    return playsWithScores[0].play;
  }
}

// Strategy for endgame (AI has 5 or fewer cards left)
function selectEndgamePlay(possiblePlays, aiHand) {
  console.log("Analyzing endgame options (5 or fewer cards)...");

  // Group plays by number of cards
  const playsBySize = groupPlaysBySize(possiblePlays);

  // Highly prefer plays that will use multiple cards
  const multiCardPlays = possiblePlays.filter(play => play.length > 1);

  if (multiCardPlays.length > 0) {
    // Sort multi-card plays by number of cards (descending)
    multiCardPlays.sort((a, b) => b.length - a.length);

    // Play the largest combination to get rid of more cards
    console.log(`Endgame strategy: playing largest combination (${multiCardPlays[0].length} cards) to empty hand faster`);
    return multiCardPlays[0];
  }

  // If we have to play singles, prioritize getting rid of "dead" singles
  if (playsBySize[1] && playsBySize[1].length > 0) {
    // Analyze the singletons to find potentially "dead" cards
    const singlePlays = playsBySize[1];
    console.log("Only have single cards to play, evaluating which to play first...");

    // Evaluate each single card
    const scoredSingles = singlePlays.map(play => {
      const cardValue = CardGame.getCardValue(play[0]);
      let score = 0;

      // Penalize high value cards less (we want to save them)
      if (cardValue >= 14) { // Ace or 2
        score += 10;
        console.log(`  ${formatCards(play)}: score +10 (high value card)`);
      } else if (cardValue >= 10) { // Face cards
        score += 5;
        console.log(`  ${formatCards(play)}: score +5 (face card)`);
      } else {
        console.log(`  ${formatCards(play)}: score +0 (low value card)`);
      }

      return { play, score };
    });

    // Sort by score (lower is better for cards we want to get rid of)
    scoredSingles.sort((a, b) => a.score - b.score);

    console.log(`Prioritizing playing ${formatCards(scoredSingles[0].play)} (lowest score: ${scoredSingles[0].score})`);
    return scoredSingles[0].play;
  }

  // Default to the lowest possible play
  console.log("No special cases, defaulting to lowest valid play");
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

  // Singleton non-high cards are "dead" cards
  distribution.singletons.forEach(card => {
    const value = CardGame.getCardValue(card);
    if (value < 12) { // Not a face card, Ace, or 2
      deadCardScore += 1;
    }
  });

  // Incomplete high card combinations might be difficult to play
  const highCards = remainingCards.filter(card => {
    const value = CardGame.getCardValue(card);
    return value >= 14; // Ace or 2
  });

  // If we have high cards but no combinations, they might be hard to play
  if (highCards.length > 0 && distribution.pairs.length === 0 && distribution.triples.length === 0) {
    deadCardScore += highCards.length * 0.5;
  }

  return deadCardScore;
}

// Extract information about opponents from the game state
function extractOpponentInfo(gameState) {
  if (!gameState || !gameState.players) {
    return null;
  }

  const opponentInfo = {};

  gameState.players.forEach(player => {
    // Skip the AI player itself
    if (!player.isAI) {
      opponentInfo[player.name] = {
        handSize: player.handSize || 0,
        isCloseToWinning: (player.handSize || 0) <= 3 && (player.handSize || 0) > 0
      };
    }
  });

  return opponentInfo;
}

// Find a stronger play to block opponents who are close to winning
function findStrongPlayToBlock(possiblePlays, lastPlayedHand) {
  if (possiblePlays.length <= 1) return null;

  // Get stronger plays - look at the top 30% of our options
  const strongIndex = Math.max(Math.floor(possiblePlays.length * 0.7), 1);
  const strongPlays = possiblePlays.slice(strongIndex);

  if (strongPlays.length > 0) {
    // Return the weakest of our strong plays
    return strongPlays[0];
  }

  return null;
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