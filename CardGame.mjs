// Get numerical value of a card for comparison (higher is better)
export function getCardValue(card) {
  // Define value based on card value
  let value;
  switch (card.value) {
    case '2': value = 15; break; // 2 is highest in Big 2
    case 'A': value = 14; break;
    case 'K': value = 13; break;
    case 'Q': value = 12; break;
    case 'J': value = 11; break;
    default: value = parseInt(card.value); break;
  }

  // Add suit weight (Spade > Heart > Club > Diamond)
  switch (card.suit) {
    case '♠': value += 0.4; break;
    case '♥': value += 0.3; break;
    case '♣': value += 0.2; break;
    case '♦': value += 0.1; break;
  }

  return value;
}

export function isFlush(cards) {
  const firstSuit = cards[0].suit;
  return cards.every(card => card.suit === firstSuit);
}

export function isFourOfAKind(cards) {
  const values = cards.map(c => c.value);
  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);

  return Object.values(counts).includes(4);
}

export function isFullHouse(cards) {
  const values = cards.map(c => c.value);
  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);

  const hasThree = Object.values(counts).includes(3);
  const hasTwo = Object.values(counts).includes(2);

  return hasThree && hasTwo;
}

// Helper functions for hand validation
export function isStraight(cards) {
  // Convert card values to numeric values for comparison
  const values = cards.map(card => {
    switch (card.value) {
      case 'A': return 14;
      case 'K': return 13;
      case 'Q': return 12;
      case 'J': return 11;
      default: return parseInt(card.value);
    }
  }).sort((a, b) => a - b);

  // Check if it's a sequence
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) {
      return false;
    }
  }

  return true;
}

// Helper to validate if a set of cards forms a valid Big 2 hand
export function validateHand(cards) {
  if (!cards || cards.length === 0) {
    return { valid: false, message: "No cards provided" };
  }

  // Single card - always valid
  if (cards.length === 1) {
    return { valid: true, type: "single", value: getCardValue(cards[0]) };
  }

  // Pair (two cards of the same value)
  if (cards.length === 2) {
    if (cards[0].value === cards[1].value) {
      // Find the higher card in the pair
      const value = Math.max(
        getCardValue(cards[0]),
        getCardValue(cards[1])
      );
      return { valid: true, type: "pair", value };
    }
    return { valid: false, message: "Not a valid pair" };
  }

  // Three of a kind
  if (cards.length === 3) {
    if (cards[0].value === cards[1].value && cards[1].value === cards[2].value) {
      // Find the highest card
      const value = Math.max(
        getCardValue(cards[0]),
        getCardValue(cards[1]),
        getCardValue(cards[2])
      );
      return { valid: true, type: "triple", value };
    }
    return { valid: false, message: "Not a valid three of a kind" };
  }

  // Hands with 5 cards
  if (cards.length === 5) {
    // Sort cards by value for easier processing
    const sortedCards = [...cards].sort((a, b) =>
      getCardValue(a) - getCardValue(b)
    );

    // Check for straight
    const straightResult = isStraight(sortedCards);

    // Check for flush
    const flushResult = isFlush(sortedCards);

    // Check for four of a kind
    const fourOfAKindResult = isFourOfAKind(sortedCards);

    // Check for full house
    const fullHouseResult = isFullHouse(sortedCards);

    // Royal Flush (straight flush with A high)
    if (straightResult && flushResult && sortedCards[4].value === 'A') {
      return {
        valid: true,
        type: "royal_flush",
        value: getCardValue(sortedCards[4]) // Ace value
      };
    }

    // Straight Flush
    if (straightResult && flushResult) {
      return {
        valid: true,
        type: "straight_flush",
        value: getCardValue(sortedCards[4]) // Highest card
      };
    }

    // Four of a Kind + 1
    if (fourOfAKindResult) {
      // Value is based on the four matching cards, not the kicker
      const fourValue = sortedCards[1].value; // Safe position for the four
      return {
        valid: true,
        type: "four_of_a_kind",
        value: getCardValue(sortedCards.find(c => c.value === fourValue))
      };
    }

    // Full House
    if (fullHouseResult) {
      // Value is based on the three matching cards
      const values = sortedCards.map(c => c.value);
      const counts = {};
      values.forEach(v => counts[v] = (counts[v] || 0) + 1);

      let threeValue;
      for (const value in counts) {
        if (counts[value] === 3) {
          threeValue = value;
          break;
        }
      }

      return {
        valid: true,
        type: "full_house",
        value: getCardValue(sortedCards.find(c => c.value === threeValue))
      };
    }

    // Flush
    if (flushResult) {
      return {
        valid: true,
        type: "flush",
        value: getCardValue(sortedCards[4]) // Highest card
      };
    }

    // Straight
    if (straightResult) {
      return {
        valid: true,
        type: "straight",
        value: getCardValue(sortedCards[4]) // Highest card
      };
    }

    return { valid: false, message: "Not a valid 5-card hand" };
  }

  return { valid: false, message: "Invalid number of cards" };
}

