import * as CardGame from "./CardGame.mjs";

const DANGER_LEVEL = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

const DECK_SUITS = ["♥", "♦", "♣", "♠"];
const DECK_VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function cardKey(card) {
  return `${card.value}${card.suit}`;
}

/**
 * Card counting: derive which cards are still unseen (i.e. could be in an
 * opponent's hand) from our own hand plus everything in the move history. Used
 * to relax control-card hoarding once the cards that could beat them are gone.
 *
 * Note: if cards use non-standard suits (e.g. in unit tests), nothing matches the
 * real deck, so everything reads as "unseen" and the threat factors stay at 1 —
 * i.e. card counting becomes a no-op and the base heuristic is unchanged.
 */
function buildCardKnowledge(aiHand, gameState) {
  const seen = new Set();
  (aiHand || []).forEach((card) => seen.add(cardKey(card)));
  (gameState?.moveHistory || []).forEach((move) => {
    (move?.handPlayed || []).forEach((card) => seen.add(cardKey(card)));
  });

  let unseenTwos = 0;
  let unseenAces = 0;
  for (const suit of DECK_SUITS) {
    for (const value of DECK_VALUES) {
      if (seen.has(`${value}${suit}`)) continue;
      if (value === "2") unseenTwos += 1;
      else if (value === "A") unseenAces += 1;
    }
  }

  return { unseenTwos, unseenAces };
}

export function decideMove(aiHand, lastPlayedHand, gameState = null) {
  let possiblePlays = CardGame.calculatePossiblePlays(
    aiHand,
    lastPlayedHand,
    gameState?.moveHistory || [],
    gameState?.lowestCardValue
  );
  possiblePlays = CardGame.sortPlaysByStrength(possiblePlays);

  if (possiblePlays.length === 0) {
    console.log("Standard AI: No valid plays - passing");
    return { action: "pass" };
  }

  const context = buildContext(aiHand, lastPlayedHand, gameState, possiblePlays);
  const scoredPlays = possiblePlays.map((play, index) => ({
    play,
    score: scorePlay(play, index, aiHand, context),
    index,
  }));

  scoredPlays.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return tieBreakPlays(a.play, b.play, context);
  });

  const selectedPlay = scoredPlays[0].play;

  // Voluntary pass: when responding (passing is legal), don't burn premium cards
  // or break up combos just to win a trick we don't need to. Only applies to the
  // CHEAPEST available beat — if even that is too costly and there's no pressure,
  // conserve and pass.
  if (!context.isFirstPlay && shouldPassInsteadOf(selectedPlay, aiHand, context)) {
    console.log(
      `Standard AI: Pass (conserving — best beat ${formatCards(selectedPlay)} too costly)`
    );
    return { action: "pass" };
  }

  console.log(
    `Standard AI: Play ${formatCards(selectedPlay)} [${getHandTypeString(selectedPlay)}] score=${scoredPlays[0].score.toFixed(2)}`
  );

  return {
    action: "play",
    cards: selectedPlay,
  };
}

/**
 * Decide whether to pass rather than make `play` (the cheapest legal beat).
 * Returns true only when the play spends premium resources with no good reason.
 */
function shouldPassInsteadOf(play, aiHand, context) {
  // Never pass up a move that wins the game.
  if (aiHand.length - play.length === 0) return false;
  // Someone is about to win — we must contest the trick.
  if (context.dangerLevel === DANGER_LEVEL.HIGH) return false;
  // In the endgame we want to shed; take the trick.
  if (context.isEndgame) return false;

  const handInfo = CardGame.validateHand(play);
  const twosSpent = play.filter((card) => getCardRank(card) === 15).length;
  const acesSpent = play.filter((card) => getCardRank(card) === 14).length;
  const isStrongBomb = play.length === 5 && CardGame.getHandRank(handInfo.type) >= 4;

  const groupImpact = analyzeGroupImpact(aiHand, play, context);
  const breaksStructure =
    groupImpact.partialBreakPenalty +
      groupImpact.breakingPairPenalty +
      groupImpact.breakingTriplePenalty +
      groupImpact.breakingQuadPenalty >
    0;

  // "Expensive" = burns a 2, a strong bomb, a lone Ace, or breaks an existing combo.
  const expensive =
    twosSpent > 0 ||
    isStrongBomb ||
    (acesSpent > 0 && play.length === 1) ||
    breaksStructure;

  if (!expensive) return false;

  // Under medium pressure we still contest unless the cost is severe (a 2 or bomb).
  if (context.dangerLevel === DANGER_LEVEL.MEDIUM) {
    return twosSpent > 0 || isStrongBomb;
  }

  // Low danger + expensive → conserve.
  return true;
}

