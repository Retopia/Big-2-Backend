import * as CardGame from "./CardGame.mjs";

const DANGER_LEVEL = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

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

  console.log(
    `Standard AI: Play ${formatCards(selectedPlay)} [${getHandTypeString(selectedPlay)}] score=${scoredPlays[0].score.toFixed(2)}`
  );

  return {
    action: "play",
    cards: selectedPlay,
  };
}

function buildContext(aiHand, lastPlayedHand, gameState, possiblePlays) {
  const opponentInfo = extractOpponentInfo(gameState);
  const dangerLevel = getDangerLevel(opponentInfo);
  const isFirstPlay = !lastPlayedHand || lastPlayedHand.length === 0;
  const isEndgame = aiHand.length <= 5;
  const lastPlayInfo = !isFirstPlay ? CardGame.validateHand(lastPlayedHand) : null;
  const leadOptions = summarizeLeadOptions(possiblePlays);

  return {
    handSize: aiHand.length,
    round: gameState?.round || 1,
    isFirstPlay,
    isEndgame,
    dangerLevel,
    opponentInfo,
    lastPlayInfo,
    leadOptions,
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
  const acePenalty =
    context.isEndgame
      ? 0.2
      : context.dangerLevel === DANGER_LEVEL.HIGH
        ? 0.7
        : context.dangerLevel === DANGER_LEVEL.MEDIUM
          ? 1.4
          : 2.0;
  const twoPenalty =
    context.isEndgame
      ? 0.5
      : context.dangerLevel === DANGER_LEVEL.HIGH
        ? 1.1
        : context.dangerLevel === DANGER_LEVEL.MEDIUM
          ? 2.4
          : 3.8;
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

  let penalty = 0;
  play.forEach((card) => {
    const rank = getCardRank(card);
    if (rank >= 13 && rank < 14) penalty += 0.9 * rankWeight;
    else if (rank >= 11 && rank < 13) penalty += 0.35 * rankWeight;
    else if (rank <= 6) penalty -= 0.08;
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
