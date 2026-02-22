import { rooms } from "../state.mjs";
import { broadcastGameState, broadcastGameEnd, broadcastRoomUpdate, broadcastRoomList } from "../utils/broadcast.mjs";
import { generateRandomUsername } from "../utils/id.mjs";
import { ensureUniqueName, PLAYER_NAME_MAX_LENGTH } from "../utils/nameValidation.mjs";
import * as StandardAIStrategy from '../core/StandardAIStrategy.mjs';
import * as LLMStrategy from '../core/LLMStrategy.mjs';

/**
 * Handles the AI's turn logic with a delay for realism (standard AI only).
 */
export function processAITurn(io, room) {
  if (!room?.gameState) return;

  const current = room.gameState.getCurrentPlayer();
  if (!current?.isAI) return;

  // Add delay only for standard AI (LLM already has natural delay from API call)
  const delay = current.difficulty === 'standard' ? 1000 : 0;
  
  setTimeout(async () => {
    try {
      const result = await room.gameState.handleAITurn(current);
      if (!result) return;

      // Game finished condition
      if (result.gameStatus === "finished") {
        broadcastGameEnd(io, room, result.winner, room.gameState.scores);

        setTimeout(() => {
          room.status = "waiting";
          room.gameState = null;
          broadcastRoomUpdate(io, room);
          broadcastRoomList(io, rooms);
        }, 500);

        return;
      }

      // Regular broadcast
      broadcastGameState(io, room);

      // Continue AI chain if next player is AI
      const next = room.gameState.getCurrentPlayer();
      if (next?.isAI) processAITurn(io, room);
    } catch (error) {
      console.error('Failed to process AI turn:', error);
    }
  }, delay);
}

/**
 * Adds an AI player to the specified room.
 */
export function addAIPlayer(io, socket, roomName, difficulty, suppressBroadcast = false) {
  const room = rooms.get(roomName);
  if (!room) {
    socket.emit("gameError", { message: "Room not found." });
    return;
  }

  if (room.creatorID !== socket.id) {
    socket.emit("gameError", { message: "Only the creator can add AI players." });
    return;
  }

  if (room.status !== "waiting") {
    socket.emit("gameError", { message: "Cannot add AI after the game has started." });
    return;
  }

  if (room.players.length >= 4) {
    socket.emit("gameError", { message: "Room is full." });
    return;
  }

  const baseName = "AI_" + generateRandomUsername();
  const aiName = ensureUniqueName(
    baseName,
    (candidate) => room.players.some((player) => player.name === candidate),
    PLAYER_NAME_MAX_LENGTH
  );

  const aiPlayer = {
    id: null,
    name: aiName,
    room: roomName,
    difficulty,
    isAI: true,
  };

  const addResult = room.addPlayer(aiPlayer);
  if (!addResult.success) {
    socket.emit("gameError", { message: addResult.message });
    return;
  }

  if (!suppressBroadcast) {
    broadcastRoomUpdate(io, room);
    broadcastRoomList(io, rooms);
  }

  console.log(`AI added to ${roomName}: ${aiPlayer.name}`);
}

/**
 * Calculates the AI's move based on its hand, the last played hand, and the game state.
 */
export async function calculateAIMove(aiHand, lastPlayedHand, gameState, aiType) {
  console.log(`Calculating AI move for type: ${aiType}`);

  try {
    if (aiType === 'standard') {
      return StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState);
    } else if (aiType === 'llm') {
      return await LLMStrategy.decideMove(aiHand, lastPlayedHand, gameState);
    }

    // Default fallback to standard AI if type is unrecognized
    console.warn(`Unknown AI type: ${aiType}, falling back to standard AI`);
    return StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState);
  } catch (error) {
    console.error('Error calculating AI move:', error);
    return StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState);
  }
}
