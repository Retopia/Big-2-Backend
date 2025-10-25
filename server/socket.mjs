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

// Shared in-memory state
import { rooms, usernameToPlayer } from "./state.mjs";

export default function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    /** Player session object */
    let player = {
      id: socket.id,
      name: generateRandomUsername(),
      room: null,
      isAI: false,
    };

    /**
     * Assigns username or reconnects existing player.
     */
    socket.on("joinOrReconnect", ({ username } = {}) => {
      // Attempt to reconnect an existing username
      if (username) {
        const existing = usernameToPlayer.get(username);
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
            }
          }
          console.log(`${username} reconnected.`);
          return;
        }
        // Username provided but no existing mapping (first time use of this custom name)
        player.name = username.trim();
      }

      // Ensure uniqueness of randomly (or user) chosen name before storing
      let base = player.name;
      let attempt = 1;
      while (usernameToPlayer.has(player.name)) {
        attempt += 1;
        player.name = `${base}${attempt}`;
      }
      usernameToPlayer.set(player.name, player);
      socket.emit("assignUsername", { username: player.name });
      console.log(`New user assigned: ${player.name}`);
    });

    // Frontend requests a random username explicitly if none in localStorage
    socket.on("requestRandomUsername", () => {
      if (!usernameToPlayer.has(player.name)) {
        usernameToPlayer.set(player.name, player);
      }
      socket.emit("assignUsername", { username: player.name });
      console.log(`Random username issued: ${player.name}`);
    });

    /** Update username */
    socket.on("updateUsername", ({ username }) => {
      if (username?.trim()) {
        player.name = username.trim();
        console.log(`Updated username to: ${player.name}`);
      }
    });

    /** Get all rooms */
    socket.on("requestRoomList", () => {
      broadcastRoomList(io, rooms);
    });

    /** Join or create room */
    socket.on("joinRoom", ({ roomName, playerName }) => {
      let room = rooms.get(roomName);
      if (!room) {
        room = new Room(roomName, socket.id);
        rooms.set(roomName, room);
        console.log(`Room created: ${room.id}, owner id: ${socket.id}`);
      }

      player.name = playerName;
      player.room = room.name;

      room.addPlayer(player);
      socket.join(room.id);

      broadcastRoomUpdate(io, room);
      broadcastRoomList(io, rooms);
    });

    /** Start AI-only game */
    socket.on("startAIGame", ({ roomName, playerName, aiCount, difficulty }) => {
      if (aiCount > 3) {
        socket.emit("joinAIGameError", { message: "Max 4 players per room." });
        return;
      }

      if (rooms.has(roomName)) {
        socket.emit("joinAIGameError", { message: "Room already exists." });
        return;
      }

      const room = new Room(roomName, socket.id);
      rooms.set(roomName, room);

      player.name = playerName;
      player.room = room.name;
      room.addPlayer(player);
      socket.join(room.id);

      for (let i = 0; i < aiCount; i++) {
        addAIPlayer(io, socket, roomName, difficulty, true);
      }

      broadcastRoomUpdate(io, room);

      room.status = "playing";
      room.gameState = new GameState(room.players);
      broadcastGameState(io, room);

      if (room.gameState.getCurrentPlayer().isAI) {
        processAITurn(io, room);
      }

      io.to(room.id).emit("gameStarted");
      broadcastRoomList(io, rooms);
    });

    /** Add AI */
    socket.on("addAI", ({ roomName, difficulty }) => {
      addAIPlayer(io, socket, roomName, difficulty);
    });

    /** Remove player (creator only) */
    socket.on("removePlayer", ({ roomName, playerName }) => {
      const room = rooms.get(roomName);
      if (!room) return;
      if (room.creatorID !== socket.id) {
        socket.emit("gameError", { message: "Only the creator can remove players." });
        return;
      }

      room.players = room.players.filter((p) => p.name !== playerName);
      broadcastRoomUpdate(io, room);
      broadcastRoomList(io, rooms);
    });

    /** Handle game move */
    socket.on("processMove", ({ roomName, cards = [] }) => {
      const room = rooms.get(roomName);
      if (!room || room.status !== "playing") {
        socket.emit("gameError", { message: "Game not active." });
        return;
      }

      const current = room.gameState.getCurrentPlayer();
      if (current.id !== socket.id && !current.isAI) {
        socket.emit("gameError", { message: "Not your turn." });
        return;
      }

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
    socket.on("startGame", ({ roomName }) => {
      const room = rooms.get(roomName);
      if (!room) {
        socket.emit("gameError", { message: "Room not found." });
        return;
      }
      if (room.creatorID !== socket.id) {
        socket.emit("gameError", { message: "Only the creator can start the game." });
        return;
      }

      room.status = "playing";
      room.gameState = new GameState(room.players);
      broadcastGameState(io, room);

      const first = room.gameState.getCurrentPlayer();
      if (first.isAI) processAITurn(io, room);

      io.to(room.id).emit("gameStarted");
      broadcastRoomList(io, rooms);
    });

    /** Leave room */
    socket.on("leaveRoom", () => {
      const room = rooms.get(player.room);
      if (!room) return;

      if (room.creatorID === socket.id) {
        room.players.forEach((p) => {
          if (p.id !== socket.id) io.to(p.id).emit("forceLeave");
        });
        rooms.delete(room.name);
      } else {
        room.removePlayer(socket.id);
        socket.leave(room.id);
        if (room.isEmpty()) rooms.delete(room.name);
        else broadcastRoomUpdate(io, room);
      }

      player.room = null;
      broadcastRoomList(io, rooms);
    });

    /** Disconnect cleanup */
    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id}`);
      // Preserve usernameToPlayer mapping to allow seamless reconnection.
      // (Optionally implement TTL/cleanup later.)

      const room = rooms.get(player.room);
      if (!room) return;

      if (room.creatorID === socket.id) {
        room.players.forEach((p) => io.to(p.id).emit("forceLeave"));
        rooms.delete(room.name);
      } else {
        room.removePlayer(socket.id);
        if (room.isEmpty()) rooms.delete(room.name);
        else broadcastRoomUpdate(io, room);
      }

      broadcastRoomList(io, rooms);
    });
  });
}
