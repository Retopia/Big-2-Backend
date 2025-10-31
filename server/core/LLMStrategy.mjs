import * as CardGame from './CardGame.mjs';
import * as StandardAIStrategy from './StandardAIStrategy.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/gpt-5-nano';
const SYSTEM_PROMPT = `You are an expert Big 2 assistant helping to decide the next move.
You must always reply with a single JSON object using the following schema:
{"action":"pass"} for passing, or {"action":"play","cards":[{"suit":"♣","value":"3"}, ...]} when playing cards.
Only choose cards from the provided AI hand and possible plays.
Do not include any additional commentary or markdown.`;

export async function decideMove(aiHand, lastPlayedHand, gameState = {}) {
  const possiblePlays = CardGame.sortPlaysByStrength(
    CardGame.calculatePossiblePlays(aiHand, lastPlayedHand)
  );

  if (possiblePlays.length === 0) {
    return { action: 'pass' };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn('OPENROUTER_API_KEY is not configured. Falling back to standard AI strategy.');
    return StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState);
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  if (typeof fetch !== 'function') {
    console.warn('Global fetch is not available in this environment. Falling back to standard AI strategy.');
    return StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState);
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(aiHand, lastPlayedHand, possiblePlays, gameState) }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter request failed with status ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = parseModelResponse(content);

    if (!parsed) {
      throw new Error('Unable to parse model response.');
    }

    if (parsed.action === 'pass') {
      return { action: 'pass' };
    }

    if (parsed.action !== 'play' || !Array.isArray(parsed.cards)) {
      throw new Error('Model response missing playable cards.');
    }

    const selectedCards = mapCardsFromHand(parsed.cards, aiHand);
    if (!selectedCards) {
      throw new Error('Model selected cards that are not in AI hand.');
    }

    const isValidSelection = possiblePlays.some(play => playsEqual(play, selectedCards));
    if (!isValidSelection) {
      throw new Error('Model selected cards that are not a valid play.');
    }

    return { action: 'play', cards: selectedCards };
  } catch (error) {
    console.error('LLMStrategy error:', error);
    return StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState);
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

  return [
    `Round: ${round}`,
    `AI hand (${aiHand.length} cards): ${formatHand(aiHand)}`,
    `Last played hand: ${lastPlayDescription}`,
    'Opponents:',
    opponentSummaries,
    'Recent moves:',
    history,
    'Possible plays (choose one of these or pass):',
    playsDescription,
    'Respond with JSON only. Do not invent new cards.'
  ].join('\n');
}

function formatHand(hand) {
  return hand.map(formatCard).join(', ');
}

function formatCard(card) {
  return `${card.value}${card.suit}`;
}

function parseModelResponse(content) {
  if (typeof content !== 'string') return null;

  const sanitized = content
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const jsonMatch = sanitized.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function mapCardsFromHand(cardSpecs, aiHand) {
  const remaining = [...aiHand];
  const selected = [];

  for (const spec of cardSpecs) {
    if (!spec || typeof spec.suit !== 'string' || typeof spec.value !== 'string') {
      return null;
    }

    const index = remaining.findIndex(card => card.suit === spec.suit && card.value === spec.value);
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