export function validatePlay(playedCards, cards) {
  // First validate if the cards form a valid hand
  const handValid = validateHand(cards);
  if (!handValid.valid) {
    return handValid;
  }

  // If this is the first play or the play pile is empty
  if (!playedCards || playedCards.length === 0) {
    return handValid;
  }

  // Validate the last played hand
  const lastPlayedValid = validateHand(playedCards);

  // Simple hands (single, pair, triple) must match types
  if (cards.length < 5) {
    // Must be the same type
    if (handValid.type !== lastPlayedValid.type) {
      return { valid: false, message: "For 1-3 card plays, you must play the same type of hand" };
    }

    // Must be higher value
    if (handValid.value <= lastPlayedValid.value) {
      return { valid: false, message: "You must play a higher hand" };
    }
  } else if (cards.length === 5) {
    // If previous play was also a 5-card hand
    if (playedCards.length === 5) {
      // Get hierarchy rank for both hands
      const currentRank = getHandRank(handValid.type);
      const previousRank = getHandRank(lastPlayedValid.type);

      // If current hand is lower ranked than previous
      if (currentRank < previousRank) {
        return { valid: false, message: "You must play a higher ranked hand type" };
      }

      // If same hand type, compare values
      if (currentRank === previousRank && handValid.value <= lastPlayedValid.value) {
        return { valid: false, message: "You must play a higher value of the same hand type" };
      }
    }
    // If previous play wasn't a 5-card hand, it's not valid
    else {
      return { valid: false, message: "Can only play 5-card hands over other 5-card hands" };
    }
  }

  return handValid;
}

// Helper method to determine hand ranking
export function getHandRank(handType) {
  // Define the ranking of 5-card hands (higher number = stronger hand)
  const rankings = {
    "straight": 1,
    "flush": 2,
    "full_house": 3,
    "four_of_a_kind": 4,
    "straight_flush": 5,
    "royal_flush": 6
  };

  return rankings[handType] || 0;
}

export function sortPlaysByStrength(plays) {
  return [...plays].sort((a, b) => {
    // First compare by number of cards (1 card < 2 cards < 3 cards < 5 cards)
    if (a.length !== b.length) {
      return a.length - b.length;
    }
    
    // For plays with the same number of cards, compare by hand type and value
    const handA = validateHand(a);
    const handB = validateHand(b);
    
    // For 5-card plays, compare by hand type rank first
    if (a.length === 5) {
      const rankA = getHandRank(handA.type);
      const rankB = getHandRank(handB.type);
      
      if (rankA !== rankB) {
        return rankA - rankB; // Lower rank first
      }
    }
    
    // Compare by the hand value
    return handA.value - handB.value; // Lower value first
  });
}

export function calculateAIMove(cards, lastPlayedCards) {
  const possiblePlays = calculatePossiblePlays(cards, lastPlayedCards);
  
  if (possiblePlays.length > 0) {
    const sortedPlays = sortPlaysByStrength(possiblePlays);
    
    const formattedPlays = sortedPlays.map(play => {
      return play.map(card => `${card.value}${card.suit}`).join(',');
    }).join(' | ');
    
    console.log('Sorted plays (weakest to strongest):', formattedPlays);
    
    return {
      action: 'play',
      cards: sortedPlays[0] // Choose the weakest valid play
    };
  }

  return {
    action: 'pass'
  };
}

