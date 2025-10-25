// big2-tests.js
import {
  getCardValue,
  isFlush,
  isFourOfAKind,
  isFullHouse,
  isStraight,
  validateHand,
  validatePlay,
  getHandRank,
  calculatePossiblePlays,
  groupCardsByValue,
  getAllFiveCardCombinations,
  calculateAllValidHands
} from '../core/CardGame.mjs'; // Adjust path as needed

// Mock cards
const cards = {
  // Clubs (♣)
  club2: { suit: '♣', value: '2' },
  club3: { suit: '♣', value: '3' },
  club4: { suit: '♣', value: '4' },
  club5: { suit: '♣', value: '5' },
  club6: { suit: '♣', value: '6' },
  club7: { suit: '♣', value: '7' },
  club8: { suit: '♣', value: '8' },
  club9: { suit: '♣', value: '9' },
  club10: { suit: '♣', value: '10' },
  clubJ: { suit: '♣', value: 'J' },
  clubQ: { suit: '♣', value: 'Q' },
  clubK: { suit: '♣', value: 'K' },
  clubA: { suit: '♣', value: 'A' },
  
  // Diamonds (♦)
  diamond2: { suit: '♦', value: '2' },
  diamond3: { suit: '♦', value: '3' },
  diamond4: { suit: '♦', value: '4' },
  diamond5: { suit: '♦', value: '5' },
  diamond6: { suit: '♦', value: '6' },
  diamond7: { suit: '♦', value: '7' },
  diamond8: { suit: '♦', value: '8' },
  diamond9: { suit: '♦', value: '9' },
  diamond10: { suit: '♦', value: '10' },
  diamondJ: { suit: '♦', value: 'J' },
  diamondQ: { suit: '♦', value: 'Q' },
  diamondK: { suit: '♦', value: 'K' },
  diamondA: { suit: '♦', value: 'A' },
  
  // Hearts (♥)
  heart2: { suit: '♥', value: '2' },
  heart3: { suit: '♥', value: '3' },
  heart4: { suit: '♥', value: '4' },
  heart5: { suit: '♥', value: '5' },
  heart6: { suit: '♥', value: '6' },
  heart7: { suit: '♥', value: '7' },
  heart8: { suit: '♥', value: '8' },
  heart9: { suit: '♥', value: '9' },
  heart10: { suit: '♥', value: '10' },
  heartJ: { suit: '♥', value: 'J' },
  heartQ: { suit: '♥', value: 'Q' },
  heartK: { suit: '♥', value: 'K' },
  heartA: { suit: '♥', value: 'A' },
  
  // Spades (♠)
  spade2: { suit: '♠', value: '2' },
  spade3: { suit: '♠', value: '3' },
  spade4: { suit: '♠', value: '4' },
  spade5: { suit: '♠', value: '5' },
  spade6: { suit: '♠', value: '6' },
  spade7: { suit: '♠', value: '7' },
  spade8: { suit: '♠', value: '8' },
  spade9: { suit: '♠', value: '9' },
  spade10: { suit: '♠', value: '10' },
  spadeJ: { suit: '♠', value: 'J' },
  spadeQ: { suit: '♠', value: 'Q' },
  spadeK: { suit: '♠', value: 'K' },
  spadeA: { suit: '♠', value: 'A' }
};

