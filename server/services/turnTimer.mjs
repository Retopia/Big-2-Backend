/**
 * Per-room "you're on the clock" timer.
 *
 * When it becomes a human player's turn they have TURN_TIMEOUT_MS to act. If they
 * don't, they are booted and the game ends (consistent with how a mid-game
 * departure is handled). Players are only on the clock during THEIR turn — it is
 * fine to be away (e.g. backgrounded on mobile) while waiting for others.
 */
import { broadcastRoomUpdate, broadcastRoomList } from "../utils/broadcast.mjs";
import { participantToPlayer, rooms, usernameToPlayer } from "../state.mjs";

const DEFAULT_TURN_TIMEOUT_MS = 60 * 1000;
export const TURN_TIMEOUT_MS =
  Number.parseInt(process.env.TURN_TIMEOUT_MS, 10) || DEFAULT_TURN_TIMEOUT_MS;

const turnTimers = new Map(); // roomName -> { handle, deadline, participantId }

export function clearTurnTimer(roomName) {
  if (!roomName) return;
  const entry = turnTimers.get(roomName);
  if (entry) {
    clearTimeout(entry.handle);
    turnTimers.delete(roomName);
  }
}

function releaseIdentity(targetPlayer) {
  if (!targetPlayer) return;
  if (targetPlayer.disconnectTimer) {
    clearTimeout(targetPlayer.disconnectTimer);
    targetPlayer.disconnectTimer = null;
  }
  if (
    targetPlayer.name &&
    usernameToPlayer.get(targetPlayer.name) === targetPlayer
  ) {
    usernameToPlayer.delete(targetPlayer.name);
  }
  if (
    targetPlayer.participantId &&
    participantToPlayer.get(targetPlayer.participantId) === targetPlayer
  ) {
    participantToPlayer.delete(targetPlayer.participantId);
  }
}

function forfeitAfkPlayer(io, roomName, participantId) {
  const room = rooms.get(roomName);
  if (!room || room.status !== "playing" || !room.gameState) {
    clearTurnTimer(roomName);
    return;
  }

  const current = room.gameState.getCurrentPlayer();
  // The turn may have advanced between the timer firing and this callback running;
  // if so, just re-arm for whoever is on the clock now.
  if (!current || current.isAI || current.participantId !== participantId) {
    armTurnTimer(io, room);
    return;
  }

  const afkName = current.name;

  // End the active game (same outcome as a mid-game departure).
  room.status = "waiting";
  room.gameState = null;
  io.to(room.id).emit("gameError", {
    message: `${afkName} was removed for being away too long. The game has ended.`,
  });

  // Boot the AFK player's socket so their client falls back to the lobby.
  current.connected = false;
  if (current.id) {
    io.to(current.id).emit("forceLeave");
    const afkSocket = io.sockets.sockets.get(current.id);
    if (afkSocket) {
      afkSocket.leave(room.id);
      afkSocket.disconnect(true);
    }
    current.id = null;
    current.socketId = null;
  }

  if (room.creatorID === current.participantId) {
    room.players.forEach((roomPlayer) => {
      roomPlayer.room = null;
      if (
        !roomPlayer.isAI &&
        roomPlayer.id &&
        roomPlayer.participantId !== current.participantId
      ) {
        io.to(roomPlayer.id).emit("forceLeave");
        io.sockets.sockets.get(roomPlayer.id)?.leave(room.id);
      }
      if (!roomPlayer.connected) releaseIdentity(roomPlayer);
    });
    rooms.delete(room.name);
  } else {
    room.removePlayer(current.participantId);
    current.room = null;
    releaseIdentity(current);
    if (room.isEmpty()) rooms.delete(room.name);
    else broadcastRoomUpdate(io, room);
  }

  clearTurnTimer(roomName);
  io.to(room.id).emit("turnTimerCleared");
  broadcastRoomList(io, rooms);
}

/**
 * (Re)start the clock for the room's current player. No-op (and clears any
 * existing timer) when the game isn't running or the current player is an AI.
 * Call this right after every broadcastGameState.
 */
export function armTurnTimer(io, room) {
  if (!room) return;

  if (room.status !== "playing" || !room.gameState) {
    clearTurnTimer(room.name);
    return;
  }

  const current = room.gameState.getCurrentPlayer();
  if (!current || current.isAI) {
    clearTurnTimer(room.name);
    io.to(room.id).emit("turnTimerCleared");
    return;
  }

  const existing = turnTimers.get(room.name);
  let deadline;

  if (existing && existing.participantId === current.participantId) {
    // Same player already on the clock (e.g. they just reconnected). Preserve the
    // original deadline so a reconnect can neither reset nor dodge the AFK timer.
    deadline = existing.deadline;
  } else {
    clearTurnTimer(room.name);
    deadline = Date.now() + TURN_TIMEOUT_MS;
    const handle = setTimeout(
      () => forfeitAfkPlayer(io, room.name, current.participantId),
      TURN_TIMEOUT_MS
    );
    turnTimers.set(room.name, {
      handle,
      deadline,
      participantId: current.participantId,
    });
  }

  io.to(room.id).emit("turnTimer", {
    currentPlayer: current.name,
    deadline,
    serverNow: Date.now(),
    durationMs: TURN_TIMEOUT_MS,
  });
}
