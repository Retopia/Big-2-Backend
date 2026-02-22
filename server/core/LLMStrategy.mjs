import * as CardGame from './CardGame.mjs';
import * as StandardAIStrategy from './StandardAIStrategy.mjs';
import { getActiveLLMModel } from '../state.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'x-ai/grok-4-fast';
const SYSTEM_PROMPT = `You are a Big 2 card game assistant.

CRITICAL RULE: You can ONLY select cards from the "VALID PLAYS" list provided to you. Do not create your own combinations.

Basic Big 2 rules:
- Single cards: 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2
- Suits: ♦ < ♣ < ♥ < ♠ 
- Match card count (single vs single, pair vs pair)

Strategy: Generally prefer lower cards when leading, save high cards for later.

Reply with JSON only:
{"action":"pass","explanation":"reason"} or {"action":"play","cards":[exact cards from list],"explanation":"reason"}

Keep explanations under 100 characters.`;

// Helper function to ensure minimum delay for realistic AI timing
async function ensureMinimumDelay(startTime, result) {
  const elapsedTime = Date.now() - startTime;
  const minDelay = 1000; // 1 second minimum
  
  if (elapsedTime < minDelay) {
    const remainingDelay = minDelay - elapsedTime;
    await new Promise(resolve => setTimeout(resolve, remainingDelay));
  }
  
  return result;
}

export async function decideMove(aiHand, lastPlayedHand, gameState = {}) {
  const startTime = Date.now(); // Track timing for minimum delay
  
  console.log(`LLM AI hand: ${formatHand(aiHand)}`);
  
  // Get all legal possible plays (now includes first-move filtering)
  const possiblePlays = CardGame.sortPlaysByStrength(
    CardGame.calculatePossiblePlays(
      aiHand, 
      lastPlayedHand, 
      gameState.moveHistory || [], 
      gameState.lowestCardValue
    )
  );

  if (possiblePlays.length === 0) {
    console.log("LLM AI: No valid plays available - passing");
    return await ensureMinimumDelay(startTime, { action: 'pass', explanation: 'No valid moves available' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn('OPENROUTER_API_KEY not configured, falling back to standard AI');
    return await ensureMinimumDelay(startTime, StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState));
  }

  const model = getActiveLLMModel() || DEFAULT_MODEL;

  if (typeof fetch !== 'function') {
    console.warn('Fetch not available, falling back to standard AI');
    return await ensureMinimumDelay(startTime, StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState));
  }

  try {
    const userPrompt = buildUserPrompt(aiHand, lastPlayedHand, possiblePlays, gameState);

    const requestBody = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      reasoning: {
        exclude: true,
        enabled: false
      },
      temperature: 0.2,
    };

    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log("LLM request timeout after 3 seconds, falling back to standard AI");
      controller.abort();
    }, 3000);

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenRouter API error (${response.status}): ${errorText}`);
      throw new Error(`OpenRouter request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = parseModelResponse(content);

    if (!parsed) {
      throw new Error('Unable to parse model response.');
    }

    if (parsed.action === 'pass') {
      console.log(`LLM AI: Pass - ${parsed.explanation || 'No reason given'}`);
      return await ensureMinimumDelay(startTime, { action: 'pass', explanation: parsed.explanation });
    }

    if (parsed.action !== 'play' || !Array.isArray(parsed.cards)) {
      throw new Error('Model response missing playable cards.');
    }

    console.log("LLM returned cards format:", JSON.stringify(parsed.cards, null, 2));
    console.log("First card type check:", typeof parsed.cards[0], parsed.cards[0]);

    const selectedCards = mapCardsFromHand(parsed.cards, aiHand);
    if (!selectedCards) {
      console.error("LLM selected cards not in hand:", JSON.stringify(parsed.cards));
      console.error("Expected format: {\"suit\":\"♠\",\"value\":\"5\"}, got:", JSON.stringify(parsed.cards[0]));
      throw new Error('Model selected cards that are not in AI hand.');
    }

    const isValidSelection = possiblePlays.some(play => playsEqual(play, selectedCards));
    if (!isValidSelection) {
      console.error("LLM selected invalid play:", formatHand(selectedCards));
      throw new Error('Model selected cards that are not a valid play.');
    }

    console.log(`LLM AI: Play ${formatHand(selectedCards)} - ${parsed.explanation || 'No reason given'}`);
    return await ensureMinimumDelay(startTime, { action: 'play', cards: selectedCards, explanation: parsed.explanation });
    
  } catch (error) {
    console.error('LLM AI error:', error.message);
    console.log("Falling back to standard AI");
    return await ensureMinimumDelay(startTime, StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState));
  }
}

function buildHeaders(apiKey) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  if (process.env.OPENROUTER_SITE_URL) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;
  }

  if (process.env.OPENROUTER_APP_NAME) {
    headers['X-Title'] = process.env.OPENROUTER_APP_NAME;
  }

  return headers;
}

