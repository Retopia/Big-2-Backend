import assert from "node:assert/strict";
import { isStraight, validateHand, validatePlay } from "../core/CardGame.mjs";

function c(value, suit) {
  return { value, suit };
}

// --- Straights: lowest 3-4-5-6-7, highest J-Q-K-A-2, no wrap-around ---
assert.equal(
  isStraight([c("3", "♦"), c("4", "♣"), c("5", "♥"), c("6", "♠"), c("7", "♦")]),
  true,
  "3-4-5-6-7 is the lowest straight"
);
assert.equal(
  isStraight([c("10", "♦"), c("J", "♣"), c("Q", "♥"), c("K", "♠"), c("A", "♦")]),
  true,
  "10-J-Q-K-A is a straight"
);
assert.equal(
  isStraight([c("J", "♦"), c("Q", "♣"), c("K", "♥"), c("A", "♠"), c("2", "♦")]),
  true,
  "J-Q-K-A-2 is the highest straight"
);
assert.equal(
  isStraight([c("2", "♦"), c("3", "♣"), c("4", "♥"), c("5", "♠"), c("6", "♦")]),
  false,
  "2-3-4-5-6 is NOT a straight (wrap-around)"
);
assert.equal(
  isStraight([c("A", "♦"), c("2", "♣"), c("3", "♥"), c("4", "♠"), c("5", "♦")]),
  false,
  "A-2-3-4-5 is NOT a straight (wrap-around)"
);
assert.equal(
  isStraight([c("4", "♦"), c("5", "♣"), c("6", "♥"), c("7", "♠"), c("9", "♦")]),
  false,
  "a gap is not a straight"
);

// --- validateHand types ---
assert.equal(
  validateHand([c("3", "♦"), c("4", "♣"), c("5", "♥"), c("6", "♠"), c("7", "♦")]).type,
  "straight"
);
assert.equal(
  validateHand([c("2", "♦"), c("3", "♣"), c("4", "♥"), c("5", "♠"), c("6", "♦")]).valid,
  false,
  "2-3-4-5-6 off-suit is not a valid 5-card hand"
);

// No separate "royal flush": 10-J-Q-K-A of one suit is a straight flush, and a
// J-Q-K-A-2 straight flush outranks it.
const tenHighSF = validateHand([c("10", "♠"), c("J", "♠"), c("Q", "♠"), c("K", "♠"), c("A", "♠")]);
const twoHighSF = validateHand([c("J", "♠"), c("Q", "♠"), c("K", "♠"), c("A", "♠"), c("2", "♠")]);
assert.equal(tenHighSF.type, "straight_flush", "10-J-Q-K-A one suit is a straight flush (not royal)");
assert.equal(twoHighSF.type, "straight_flush");
assert.ok(twoHighSF.value > tenHighSF.value, "J-Q-K-A-2 straight flush ranks above 10-J-Q-K-A");

// --- validatePlay: the higher straight wins, the lower one can't beat it ---
const history = [{ name: "P1", handPlayed: [c("3", "♦")] }];
assert.equal(
  validatePlay(
    history,
    [c("10", "♦"), c("J", "♣"), c("Q", "♥"), c("K", "♠"), c("A", "♦")],
    [c("J", "♦"), c("Q", "♣"), c("K", "♥"), c("A", "♠"), c("2", "♦")],
    null
  ).valid,
  true,
  "J-Q-K-A-2 straight beats 10-J-Q-K-A"
);
assert.equal(
  validatePlay(
    history,
    [c("J", "♦"), c("Q", "♣"), c("K", "♥"), c("A", "♠"), c("2", "♦")],
    [c("10", "♦"), c("J", "♣"), c("Q", "♥"), c("K", "♠"), c("A", "♦")],
    null
  ).valid,
  false,
  "10-J-Q-K-A cannot beat J-Q-K-A-2"
);

console.log("cardRules tests passed");