function buildContext(aiHand, lastPlayedHand, gameState, possiblePlays) {
  const opponentInfo = extractOpponentInfo(gameState);
  const dangerLevel = getDangerLevel(opponentInfo);
  const isFirstPlay = !lastPlayedHand || lastPlayedHand.length === 0;
  const isEndgame = aiHand.length <= 5;
  const lastPlayInfo = !isFirstPlay ? CardGame.validateHand(lastPlayedHand) : null;
  const leadOptions = summarizeLeadOptions(possiblePlays);
  const knowledge = buildCardKnowledge(aiHand, gameState);

  return {
    handSize: aiHand.length,
    round: gameState?.round || 1,
    isFirstPlay,
    isEndgame,
    dangerLevel,
    opponentInfo,
    lastPlayInfo,
    leadOptions,
    knowledge,
  };
}

function scorePlay(play, playIndex, aiHand, context) {
  const handInfo = CardGame.validateHand(play);
  const playPower = getPlayPower(handInfo);
  const groupImpact = analyzeGroupImpact(aiHand, play, context);
  const remainingCards = removeCardsFromHand(aiHand, play);
  const remainingSummary = summarizeRemainingHand(remainingCards);

  const highCardsSpent = play.filter((card) => getCardRank(card) >= 14).length;
  const twosSpent = play.filter((card) => getCardRank(card) === 15).length;
  const acesSpent = highCardsSpent - twosSpent;
  const rankSpendPenalty = calculateRankSpendPenalty(play, context);

  let score = 0;

  // Preserve structure when possible (avoid breaking pairs/triples for singles).
  score += groupImpact.partialBreakPenalty;
  score += groupImpact.breakingPairPenalty;
  score += groupImpact.breakingTriplePenalty;
  score += groupImpact.breakingQuadPenalty;
  score += groupImpact.breakingTwoPairPenalty;
  score -= groupImpact.clearedGroupReward;

  // Keep the post-play hand flexible.
  score += remainingSummary.singletonCount * 0.35;
  score += remainingSummary.highSingletonCount * 0.85;
  score += remainingSummary.lowSingletonCount * 0.2;
  score -= remainingSummary.pairCount * 0.25;
  score -= remainingSummary.tripleCount * 0.35;
  score -= remainingSummary.quadCount * 0.4;

  if (context.isEndgame) {
    // In endgame, shedding card count dominates.
    score -= play.length * 2.8;
    if (remainingCards.length === 0) score -= 100;
  } else if (context.isFirstPlay) {
    // Lead rounds: prefer shedding with multi-card plays so gameplay is less single-heavy.
    const handRank = CardGame.getHandRank(handInfo.type);
    const hasNonSingleLead =
      context.leadOptions.hasPair ||
      context.leadOptions.hasTriple ||
      context.leadOptions.hasFiveCard;

    if (hasNonSingleLead) {
      if (context.handSize >= 7 && context.dangerLevel === DANGER_LEVEL.LOW) {
        if (play.length === 1) score += 2.4;
        else if (play.length === 2) score -= 0.9;
        else if (play.length === 3) score -= 1.3;
        else if (play.length === 5) score -= 1.1;
      } else {
        if (play.length === 1) score += 1.0;
        else score -= 0.25;
      }
    }

    // Avoid burning premium 5-card bombs too early unless danger is high.
    if (play.length === 5 && handRank >= 4) {
      if (context.dangerLevel === DANGER_LEVEL.LOW && context.handSize > 6) {
        score += 2.8;
      } else if (context.dangerLevel === DANGER_LEVEL.MEDIUM) {
        score += 1.4;
      } else {
        score += 0.5;
      }
    }
  } else {
    // When responding, prefer minimal overkill unless there is pressure.
    const targetPower = getPlayPower(context.lastPlayInfo);
    const margin = Math.max(0, playPower - targetPower);
    const marginWeight =
      context.dangerLevel === DANGER_LEVEL.HIGH
        ? 0.06
        : context.dangerLevel === DANGER_LEVEL.MEDIUM
          ? 0.18
          : 0.42;
    score += margin * marginWeight;
  }

  // Preserve high control cards unless opponents are about to win.
  const baseAcePenalty =
    context.isEndgame
      ? 0.2
      : context.dangerLevel === DANGER_LEVEL.HIGH
        ? 0.7
        : context.dangerLevel === DANGER_LEVEL.MEDIUM
          ? 1.4
          : 2.0;
  const baseTwoPenalty =
    context.isEndgame
      ? 0.5
      : context.dangerLevel === DANGER_LEVEL.HIGH
        ? 1.1
        : context.dangerLevel === DANGER_LEVEL.MEDIUM
          ? 2.4
          : 3.8;

  // Card counting: an Ace single is only beaten by a 2, and a 2 only by a higher
  // 2. As those threats leave the deck, there's less reason to clutch ours — so
  // scale the hoarding penalty down (never up) by how many threats remain unseen.
  const aceThreatFactor = 0.35 + 0.65 * clamp01(context.knowledge.unseenTwos / 4);
  const twoThreatFactor = 0.35 + 0.65 * clamp01(context.knowledge.unseenTwos / 4);
  const acePenalty = baseAcePenalty * aceThreatFactor;
  const twoPenalty = baseTwoPenalty * twoThreatFactor;
  score += acesSpent * acePenalty + twosSpent * twoPenalty;
  score += rankSpendPenalty;

  // Under danger, bias toward stronger and larger plays to block fast finishes.
  if (context.dangerLevel === DANGER_LEVEL.HIGH) {
    score -= play.length * 1.0;
    score -= playPower * 0.22;
  } else if (context.dangerLevel === DANGER_LEVEL.MEDIUM) {
    score -= play.length * 0.4;
    score -= playPower * 0.07;
  }

  // Slight preference to weaker sorted options as a deterministic final nudge.
  score += playIndex * 0.001;

  return score;
}

