/**
 * Socket.IO event registration and real-time room/game handling
 */

import {
  broadcastRoomList,
  broadcastGameState,
  broadcastRoomUpdate,
  broadcastGameEnd,
} from "./utils/broadcast.mjs";
import { generateRandomUsername } from "./utils/id.mjs";
import { Room } from "./core/Room.mjs";
import { GameState } from "./core/GameState.mjs";
import { addAIPlayer, processAITurn } from "./services/aiService.mjs";
import { recordGameResult } from "./services/ratingService.mjs";
import {
  ensureUniqueName,
  PLAYER_NAME_MAX_LENGTH,
  validatePlayerName,
  validateRoomName,
} from "./utils/nameValidation.mjs";
import { getUserByToken } from "./userAuth.mjs";
import { armTurnTimer, clearTurnTimer } from "./services/turnTimer.mjs";

// Shared in-memory state
import {
  announcementState,
  participantToPlayer,
  rooms,
  usernameToPlayer,
} from "./state.mjs";

const DEFAULT_RECONNECT_GRACE_MS = 2 * 60 * 1000;
const RECONNECT_GRACE_MS = Number.parseInt(
  process.env.SOCKET_RECONNECT_GRACE_MS,
  10
) || DEFAULT_RECONNECT_GRACE_MS;
const GUEST_SESSION_PATTERN = /^[A-Za-z0-9_-]{12,80}$/;

function normalizeGuestSessionId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return GUEST_SESSION_PATTERN.test(trimmed) ? trimmed : null;
}

async function resolveSocketIdentity(socket) {
  const token = socket.handshake.auth?.token;
  if (typeof token === "string" && token.trim()) {
    try {
      const user = await getUserByToken(token.trim());
      if (user) {
        return {
          participantId: `user:${user.id}`,
          user,
          guestSessionId: null,
          defaultName: user.username,
        };
      }
    } catch (error) {
      if (error?.code !== "DATABASE_UNAVAILABLE") {
        console.error("Unable to resolve socket auth token:", error);
      }
    }
  }

  const guestSessionId =
    normalizeGuestSessionId(socket.handshake.auth?.guestSessionId) || socket.id;

  return {
    participantId: `guest:${guestSessionId}`,
    user: null,
    guestSessionId,
    defaultName: generateRandomUsername(),
  };
}

