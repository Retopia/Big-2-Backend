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
import {
  ensureUniqueName,
  PLAYER_NAME_MAX_LENGTH,
  validatePlayerName,
  validateRoomName,
} from "./utils/nameValidation.mjs";

// Shared in-memory state
import { announcementState, rooms, usernameToPlayer } from "./state.mjs";

export default function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);
    const activeAnnouncement = announcementState.current;
    if (activeAnnouncement && activeAnnouncement.expiresAt > Date.now()) {
      socket.emit("announcement", activeAnnouncement);
    } else if (activeAnnouncement && activeAnnouncement.expiresAt <= Date.now()) {
      announcementState.current = null;
    }

    /** Player session object */
    let player = {
      id: socket.id,
      name: generateRandomUsername(),
      room: null,
      isAI: false,
    };

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
        io.to(room.id).emit("gameError", { message });
      }
    }

    function removeCreatorRoom(room) {
      room.players.forEach((p) => {
        p.room = null;
        if (!p.isAI && p.id && p.id !== socket.id) {
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

      if (room.creatorID === socket.id) {
        removeCreatorRoom(room);
      } else {
        room.removePlayer(socket.id);
        socket.leave(room.id);

        if (room.isEmpty()) {
          rooms.delete(room.name);
        } else {
          broadcastRoomUpdate(io, room);
        }
      }

      player.room = null;
    }

    /**
     * Assigns username or reconnects existing player.
     */
    socket.on("joinOrReconnect", (payload = {}) => {
      const username = payload?.username;

      // Attempt to reconnect an existing username
      if (typeof username === "string" && username.trim()) {
        const validation = validatePlayerName(username);
        const existing = validation.ok ? usernameToPlayer.get(validation.value) : null;
        if (existing) {
          const oldId = existing.id;
          existing.id = socket.id; // update socket id for this session
          player = existing;
          if (existing.room) {
            const room = rooms.get(existing.room); // existing.room stores the room name
            if (room) {
              socket.join(room.id); // Ensure we join the actual Socket.IO room id
              if (room.creatorID === oldId) {
                room.creatorID = socket.id; // update creator id on reconnection
                broadcastRoomUpdate(io, room);
              }
              if (room.status === "playing") {
                broadcastGameState(io, room);
              }
            }
          }
          socket.emit("assignUsername", { username: player.name });
          console.log(`${username} reconnected.`);
          return;
        }

        const claimed = validateAndClaimPlayerName(username);
        if (!claimed.ok) {
          const randomName = buildUniqueGlobalName(generateRandomUsername());
          setPlayerName(randomName);
          socket.emit("assignUsername", { username: player.name });
          socket.emit("gameError", {
            message: `${claimed.error} Assigned a random username instead.`,
          });
          return;
        }

        socket.emit("assignUsername", { username: player.name });
        console.log(`New user assigned: ${player.name}`);
        return;
      }

      const randomName = buildUniqueGlobalName(player.name || generateRandomUsername());
      setPlayerName(randomName);
      socket.emit("assignUsername", { username: player.name });
      console.log(`New user assigned: ${player.name}`);
    });

    // Frontend requests a random username explicitly if none in localStorage
    socket.on("requestRandomUsername", () => {
      const randomName = buildUniqueGlobalName(generateRandomUsername());
      setPlayerName(randomName);
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

      const claimed = validateAndClaimPlayerName(payload?.playerName || player.name);
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
        room = new Room(roomValidation.value, socket.id);
        rooms.set(roomValidation.value, room);
        console.log(`Room created: ${room.id}, owner id: ${socket.id}`);
      }

      if (room.status !== "waiting") {
        socket.emit("joinError", { message: "This room already has a game in progress." });
        return;
      }

      const conflictingName = room.players.some(
        (roomPlayer) => roomPlayer.name === player.name && roomPlayer.id !== socket.id
      );
      if (conflictingName) {
        const uniqueNameInRoom = ensureUniqueName(
          player.name,
          (candidate) => room.players.some((roomPlayer) => roomPlayer.name === candidate),
          PLAYER_NAME_MAX_LENGTH
        );
        setPlayerName(buildUniqueGlobalName(uniqueNameInRoom));
      }

      const existingPlayer = room.findPlayer(socket.id);
      if (!existingPlayer) {
        const addResult = room.addPlayer(player);
        if (!addResult.success) {
          socket.emit("joinError", { message: addResult.message });
          return;
        }
      }

      player.room = room.name;
      socket.join(room.id);

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

      const claimed = validateAndClaimPlayerName(payload?.playerName || player.name);
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

      const room = new Room(roomValidation.value, socket.id);
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
      addAIPlayer(io, socket, room.name, difficulty);
    });

    /** Remove player (creator only) */
    socket.on("removePlayer", (payload = {}) => {
      const room = resolveRoomFromPayload(payload?.roomName);
      if (!room) {
        socket.emit("gameError", { message: "Room not found." });
        return;
      }

      if (room.creatorID !== socket.id) {
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

      if (targetPlayer.id === socket.id) {
        socket.emit("gameError", { message: "Use leave room to remove yourself." });
        return;
      }

      room.players = room.players.filter((p) => p.name !== targetPlayer.name);
      targetPlayer.room = null;
      if (targetPlayer.id) {
        io.to(targetPlayer.id).emit("forceLeave");
        io.sockets.sockets.get(targetPlayer.id)?.leave(room.id);
      }

      broadcastRoomUpdate(io, room);
      broadcastRoomList(io, rooms);
    });

    /** Handle game move */
    socket.on("processMove", (payload = {}) => {
      const room = player.room ? rooms.get(player.room) : null;
      if (!room || room.status !== "playing" || !room.gameState) {
        socket.emit("gameError", { message: "Game not active." });
        return;
      }

      if (!room.findPlayer(socket.id)) {
        socket.emit("gameError", { message: "You are not in this room." });
        return;
      }

      const current = room.gameState.getCurrentPlayer();
      if (current.id !== socket.id && !current.isAI) {
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
    });

    /** Start normal game */
    socket.on("startGame", (payload = {}) => {
      const room = resolveRoomFromPayload(payload?.roomName);
      if (!room) {
        socket.emit("gameError", { message: "Room not found." });
        return;
      }
      if (room.creatorID !== socket.id) {
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
      // Preserve usernameToPlayer mapping to allow seamless reconnection.
      // (Optionally implement TTL/cleanup later.)

      const room = player.room ? rooms.get(player.room) : null;
      if (!room) return;

      if (room.creatorID === socket.id) {
        endActiveGame(room, "The room creator disconnected. The room has been closed.");
        removeCreatorRoom(room);
      } else {
        endActiveGame(room, "A player disconnected. The game has ended.");
        room.removePlayer(socket.id);
        player.room = null;

        if (room.isEmpty()) rooms.delete(room.name);
        else broadcastRoomUpdate(io, room);
      }

      broadcastRoomList(io, rooms);
    });
  });
}