function tieBreakPlays(playA, playB, context) {
  const handA = CardGame.validateHand(playA);
  const handB = CardGame.validateHand(playB);
  const powerA = getPlayPower(handA);
  const powerB = getPlayPower(handB);

  if (context.isEndgame || context.dangerLevel !== DANGER_LEVEL.LOW) {
    if (playA.length !== playB.length) return playB.length - playA.length;
    if (powerA !== powerB) return powerB - powerA;
  } else {
    if (playA.length !== playB.length) return playA.length - playB.length;
    if (powerA !== powerB) return powerA - powerB;
  }

  return 0;
}

function analyzeGroupImpact(aiHand, play, context) {
  const handGroups = CardGame.groupCardsByValue(aiHand);
  const playGroups = CardGame.groupCardsByValue(play);

  let partialBreaks = 0;
  let breakingPairs = 0;
  let breakingTriples = 0;
  let breakingQuads = 0;
  let breakingTwoPair = 0;
  let clearedGroups = 0;

  Object.entries(playGroups).forEach(([value, cards]) => {
    const playedCount = cards.length;
    const originalCount = handGroups[value]?.length || 0;
    if (originalCount === 0) return;

    if (playedCount < originalCount) {
      partialBreaks += 1;

      if (originalCount === 2 && playedCount === 1) {
        breakingPairs += 1;
      } else if (originalCount === 3) {
        breakingTriples += 1;
      } else if (originalCount === 4) {
        breakingQuads += 1;
      }

      if (originalCount >= 3 && playedCount === 2) {
        breakingTwoPair += 1;
      }
    } else if (playedCount === originalCount && originalCount >= 2) {
      clearedGroups += 1;
    }
  });

  const structureFactor =
    context.dangerLevel === DANGER_LEVEL.HIGH
      ? 0.55
      : context.dangerLevel === DANGER_LEVEL.MEDIUM
        ? 0.75
        : 1;

  return {
    partialBreakPenalty: partialBreaks * 2.2 * structureFactor,
    breakingPairPenalty: breakingPairs * 1.2 * structureFactor,
    breakingTriplePenalty: breakingTriples * 1.9 * structureFactor,
    breakingQuadPenalty: breakingQuads * 2.6 * structureFactor,
    breakingTwoPairPenalty: breakingTwoPair * 0.8 * structureFactor,
    clearedGroupReward: clearedGroups * 0.75,
  };
}

