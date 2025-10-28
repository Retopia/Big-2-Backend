import { rooms } from "../state.mjs";
import { broadcastGameState, broadcastGameEnd, broadcastRoomUpdate, broadcastRoomList } from "../utils/broadcast.mjs";
import { generateRandomUsername } from "../utils/id.mjs";
import * as StandardAIStrategy from '../core/StandardAIStrategy.mjs';
import * as LLMStrategy from '../core/LLMStrategy.mjs';

/**
 * Handles the AI's turn logic with a delay for realism.
 */
export function processAITurn(io, room) {
  if (!room?.gameState) return;

  setTimeout(() => {
    const current = room.gameState.getCurrentPlayer();
    if (!current?.isAI) return;

    const result = room.gameState.handleAITurn(current);
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
  }, 1000);
}

/**
 * Adds an AI player to the specified room.
 */
export function addAIPlayer(io, socket, roomName, difficulty, suppressBroadcast = false) {
  const room = rooms.get(roomName);
  if (!room) return;

  if (room.creatorID !== socket.id) {
    socket.emit("gameError", { message: "Only the creator can add AI players." });
    return;
  }

  if (room.players.length >= 4) {
    socket.emit("gameError", { message: "Room is full." });
    return;
  }

  const aiPlayer = {
    id: null,
    name: "AI_" + generateRandomUsername(),
    room: roomName,
    difficulty,
    isAI: true,
  };

  room.addPlayer(aiPlayer);

  if (!suppressBroadcast) {
    broadcastRoomUpdate(io, room);
  }

  console.log(`AI added to ${roomName}: ${aiPlayer.name}`);
}

/**
 * Calculates the AI's move based on its hand, the last played hand, and the game state.
 */
export function calculateAIMove(aiHand, lastPlayedHand, gameState, aiType) {
  console.log(`Calculating AI move for type: ${aiType}`);
  
  if (aiType === 'standard') {
    return StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState);
  } else if (aiType === 'llm') {
    return LLMStrategy.decideMove(aiHand, lastPlayedHand, gameState);
  }
  
  // Default fallback to standard AI if type is unrecognized
  console.warn(`Unknown AI type: ${aiType}, falling back to standard AI`);
  return StandardAIStrategy.decideMove(aiHand, lastPlayedHand, gameState);
}