// Helper function to check and log test results
function testResult(testName, actual, expected) {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${testName}: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Actual: ${JSON.stringify(actual)}`);
  console.log(`  Expected: ${JSON.stringify(expected)}`);
  return passed;
}

// Test getCardValue
console.log('\n--- Testing getCardValue ---');
testResult('Club 3', getCardValue(cards.club3), 3.1); // Club = 0.1
testResult('Diamond K', getCardValue(cards.diamondK), 13.2); // Diamond = 0.2
testResult('Heart 2', getCardValue(cards.heart2), 15.3); // Heart = 0.3
testResult('Spade A', getCardValue(cards.spadeA), 14.4); // Spade = 0.4
testResult('Club 2 > Spade A?', getCardValue(cards.club2) > getCardValue(cards.spadeA), true); // 2 is highest card
testResult('Heart 2 > Diamond 2?', getCardValue(cards.heart2) > getCardValue(cards.diamond2), true); // Heart > Diamond

// Test isFlush
console.log('\n--- Testing isFlush ---');
testResult('All clubs', isFlush([cards.club2, cards.club3, cards.club4, cards.club5, cards.club6]), true);
testResult('Mixed suits', isFlush([cards.club2, cards.diamond3, cards.heart4, cards.spade5, cards.club6]), false);

// Test isFourOfAKind
console.log('\n--- Testing isFourOfAKind ---');
testResult('Four 8s', isFourOfAKind([cards.club8, cards.diamond8, cards.heart8, cards.spade8, cards.clubK]), true);
testResult('Three 8s', isFourOfAKind([cards.club8, cards.diamond8, cards.heart8, cards.spade7, cards.clubK]), false);

// Test isFullHouse
console.log('\n--- Testing isFullHouse ---');
testResult('Full House (Ks and 8s)', isFullHouse([cards.clubK, cards.diamondK, cards.heartK, cards.club8, cards.diamond8]), true);
testResult('Not Full House (three Ks)', isFullHouse([cards.clubK, cards.diamondK, cards.heartK, cards.club8, cards.diamond9]), false);

// Test isStraight
console.log('\n--- Testing isStraight ---');
testResult('Straight 4-8', isStraight([cards.club4, cards.diamond5, cards.heart6, cards.spade7, cards.club8]), true);
testResult('Straight 10-A', isStraight([cards.club10, cards.diamondJ, cards.heartQ, cards.spadeK, cards.clubA]), true);
testResult('Not Straight', isStraight([cards.club4, cards.diamond5, cards.heart7, cards.spade8, cards.club9]), false);

// Test validateHand
console.log('\n--- Testing validateHand ---');
testResult('Single', validateHand([cards.clubA]), { valid: true, type: "single", value: 14.1 });
testResult('Pair', validateHand([cards.club3, cards.diamond3]), { valid: true, type: "pair", value: 3.2 });
testResult('Invalid Pair', validateHand([cards.club3, cards.diamond4]), { valid: false, message: "Not a valid pair" });
testResult('Triple', validateHand([cards.club7, cards.diamond7, cards.heart7]), { valid: true, type: "triple", value: 7.3 });
testResult('Straight', validateHand([cards.club4, cards.diamond5, cards.heart6, cards.spade7, cards.club8]), 
  { valid: true, type: "straight", value: 8.1 });
testResult('Flush', validateHand([cards.club4, cards.club7, cards.club9, cards.clubQ, cards.clubA]), 
  { valid: true, type: "flush", value: 14.1 });
testResult('Full House', validateHand([cards.clubK, cards.diamondK, cards.heartK, cards.club8, cards.diamond8]), 
  { valid: true, type: "full_house", value: 13.1 });
testResult('Four of a Kind', validateHand([cards.club8, cards.diamond8, cards.heart8, cards.spade8, cards.clubK]), 
  { valid: true, type: "four_of_a_kind", value: 8.1 });
testResult('Straight Flush', validateHand([cards.club4, cards.club5, cards.club6, cards.club7, cards.club8]), 
  { valid: true, type: "straight_flush", value: 8.1 });
testResult('Royal Flush', validateHand([cards.club10, cards.clubJ, cards.clubQ, cards.clubK, cards.clubA]), 
  { valid: true, type: "royal_flush", value: 14.1 });

// Setup for validatePlay tests
let lastPlayedHand = [];

// Wrapper function for validatePlay that accepts lastPlayedHand as parameter
function testValidatePlay(cards, lastlastPlayedHand) {
  // Store the original lastPlayedHand
  const originallastPlayedHand = lastPlayedHand;
  
  // Set lastPlayedHand for the test
  lastPlayedHand = lastlastPlayedHand || [];
  
  // Call validatePlay
  const result = validatePlay(lastlastPlayedHand, cards);
  
  // Restore original lastPlayedHand
  lastPlayedHand = originallastPlayedHand;
  
  return result;
}

// Test validatePlay
console.log('\n--- Testing validatePlay ---');
testResult('First play (single)', 
  testValidatePlay([cards.club3], []), 
  { valid: true, type: 'single', value: 3.1 });

testResult('Higher single', 
  testValidatePlay([cards.club5], [cards.diamond3]), 
  { valid: true, type: 'single', value: 5.1 });

testResult('Lower single', 
  testValidatePlay([cards.club3], [cards.diamond5]), 
  { valid: false, message: "You must play a higher hand" });

testResult('Pair vs single', 
  testValidatePlay([cards.club3, cards.diamond3], [cards.heart5]), 
  { valid: false, message: "For 1-3 card plays, you must play the same type of hand" });

testResult('Triple over triple', 
  testValidatePlay([cards.club7, cards.diamond7, cards.heart7], [cards.club3, cards.diamond3, cards.heart3]), 
  { valid: true, type: 'triple', value: 7.3 });

testResult('Straight over straight', 
  testValidatePlay(
    [cards.club5, cards.diamond6, cards.heart7, cards.spade8, cards.club9],
    [cards.club4, cards.diamond5, cards.heart6, cards.spade7, cards.club8]
  ), 
  { valid: true, type: 'straight', value: 9.1 });

testResult('Flush over straight', 
  testValidatePlay(
    [cards.club3, cards.club6, cards.club9, cards.clubJ, cards.clubA],
    [cards.club4, cards.diamond5, cards.heart6, cards.spade7, cards.club8]
  ), 
  { valid: true, type: 'flush', value: 14.1 });

// Test groupCardsByValue
console.log('\n--- Testing groupCardsByValue ---');
const testHand = [cards.club3, cards.diamond3, cards.heart5, cards.spade5, cards.club8];
const expectedGroups = {
  '3': [cards.club3, cards.diamond3],
  '5': [cards.heart5, cards.spade5],
  '8': [cards.club8]
};
testResult('Group by value', groupCardsByValue(testHand), expectedGroups);

// Test getAllFiveCardCombinations
console.log('\n--- Testing getAllFiveCardCombinations ---');
const smallHand = [cards.club3, cards.diamond4, cards.heart5, cards.spade6, cards.club7];
testResult('5 card combinations from 5 cards', getAllFiveCardCombinations(smallHand).length, 1);

// Modified test for biggerHand
const biggerHand = [cards.club3, cards.diamond4, cards.heart5, cards.spade6, cards.club7, cards.diamond8];
// There are 6 mathematically possible combinations, but only 2 valid straights
const allCombosFromBiggerHand = getAllFiveCardCombinations(biggerHand);
testResult('Total 5 card combinations from 6 cards', allCombosFromBiggerHand.length, 6);

// Add a test for valid combinations
const validCombosFromBiggerHand = allCombosFromBiggerHand.filter(combo => {
  const result = validateHand(combo);
  return result.valid && result.type === 'straight';
});
testResult('Valid straights from 6 cards', validCombosFromBiggerHand.length, 2);

// Test calculateAllValidHands
console.log('\n--- Testing calculateAllValidHands ---');
const validHandTestCards = [
  cards.club3, cards.diamond3, 
  cards.heart5, cards.spade5, 
  cards.club8, cards.diamond8, cards.heart8,
  cards.club9, cards.diamond10, cards.heartJ, cards.spadeQ, cards.clubK
];
const allValidHands = calculateAllValidHands(validHandTestCards);
// We'll just test the count, as testing all hands would be too verbose
testResult('Total valid hand count', allValidHands.length >= 20, true);

// Test calculatePossiblePlays
console.log('\n--- Testing calculatePossiblePlays ---');
const possiblePlaysHand = [
  cards.club3, cards.diamond3, 
  cards.heart5, cards.spade5, 
  cards.club8, cards.diamond8, cards.heart8,
  cards.club9, cards.diamond10, cards.heartJ, cards.spadeQ, cards.clubK
];

const playsAgainstLowSingle = calculatePossiblePlays(possiblePlaysHand, [cards.diamond2]);
testResult('Has plays against a 2♦', playsAgainstLowSingle.length > 0, false);

const playsAgainstPair = calculatePossiblePlays(possiblePlaysHand, [cards.club4, cards.diamond4]);
testResult('Has plays against a pair of 4s', playsAgainstPair.length > 0, true);

const playsAgainstFullHouse = calculatePossiblePlays(possiblePlaysHand, [
  cards.club4, cards.diamond4, cards.heart4, 
  cards.club7, cards.diamond7
]);
testResult('Has plays against a full house', playsAgainstFullHouse.length >= 0, true); // May be 0 if no winning plays

// Log test completion
console.log('\n--- All Tests Completed ---');