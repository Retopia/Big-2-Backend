import assert from "node:assert/strict";
import { decideMove } from "../core/StandardAIStrategy.mjs";

function card(value, suit) {
  return { value, suit };
}

function makeGameState({
  aiHandSize,
  opponentHandSizes,
  moveHistory = [],
  round = 2,
  currentPlayerName = "AI",
}) {
  const players = [{ name: "AI", handSize: aiHandSize, isAI: true }];
  opponentHandSizes.forEach((handSize, index) => {
    players.push({
      name: `P${index + 1}`,
      handSize,
      isAI: false,
    });
  });

  return {
    players,
    currentPlayerName,
    round,
    moveHistory,
    lowestCardValue: null,
  };
}

function pickRank(playCard) {
  switch (playCard.value) {
    case "2":
      return 15;
    case "A":
      return 14;
    case "K":
      return 13;
    case "Q":
      return 12;
    case "J":
      return 11;
    default:
      return Number.parseInt(playCard.value, 10);
  }
}

function runStandardAIStrategyTests() {
  // Test 1: With no pressure, AI should avoid breaking pair if a singleton can beat.
  const safeHand = [
    card("8", "C"),
    card("8", "D"),
    card("9", "E"),
    card("K", "F"),
    card("2", "G"),
    card("4", "H"),
    card("5", "I"),
  ];
  const safeResult = decideMove(
    safeHand,
    [card("7", "J")],
    makeGameState({
      aiHandSize: safeHand.length,
      opponentHandSizes: [9, 10],
      moveHistory: [{ name: "P1", handPlayed: [card("7", "J")] }],
    })
  );

  assert.equal(safeResult.action, "play");
  assert.equal(safeResult.cards.length, 1);
  assert.equal(safeResult.cards[0].value, "9");

  // Test 2: Under high pressure (opponent at 1 card), AI should play a stronger stopper.
  const pressureResult = decideMove(
    safeHand,
    [card("7", "J")],
    makeGameState({
      aiHandSize: safeHand.length,
      opponentHandSizes: [1, 9],
      moveHistory: [{ name: "P1", handPlayed: [card("7", "J")] }],
      round: 6,
    })
  );

  assert.equal(pressureResult.action, "play");
  assert.equal(pressureResult.cards.length, 1);
  assert.ok(
    pickRank(pressureResult.cards[0]) >= 13,
    "Expected AI to use a high stopper card under pressure."
  );

  // Test 3: Endgame should prioritize dumping multiple cards when leading.
  const endgameHand = [
    card("9", "A"),
    card("9", "B"),
    card("J", "C"),
    card("A", "D"),
  ];
  const endgameResult = decideMove(
    endgameHand,
    [],
    makeGameState({
      aiHandSize: endgameHand.length,
      opponentHandSizes: [6],
      moveHistory: [{ name: "P1", handPlayed: [card("6", "Z")] }],
      round: 4,
    })
  );

  assert.equal(endgameResult.action, "play");
  assert.equal(endgameResult.cards.length, 2);
  assert.ok(endgameResult.cards.every((playedCard) => playedCard.value === "9"));

  // Test 4: No legal play should pass.
  const noMoveHand = [card("3", "A"), card("5", "B"), card("7", "C")];
  const noMoveResult = decideMove(
    noMoveHand,
    [card("2", "X")],
    makeGameState({
      aiHandSize: noMoveHand.length,
      opponentHandSizes: [7],
      moveHistory: [{ name: "P1", handPlayed: [card("2", "X")] }],
      round: 3,
    })
  );

  assert.deepEqual(noMoveResult, { action: "pass" });

  // Test 5: When leading and safe, AI should prefer non-single if available.
  const leadHand = [
    card("4", "A"),
    card("4", "B"),
    card("7", "C"),
    card("9", "D"),
    card("J", "E"),
    card("K", "F"),
    card("2", "G"),
  ];
  const leadResult = decideMove(
    leadHand,
    [],
    makeGameState({
      aiHandSize: leadHand.length,
      opponentHandSizes: [9, 10],
      moveHistory: [{ name: "P1", handPlayed: [card("6", "Q")] }],
      round: 2,
    })
  );

  assert.equal(leadResult.action, "play");
  assert.equal(leadResult.cards.length, 2);
  assert.ok(leadResult.cards.every((playedCard) => playedCard.value === "4"));
}

runStandardAIStrategyTests();
console.log("standardAIStrategy tests passed");