function summarizeRemainingHand(cards) {
  const groups = CardGame.groupCardsByValue(cards);
  let singletonCount = 0;
  let lowSingletonCount = 0;
  let highSingletonCount = 0;
  let pairCount = 0;
  let tripleCount = 0;
  let quadCount = 0;

  Object.values(groups).forEach((group) => {
    const size = group.length;
    if (size === 1) {
      singletonCount += 1;
      const rank = getCardRank(group[0]);
      if (rank >= 13) highSingletonCount += 1;
      else if (rank <= 9) lowSingletonCount += 1;
    } else if (size === 2) {
      pairCount += 1;
    } else if (size === 3) {
      tripleCount += 1;
    } else if (size === 4) {
      quadCount += 1;
    }
  });

  return {
    singletonCount,
    lowSingletonCount,
    highSingletonCount,
    pairCount,
    tripleCount,
    quadCount,
  };
}

function getPlayPower(handInfo) {
  if (!handInfo?.valid) return 0;

  if (
    handInfo.type === "single" ||
    handInfo.type === "pair" ||
    handInfo.type === "triple"
  ) {
    return handInfo.value;
  }

  return CardGame.getHandRank(handInfo.type) * 20 + handInfo.value;
}

function summarizeLeadOptions(possiblePlays) {
  const sizes = new Set(possiblePlays.map((play) => play.length));
  return {
    hasPair: sizes.has(2),
    hasTriple: sizes.has(3),
    hasFiveCard: sizes.has(5),
  };
}

function removeCardsFromHand(hand, cardsToRemove) {
  const handCopy = [...hand];

  cardsToRemove.forEach((cardToRemove) => {
    const index = handCopy.findIndex(
      (card) =>
        card.suit === cardToRemove.suit && card.value === cardToRemove.value
    );

    if (index !== -1) {
      handCopy.splice(index, 1);
    }
  });

  return handCopy;
}

function extractOpponentInfo(gameState) {
  if (!gameState?.players) return null;

  const opponentInfo = {};

  gameState.players.forEach((player) => {
    if (player.name !== gameState.currentPlayerName) {
      const handSize = player.handSize || 0;
      opponentInfo[player.name] = {
        handSize,
        isCloseToWinning: handSize <= 3 && handSize > 0,
      };
    }
  });

  return Object.keys(opponentInfo).length > 0 ? opponentInfo : null;
}

function getDangerLevel(opponentInfo) {
  if (!opponentInfo) return DANGER_LEVEL.LOW;

  const activeOpponents = Object.values(opponentInfo)
    .map((opponent) => opponent.handSize)
    .filter((handSize) => handSize > 0);

  if (activeOpponents.length === 0) return DANGER_LEVEL.LOW;

  const minimumHandSize = Math.min(...activeOpponents);
  if (minimumHandSize <= 2) return DANGER_LEVEL.HIGH;
  if (minimumHandSize <= 4) return DANGER_LEVEL.MEDIUM;
  return DANGER_LEVEL.LOW;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function getCardRank(card) {
  switch (card.value) {
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
      return Number.parseInt(card.value, 10);
  }
}

function calculateRankSpendPenalty(play, context) {
  if (context.isEndgame) return 0;

  const rankWeight =
    context.dangerLevel === DANGER_LEVEL.HIGH
      ? 0
      : context.dangerLevel === DANGER_LEVEL.MEDIUM
        ? 0.45
        : 1;

  // Aces (14) and 2s (15) are handled separately by the ace/two hoarding penalty,
  // so this only nudges face cards (K/Q/J) and rewards spending low cards.
  let penalty = 0;
  play.forEach((card) => {
    const rank = getCardRank(card);
    if (rank === 13) penalty += 0.9 * rankWeight;        // King
    else if (rank === 11 || rank === 12) penalty += 0.35 * rankWeight; // Jack / Queen
    else if (rank <= 6) penalty -= 0.08;                 // low cards are cheap to spend
  });

  return penalty;
}

function formatCards(cards) {
  if (!cards || cards.length === 0) return "[]";
  return `[${cards.map((card) => `${card.value}${card.suit}`).join(", ")}]`;
}

function getHandTypeString(play) {
  if (!play || play.length === 0) return "invalid";

  const handResult = CardGame.validateHand(play);
  if (!handResult.valid) return "invalid";

  return handResult.type;
}