function buildUserPrompt(aiHand, lastPlayedHand, possiblePlays, gameState) {
  const round = gameState?.round ?? 1;
  const opponentSummaries = (gameState?.players || [])
    .filter(player => player.name !== gameState?.currentPlayerName)
    .map(player => `- ${player.name}: ${player.handSize} cards${player.isAI ? ' (AI)' : ''}`)
    .join('\n') || 'No opponent information available.';

  const history = (gameState?.moveHistory || [])
    .slice(-5)
    .map(entry => `${entry.name} played ${formatHand(entry.handPlayed)}`)
    .join('\n') || 'No moves have been played yet.';

  const lastPlayDescription = lastPlayedHand?.length
    ? `${formatHand(lastPlayedHand)} (${CardGame.validateHand(lastPlayedHand).type})`
    : 'None (you are leading this trick).';

  const playsDescription = possiblePlays
    .map((play, index) => {
      const handInfo = CardGame.validateHand(play);
      return `${index + 1}. ${formatHand(play)} [${handInfo.type}]`;
    })
    .join('\n');

  const isLeading = !lastPlayedHand || lastPlayedHand.length === 0;

  return [
    `Round: ${round} | Your hand: ${formatHand(aiHand)}`,
    `Last played: ${lastPlayDescription}`,
    'Opponents: ' + opponentSummaries,
    '',
    '*** VALID PLAYS - CHOOSE EXACTLY FROM THIS LIST ***',
    possiblePlays.length > 0 ? playsDescription : 'None - you must pass',
    '',
    possiblePlays.length > 0 ? 
      (isLeading ? 'Tip: When leading, prefer lower-numbered options from the list above.' : 'Tip: Choose from above or pass.') :
      'You must pass - no valid plays available.',
    'Format: {"action":"play","cards":[copy exact cards from list above],"explanation":"brief reason"}'
  ].join('\n');
}

function formatHand(hand) {
  return hand.map(formatCard).join(', ');
}

function formatCard(card) {
  return `${card.value}${card.suit}`;
}

function parseModelResponse(content) {
  if (typeof content !== 'string') {
    return null;
  }

  const sanitized = content
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const jsonMatch = sanitized.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    // Truncate explanation if it's too long
    if (parsed.explanation && parsed.explanation.length > 100) {
      parsed.explanation = parsed.explanation.substring(0, 97) + '...';
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function mapCardsFromHand(cardSpecs, aiHand) {
  const remaining = [...aiHand];
  const selected = [];

  // Handle case where LLM returns comma-separated cards in one string
  let processedSpecs = [];
  for (let spec of cardSpecs) {
    if (typeof spec === 'string' && spec.includes(',')) {
      console.log(`Splitting comma-separated cards: "${spec}"`);
      // Split "K♣, K♥" into ["K♣", "K♥"]
      const splitCards = spec.split(',').map(s => s.trim());
      console.log(`Split into:`, splitCards);
      processedSpecs.push(...splitCards);
    } else {
      processedSpecs.push(spec);
    }
  }

  for (let i = 0; i < processedSpecs.length; i++) {
    let spec = processedSpecs[i];

    // Handle string format like "6♦" - convert to object format
    if (typeof spec === 'string') {
      console.log(`Converting string format "${spec}" to object format`);
      // Extract value and suit from string like "6♦"
      const match = spec.match(/^(.+?)([♠♥♦♣])$/);
      if (!match) {
        console.log(`Failed to parse card string: ${spec}`);
        return null;
      }
      spec = { value: match[1], suit: match[2] };
      console.log(`Converted to:`, spec);
    }

    if (!spec || typeof spec.suit !== 'string' || typeof spec.value !== 'string') {
      console.log(`Invalid spec format:`, spec);
      return null;
    }

    // Try normal format first
    let index = remaining.findIndex(card => card.suit === spec.suit && card.value === spec.value);
    
    // If not found, check if LLM swapped suit and value
    if (index === -1) {
      const swappedIndex = remaining.findIndex(card => card.suit === spec.value && card.value === spec.suit);
      if (swappedIndex !== -1) {
        console.log(`Found swapped format: ${spec.value}${spec.suit} → ${spec.suit}${spec.value}`);
        index = swappedIndex;
      }
    }
    
    if (index === -1) {
      return null;
    }

    selected.push(remaining[index]);
    remaining.splice(index, 1);
  }

  return selected;
}

function playsEqual(playA, playB) {
  if (playA.length !== playB.length) return false;

  const sortedA = [...playA].sort(compareCards);
  const sortedB = [...playB].sort(compareCards);

  return sortedA.every((card, index) =>
    card.suit === sortedB[index].suit && card.value === sortedB[index].value
  );
}

function compareCards(cardA, cardB) {
  return CardGame.getCardValue(cardA) - CardGame.getCardValue(cardB);
}