export function calculatePossiblePlays(cards, lastPlayedHand) {
  // If no last played hand, any valid hand can be played
  if (!lastPlayedHand || lastPlayedHand.length === 0) {
    return calculateAllValidHands(cards);
  }
  
  // Validate the last played hand to get its type and value
  const lastHandResult = validateHand(lastPlayedHand);
  if (!lastHandResult.valid) {
    return []; // Something's wrong with the last played hand
  }
  
  const possiblePlays = [];
  
  // Handle singles (1 card)
  if (lastHandResult.type === "single") {
    // Find all singles higher than the last played single
    cards.forEach(card => {
      const cardValue = getCardValue(card);
      if (cardValue > lastHandResult.value) {
        possiblePlays.push([card]);
      }
    });
  }
  
  // Handle pairs (2 cards)
  else if (lastHandResult.type === "pair") {
    // Group cards by value
    const cardsByValue = groupCardsByValue(cards);
    
    // Find all pairs higher than the last played pair
    Object.entries(cardsByValue).forEach(([value, cards]) => {
      if (cards.length >= 2) {
        // Calculate the value of the highest card in the pair
        const pairCards = cards.slice(0, 2);
        const pairValue = Math.max(...pairCards.map(c => getCardValue(c)));
        
        if (pairValue > lastHandResult.value) {
          possiblePlays.push(pairCards);
        }
      }
    });
  }
  
  // Handle triples (3 cards)
  else if (lastHandResult.type === "triple") {
    // Group cards by value
    const cardsByValue = groupCardsByValue(cards);
    
    // Find all triples higher than the last played triple
    Object.entries(cardsByValue).forEach(([value, cards]) => {
      if (cards.length >= 3) {
        // Calculate the value of the highest card in the triple
        const tripleCards = cards.slice(0, 3);
        const tripleValue = Math.max(...tripleCards.map(c => getCardValue(c)));
        
        if (tripleValue > lastHandResult.value) {
          possiblePlays.push(tripleCards);
        }
      }
    });
  }
  
  // Handle 5-card hands
  else if (lastPlayedHand.length === 5) {
    // Get all possible 5-card combinations
    const combinations = getAllFiveCardCombinations(cards);
    
    // Filter for valid hands that can beat the last played hand
    for (const combo of combinations) {
      const handResult = validateHand(combo);
      
      if (handResult.valid) {
        // Get rank of both hands
        const comboRank = getHandRank(handResult.type);
        const lastHandRank = getHandRank(lastHandResult.type);
        
        // Higher ranked hand type
        if (comboRank > lastHandRank) {
          possiblePlays.push(combo);
        }
        // Same hand type, but higher value
        else if (comboRank === lastHandRank && handResult.value > lastHandResult.value) {
          possiblePlays.push(combo);
        }
      }
    }
  }
  
  return possiblePlays;
}

// Helper method to group cards by their value
export function groupCardsByValue(cards) {
  const groups = {};
  
  cards.forEach(card => {
    if (!groups[card.value]) {
      groups[card.value] = [];
    }
    groups[card.value].push(card);
  });
  
  return groups;
}

// Generate all possible 5-card combinations from the hand
export function getAllFiveCardCombinations(cards) {
  const result = [];
  
  // Skip if we don't have at least 5 cards
  if (cards.length < 5) {
    return result;
  }
  
  // Recursive helper to generate combinations
  const generateCombos = (start, currentCombo) => {
    if (currentCombo.length === 5) {
      result.push([...currentCombo]);
      return;
    }
    
    for (let i = start; i < cards.length; i++) {
      currentCombo.push(cards[i]);
      generateCombos(i + 1, currentCombo);
      currentCombo.pop();
    }
  };
  
  generateCombos(0, []);
  return result;
}

// When no last played hand, calculate all valid hands possible
export function calculateAllValidHands(cards) {
  const possiblePlays = [];
  
  // Add all singles
  cards.forEach(card => {
    possiblePlays.push([card]);
  });
  
  // Add all pairs
  const cardsByValue = groupCardsByValue(cards);
  Object.values(cardsByValue).forEach(valueCards => {
    if (valueCards.length >= 2) {
      // Generate all possible pairs with these cards
      for (let i = 0; i < valueCards.length - 1; i++) {
        for (let j = i + 1; j < valueCards.length; j++) {
          possiblePlays.push([valueCards[i], valueCards[j]]);
        }
      }
    }
  });
  
  // Add all triples
  Object.values(cardsByValue).forEach(valueCards => {
    if (valueCards.length >= 3) {
      // Generate all possible triples with these cards
      for (let i = 0; i < valueCards.length - 2; i++) {
        for (let j = i + 1; j < valueCards.length - 1; j++) {
          for (let k = j + 1; k < valueCards.length; k++) {
            possiblePlays.push([valueCards[i], valueCards[j], valueCards[k]]);
          }
        }
      }
    }
  });
  
  // Add all valid 5-card hands
  const fiveCardCombos = getAllFiveCardCombinations(cards);
  fiveCardCombos.forEach(combo => {
    const handResult = validateHand(combo);
    if (handResult.valid) {
      possiblePlays.push(combo);
    }
  });
  
  return possiblePlays;
}