export default function registerSocketHandlers(io) {
  io.on("connection", async (socket) => {
    console.log(`User connected: ${socket.id}`);
    const identity = await resolveSocketIdentity(socket);
    const activeAnnouncement = announcementState.current;
    if (activeAnnouncement && activeAnnouncement.expiresAt > Date.now()) {
      socket.emit("announcement", activeAnnouncement);
    } else if (activeAnnouncement && activeAnnouncement.expiresAt <= Date.now()) {
      announcementState.current = null;
    }

    /** Player session object */
    let player = participantToPlayer.get(identity.participantId);
    if (player) {
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
      }

      const oldSocketId = player.id;
      if (oldSocketId && oldSocketId !== socket.id) {
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }

      player.id = socket.id;
      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
      player.userId = identity.user?.id || player.userId || null;
      player.guestSessionId = identity.guestSessionId || player.guestSessionId || null;
      player.rating = identity.user?.rating || player.rating || null;
    } else {
      player = {
        id: socket.id,
        socketId: socket.id,
        participantId: identity.participantId,
        userId: identity.user?.id || null,
        guestSessionId: identity.guestSessionId,
        name: identity.defaultName,
        room: null,
        rating: identity.user?.rating || null,
        connected: true,
        disconnectedAt: null,
        disconnectTimer: null,
        isAI: false,
      };
      participantToPlayer.set(player.participantId, player);
    }
    socket.data.player = player;

    function setPlayerName(nextName) {
      if (
        player.name &&
        player.name !== nextName &&
        usernameToPlayer.get(player.name) === player
      ) {
        usernameToPlayer.delete(player.name);
      }

      player.name = nextName;
      usernameToPlayer.set(nextName, player);
    }

    function buildUniqueGlobalName(baseName) {
      return ensureUniqueName(
        baseName,
        (candidate) => {
          const owner = usernameToPlayer.get(candidate);
          return Boolean(owner && owner !== player);
        },
        PLAYER_NAME_MAX_LENGTH
      );
    }

    function validateAndClaimPlayerName(rawName) {
      const validation = validatePlayerName(rawName);
      if (!validation.ok) {
        return validation;
      }

      const uniqueName = buildUniqueGlobalName(validation.value);
      setPlayerName(uniqueName);
      return { ok: true, value: uniqueName };
    }

    function emitSession() {
      socket.emit("sessionAssigned", {
        participantId: player.participantId,
        guestSessionId: player.guestSessionId,
        authenticated: Boolean(player.userId),
        userId: player.userId,
        rating: player.rating || null,
      });
    }

    function releasePlayerIdentity(targetPlayer) {
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

    function resolveRoomFromPayload(rawRoomName) {
      if (player.room) {
        const currentRoom = rooms.get(player.room);
        if (currentRoom) return currentRoom;
      }

      const validation = validateRoomName(rawRoomName);
      if (!validation.ok) return null;
      return rooms.get(validation.value) || null;
    }

    function endActiveGame(room, message) {
      if (room.status === "playing") {
        room.status = "waiting";
        room.gameState = null;
        clearTurnTimer(room.name);
        io.to(room.id).emit("turnTimerCleared");
        io.to(room.id).emit("gameError", { message });
      }
    }

    function removeCreatorRoom(room) {
      clearTurnTimer(room.name);
      room.players.forEach((p) => {
        p.room = null;
        if (!p.isAI && p.id && p.participantId !== player.participantId) {
          io.to(p.id).emit("forceLeave");
          io.sockets.sockets.get(p.id)?.leave(room.id);
        }
      });
      rooms.delete(room.name);
    }

    function leaveRoomInternal(room, leaveMessage = null) {
      if (!room) {
        player.room = null;
        return;
      }

      if (leaveMessage) {
        endActiveGame(room, leaveMessage);
      }

      if (room.creatorID === player.participantId) {
        removeCreatorRoom(room);
      } else {
        room.removePlayer(player.participantId);
        socket.leave(room.id);

        if (room.isEmpty()) {
          rooms.delete(room.name);
        } else {
          broadcastRoomUpdate(io, room);
        }
      }

      player.room = null;
    }

    function finalizeDisconnect(participantId, room) {
      const targetPlayer = participantToPlayer.get(participantId);
      if (!targetPlayer || targetPlayer.connected) return;

      // Compare the captured Room *instance*, not just its name: during the grace
      // window the room may have been deleted and a new one created with the same
      // name. Acting on a name match would end an unrelated game.
      if (!room || rooms.get(room.name) !== room || targetPlayer.room !== room.name) {
        releasePlayerIdentity(targetPlayer);
        return;
      }

      if (room.creatorID === targetPlayer.participantId) {
        endActiveGame(room, "The room creator disconnected. The room has been closed.");
        room.players.forEach((roomPlayer) => {
          roomPlayer.room = null;
          if (!roomPlayer.isAI && roomPlayer.id) {
            io.to(roomPlayer.id).emit("forceLeave");
            io.sockets.sockets.get(roomPlayer.id)?.leave(room.id);
          }
          if (!roomPlayer.connected) releasePlayerIdentity(roomPlayer);
        });
        rooms.delete(room.name);
      } else {
        endActiveGame(room, "A player disconnected. The game has ended.");
        room.removePlayer(targetPlayer.participantId);
        targetPlayer.room = null;

        if (room.isEmpty()) rooms.delete(room.name);
        else broadcastRoomUpdate(io, room);

        releasePlayerIdentity(targetPlayer);
      }

      broadcastRoomList(io, rooms);
    }

    function scheduleDisconnectCleanup(room) {
      const participantId = player.participantId;
      const targetRoom = room || null;

      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
      }

      player.disconnectTimer = setTimeout(() => {
        finalizeDisconnect(participantId, targetRoom);
      }, RECONNECT_GRACE_MS);
    }

    /**
     * Assigns username or reconnects existing player.
     */
    socket.on("joinOrReconnect", (payload = {}) => {
      if (!player.room) {
        const requestedName = identity.user?.username || payload?.username;
        if (typeof requestedName === "string" && requestedName.trim()) {
          const claimed = validateAndClaimPlayerName(requestedName);
          if (!claimed.ok) {
            const randomName = buildUniqueGlobalName(generateRandomUsername());
            setPlayerName(randomName);
            emitSession();
            socket.emit("assignUsername", { username: player.name });
            socket.emit("gameError", {
              message: `${claimed.error} Assigned a random username instead.`,
            });
            return;
          }
        } else if (!usernameToPlayer.get(player.name)) {
          const randomName = buildUniqueGlobalName(player.name || generateRandomUsername());
          setPlayerName(randomName);
        }
      } else {
        const room = rooms.get(player.room);
        if (room) {
          socket.join(room.id);
          broadcastRoomUpdate(io, room);
          if (room.status === "playing") {
            broadcastGameState(io, room);
            armTurnTimer(io, room);
          }
        }
      }

      emitSession();
      socket.emit("assignUsername", { username: player.name });
      console.log(`${player.name} joined or reconnected as ${player.participantId}.`);
    });

    // Frontend requests a random username explicitly if none in localStorage
    socket.on("requestRandomUsername", () => {
      if (player.room) {
        emitSession();
        socket.emit("assignUsername", { username: player.name });
        return;
      }

      const randomName = buildUniqueGlobalName(generateRandomUsername());
      setPlayerName(randomName);
      emitSession();
      socket.emit("assignUsername", { username: player.name });
      console.log(`Random username issued: ${player.name}`);
    });

    /** Update username */
    socket.on("updateUsername", (payload = {}) => {
      if (player.room) {
        socket.emit("gameError", {
          message: "Cannot change username while in a room.",
        });
        return;
      }

      const claimed = validateAndClaimPlayerName(payload?.username);
      if (!claimed.ok) {
        socket.emit("gameError", { message: claimed.error });
        return;
      }

      emitSession();
      socket.emit("assignUsername", { username: player.name });
      console.log(`Updated username to: ${player.name}`);
    });

    /** Get all rooms */
    socket.on("requestRoomList", () => {
      broadcastRoomList(io, rooms);
    });

    /** Join or create room */
    socket.on("joinRoom", (payload = {}) => {
      const roomValidation = validateRoomName(payload?.roomName);
      if (!roomValidation.ok) {
        socket.emit("joinError", { message: roomValidation.error });
        return;
      }

      const wantsRatedRoom = payload?.rated === true;
      if (wantsRatedRoom && !player.userId) {
        socket.emit("joinError", {
          code: "AUTH_REQUIRED",
          message: "Log in to create a ranked room.",
        });
        return;
      }

      const requestedPlayerName = identity.user?.username || payload?.playerName || player.name;
      const claimed = validateAndClaimPlayerName(requestedPlayerName);
      if (!claimed.ok) {
        socket.emit("joinError", { message: claimed.error });
        return;
      }

      if (player.room && player.room !== roomValidation.value) {
        const previousRoom = rooms.get(player.room);
        leaveRoomInternal(previousRoom, "A player left. The game has ended.");
      }

      let room = rooms.get(roomValidation.value);
      if (!room) {
        room = new Room(roomValidation.value, player.participantId, {
          rated: wantsRatedRoom,
        });
        rooms.set(roomValidation.value, room);
        console.log(`Room created: ${room.id}, owner id: ${player.participantId}`);
      }

      if (room.rated && !player.userId) {
        socket.emit("joinError", {
          code: "AUTH_REQUIRED",
          message: "Log in to join ranked rooms.",
        });
        return;
      }

      if (room.status !== "waiting") {
        socket.emit("joinError", { message: "This room already has a game in progress." });
        return;
      }

      const conflictingName = room.players.some(
        (roomPlayer) =>
          roomPlayer.name === player.name &&
          roomPlayer.participantId !== player.participantId
      );
      if (conflictingName) {
        const uniqueNameInRoom = ensureUniqueName(
          player.name,
          (candidate) => room.players.some((roomPlayer) => roomPlayer.name === candidate),
          PLAYER_NAME_MAX_LENGTH
        );
        setPlayerName(buildUniqueGlobalName(uniqueNameInRoom));
      }

      const existingPlayer = room.findPlayer(player.participantId);
      if (!existingPlayer) {
        const addResult = room.addPlayer(player);
        if (!addResult.success) {
          socket.emit("joinError", { message: addResult.message });
          return;
        }
      }

      player.room = room.name;
      socket.join(room.id);

      emitSession();
      socket.emit("assignUsername", { username: player.name });
      broadcastRoomUpdate(io, room);
      broadcastRoomList(io, rooms);
    });

    /** Start AI-only game */
    socket.on("startAIGame", (payload = {}) => {
      const roomValidation = validateRoomName(payload?.roomName);
      if (!roomValidation.ok) {
        socket.emit("joinAIGameError", { message: roomValidation.error });
        return;
      }

      const requestedPlayerName = identity.user?.username || payload?.playerName || player.name;
      const claimed = validateAndClaimPlayerName(requestedPlayerName);
      if (!claimed.ok) {
        socket.emit("joinAIGameError", { message: claimed.error });
        return;
      }

      const aiCount = Number.parseInt(payload?.aiCount, 10);
      if (!Number.isInteger(aiCount) || aiCount < 1 || aiCount > 3) {
        socket.emit("joinAIGameError", { message: "AI count must be between 1 and 3." });
        return;
      }

      const difficulty = payload?.difficulty === "llm" ? "llm" : "standard";

      if (player.room && player.room !== roomValidation.value) {
        const previousRoom = rooms.get(player.room);
        leaveRoomInternal(previousRoom, "A player left. The game has ended.");
      }

      if (rooms.has(roomValidation.value)) {
        socket.emit("joinAIGameError", { message: "Room already exists." });
        return;
      }

      const room = new Room(roomValidation.value, player.participantId);
      rooms.set(roomValidation.value, room);

      player.room = room.name;
      const addResult = room.addPlayer(player);
      if (!addResult.success) {
        player.room = null;
        rooms.delete(room.name);
        socket.emit("joinAIGameError", { message: addResult.message });
        return;
      }

      socket.join(room.id);
      emitSession();
      socket.emit("assignUsername", { username: player.name });

      for (let i = 0; i < aiCount; i++) {
        addAIPlayer(io, socket, room.name, difficulty, true);
      }

      broadcastRoomUpdate(io, room);

      try {
        room.status = "playing";
        room.gameState = new GameState(room.players);
      } catch (error) {
        console.error("Unable to initialize AI game:", error);
        room.players.forEach((p) => {
          p.room = null;
        });
        rooms.delete(room.name);
        player.room = null;
        socket.leave(room.id);
        socket.emit("joinAIGameError", {
          message: error?.message || "Unable to start this game configuration.",
        });
        broadcastRoomList(io, rooms);
        return;
      }

      broadcastGameState(io, room);

      if (room.gameState.getCurrentPlayer().isAI) {
        processAITurn(io, room);
      } else {
        armTurnTimer(io, room);
      }

      io.to(room.id).emit("gameStarted");
      broadcastRoomList(io, rooms);
    });

    /** Add AI */
    socket.on("addAI", (payload = {}) => {
      const room = resolveRoomFromPayload(payload?.roomName);
      if (!room) {
        socket.emit("gameError", { message: "Room not found." });
        return;
      }

      const difficulty = payload?.difficulty === "llm" ? "llm" : "standard";
      if (room.rated) {
        socket.emit("gameError", { message: "Ranked rooms cannot include AI players." });
        return;
      }
      addAIPlayer(io, socket, room.name, difficulty);
    });

    /** Remove player (creator only) */
    socket.on("removePlayer", (payload = {}) => {
      const room = resolveRoomFromPayload(payload?.roomName);
      if (!room) {
        socket.emit("gameError", { message: "Room not found." });
        return;
      }

      if (room.creatorID !== player.participantId) {
        socket.emit("gameError", { message: "Only the creator can remove players." });
        return;
      }

      if (room.status !== "waiting") {
        socket.emit("gameError", { message: "Cannot remove players after the game has started." });
        return;
      }

      const targetValidation = validatePlayerName(payload?.playerName);
      if (!targetValidation.ok) {
        socket.emit("gameError", { message: targetValidation.error });
        return;
      }

      const targetPlayer = room.findPlayer(targetValidation.value);
      if (!targetPlayer) {
        socket.emit("gameError", { message: "Player not found in room." });
        return;
      }

      if (targetPlayer.participantId === player.participantId) {
        socket.emit("gameError", { message: "Use leave room to remove yourself." });
        return;
      }

      room.players = room.players.filter(
        (p) => p.participantId !== targetPlayer.participantId
      );
      targetPlayer.room = null;
      if (targetPlayer.id) {
        io.to(targetPlayer.id).emit("forceLeave");
        io.sockets.sockets.get(targetPlayer.id)?.leave(room.id);
      }

      broadcastRoomUpdate(io, room);
      broadcastRoomList(io, rooms);
    });

    /** Handle game move */
    socket.on("processMove", async (payload = {}) => {
      const room = player.room ? rooms.get(player.room) : null;
      if (!room || room.status !== "playing" || !room.gameState) {
        socket.emit("gameError", { message: "Game not active." });
        return;
      }

      if (!room.findPlayer(player.participantId)) {
        socket.emit("gameError", { message: "You are not in this room." });
        return;
      }

      const current = room.gameState.getCurrentPlayer();
      // A human may only move on their own turn. When it's an AI's turn the move
      // is driven by processAITurn — humans must never be able to act for the AI.
      if (current.isAI || current.participantId !== player.participantId) {
        socket.emit("gameError", { message: "Not your turn." });
        return;
      }

      const cards = Array.isArray(payload?.cards) ? payload.cards : [];
      const result = cards.length
        ? room.gameState.playCards(player.name, cards)
        : room.gameState.passTurn(player.name);

      if (!result.success) {
        socket.emit("gameError", { message: result.message });
        return;
      }

      if (result.gameStatus === "finished") {
        clearTurnTimer(room.name);
        await recordGameResult(room, result.winner);
        broadcastGameEnd(io, room, result.winner, room.gameState.scores);
        setTimeout(() => {
          if (!rooms.has(room.name)) return;
          room.status = "waiting";
          room.gameState = null;
          broadcastRoomUpdate(io, room);
          broadcastRoomList(io, rooms);
        }, 500);
        return;
      }

      broadcastGameState(io, room);
      const next = room.gameState.getCurrentPlayer();
      if (next.isAI) processAITurn(io, room);
      else armTurnTimer(io, room);
    });

    /** Start normal game */
    socket.on("startGame", (payload = {}) => {
      const room = resolveRoomFromPayload(payload?.roomName);
      if (!room) {
        socket.emit("gameError", { message: "Room not found." });
        return;
      }
      if (room.creatorID !== player.participantId) {
        socket.emit("gameError", { message: "Only the creator can start the game." });
        return;
      }

      if (room.status !== "waiting") {
        socket.emit("gameError", { message: "Game already in progress." });
        return;
      }

      if (room.players.length < 2 || room.players.length > 4) {
        socket.emit("gameError", { message: "Game requires 2 to 4 players." });
        return;
      }

      if (
        room.rated &&
        room.players.some((roomPlayer) => roomPlayer.isAI || !roomPlayer.userId)
      ) {
        socket.emit("gameError", {
          message: "Ranked games require logged-in human players only.",
        });
        return;
      }

      const uniqueNames = new Set(room.players.map((roomPlayer) => roomPlayer.name));
      if (uniqueNames.size !== room.players.length) {
        socket.emit("gameError", { message: "All players in the room must have unique names." });
        return;
      }

      try {
        room.status = "playing";
        room.gameState = new GameState(room.players);
      } catch (error) {
        room.status = "waiting";
        room.gameState = null;
        socket.emit("gameError", {
          message: error?.message || "Unable to start this game configuration.",
        });
        return;
      }

      broadcastGameState(io, room);

      const first = room.gameState.getCurrentPlayer();
      if (first.isAI) processAITurn(io, room);
      else armTurnTimer(io, room);

      io.to(room.id).emit("gameStarted");
      broadcastRoomList(io, rooms);
    });

    /** Leave room */
    socket.on("leaveRoom", () => {
      const room = player.room ? rooms.get(player.room) : null;
      leaveRoomInternal(room, "A player left. The game has ended.");
      broadcastRoomList(io, rooms);
    });

    /** Disconnect cleanup */
    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id}`);
      if (player.id !== socket.id) return;

      const room = player.room ? rooms.get(player.room) : null;
      player.connected = false;
      player.disconnectedAt = Date.now();
      player.id = null;
      player.socketId = null;

      if (!room) {
        releasePlayerIdentity(player);
        return;
      }

      socket.leave(room.id);
      scheduleDisconnectCleanup(room);
      broadcastRoomUpdate(io, room);
      broadcastRoomList(io, rooms);
    });
  });
}
