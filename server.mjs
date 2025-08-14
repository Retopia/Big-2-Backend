import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import crypto from "crypto";
import cors from "cors";
import { GameState } from "./GameState.mjs";

const PORT = 3002;
const app = express();
const server = createServer(app);

const allowedOrigins = [
  "https://big2.prestontang.dev",
  "https://big2.live",
  "https://www.big2.live",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

class Room {
  constructor(name, creatorID) {
    this.id = Room.generateRoomID(name);
    this.name = name;
    this.players = []; // This contains a list of player objects
    this.status = "waiting"; // 3 possibilities, [waiting, playing, finished]
    this.creatorID = creatorID;
  }

  static generateRoomID(name) {
    return crypto.createHash("sha256").update(name).digest("hex").substring(0, 12);
  }

  addPlayer(player) {
    this.players.push(player);
  }

  removePlayer(playerID) {
    this.players = this.players.filter(player => player.id !== playerID);
  }

  isEmpty() {
    // Count number of AI players
    // If it's equal to the length of the players array, the room is empty
    let aiCount = 0;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].isAI) {
        aiCount += 1;
      }
    }

    if (aiCount === this.players.length || this.players.length === 0) {
      return true;
    }

    return false;
  }
}

function generateRandomUsername() {
  const adjectives = ["Swift", "Brave", "Clever", "Witty", "Mighty", "Strong", "Musing"];
  const nouns = ["Lion", "Wolf", "Hippo", "Tiger", "Eagle", "Falcon", "Cheetah", "Cat"];
  return adjectives[Math.floor(Math.random() * adjectives.length)] +
    nouns[Math.floor(Math.random() * nouns.length)] +
    Math.floor(Math.random() * 1000)
}

// Maps room name to Room class
const rooms = new Map();

function broadcastRoomList() {
  io.emit("roomList", { rooms: [...rooms.values()] });
}

// Add these helper functions outside the connection handler
function broadcastGameState(room) {
  // Send each player their own view of the game
  room.players.forEach(player => {
    if (!player.isAI && player.id) {
      const playerView = {
        hand: room.gameState.playerHands[player.name] || [],
        lastPlayedHand: room.gameState.lastPlayedHand,
        currentPlayer: room.gameState.getCurrentPlayer().name,
        players: room.players.map(p => ({
          name: p.name,
          cardCount: room.gameState.playerHands[p.name]?.length || 0,
          isCurrentPlayer: p.name === room.gameState.getCurrentPlayer().name
        })),
        round: room.gameState.round
      };

      io.to(player.id).emit("gameStateUpdate", playerView);
    }
  });
}

function processAITurn(room) {
  setTimeout(() => {
    if (!room.gameState) return;

    const currentPlayer = room.gameState.getCurrentPlayer();

    if (currentPlayer.isAI) {
      const result = room.gameState.handleAITurn(currentPlayer);

      // Check if game ended
      if (result.gameStatus === "finished") {
        // Game over - AI won
        io.to(room.id).emit("gameEnded", {
          winner: result.winner,
          scores: room.gameState.scores
        });

        // Reset game state after a delay
        setTimeout(() => {
          room.status = "waiting";
          room.gameState = null;

          io.to(room.id).emit("roomUpdate", {
            players: room.players.map(p => p.name),
            creatorID: room.creatorID
          });

          broadcastRoomList();
        }, 5000);

        return;
      }

      // Broadcast updated state
      broadcastGameState(room);

      // If next player is also AI, continue chain
      if (room.gameState.getCurrentPlayer().isAI) {
        processAITurn(room);
      }
    }
  }, 100); // 1 second delay for AI "thinking"
}

function addAIPlayer(roomName, socket, difficulty, broadcast) {
  const room = rooms.get(roomName);
  if (!room) return;

  if (room.creatorID !== socket.id) {
    socket.emit("gameError", { message: "Only the creatorID can add AI" });
    return;
  }

  if (room.players.length >= 4) {
    socket.emit("gameError", { message: "Room is full" });
    return;
  }

  const aiPlayer = {
    id: null,
    name: "AI_" + generateRandomUsername(),
    room: roomName,
    difficulty: difficulty,
    isAI: true
  }

  console.log("Emitting Room Update", room.players.length)
  console.log("Player IDs in room:", room.players.map(p => p.id));
  room.addPlayer(aiPlayer);
  if (!broadcast) {
    io.to(room.id).emit("roomUpdate", {
      players: room.players.map(p => p.name),
      creatorID: room.creatorID
    });
  }
}

const usernameToPlayer = new Map();

io.on("connection", (socket) => {
  console.log("User connected: " + socket.id);

  // Create a player object when socket connects
  let player = {
    id: socket.id,
    name: generateRandomUsername(),
    room: null, // Will be assigned on room join
    isAI: false
  };

  console.log("Current usernameToPlayer map:");
  for (const [username, player] of usernameToPlayer.entries()) {
    console.log(`- ${username}:`, player);
  }

  socket.on("joinOrReconnect", ({ username }) => {
    const existingPlayer = usernameToPlayer.get(username);
    if (existingPlayer) {
      existingPlayer.id = socket.id;
      // Rejoin room if you track it
      if (existingPlayer.room) {
        socket.join(existingPlayer.room);
      }

      player = existingPlayer
      console.log(`${username} reconnected.`);
      console.log(player)
      console.log("Current usernameToPlayer map:");
      for (const [username, player] of usernameToPlayer.entries()) {
        console.log(`- ${username}:`, player);
      }
    } else {
      // Treat as a new player if username doesn't exist
      usernameToPlayer.set(player.name, player);
      socket.emit("assignUsername", { username: player.name });
      console.log(`Username not found. Assigned new: ${player.name}`);
    }
  });

  socket.on("updateUsername", ({ username }) => {
    if (username && username.trim()) {
      player.name = username.trim();
      console.log(`Updated username to: ${username}`);
    }
  });

  socket.on("requestRandomUsername", () => {
    console.log("Setting Random username", player.name)
    usernameToPlayer.set(player.name, player);
    socket.emit("assignUsername", { username: player.name });
  });

  socket.on("requestRoomList", () => {
    broadcastRoomList();
  });

  socket.on("joinRoom", (data) => {
    const roomName = data.roomName;
    let room = rooms.get(roomName);

    if (!room) {
      room = new Room(roomName, socket.id);
      rooms.set(roomName, room);
      console.log("Room created: " + room.id + " Owner: " + room.creatorID);
    }

    player.name = data.playerName;
    player.room = room.name;

    room.addPlayer(player);
    socket.join(room.id);

    io.to(room.id).emit("roomUpdate", {
      players: room.players.map(p => p.name),
      creatorID: room.creatorID
    });

    broadcastRoomList();
  });

  socket.on("startAIGame", ({ roomName, playerName, aiCount, difficulty }) => {
    if (aiCount > 3) {
      socket.emit("joinAIGameError", { message: "There can't be more than 4 players in a room!" });
    }

    let room = rooms.get(roomName);

    if (room) {
      // This should never happen
      socket.emit("joinAIGameError", { message: "Please try again (room name already taken)" });
      return
    }

    room = new Room(roomName, socket.id);
    rooms.set(roomName, room);
    console.log("AI Game Room created: " + room.id + " Owner: " + room.creatorID);

    player.name = playerName;
    player.room = room.name;

    room.addPlayer(player);

    socket.join(room.id);

    for (let i = 0; i < aiCount; i++) {
      addAIPlayer(roomName, socket, difficulty, false);
    }

    // We emit here instead of aiCount times in addAIPlayer
    io.to(room.id).emit("roomUpdate", {
      players: room.players.map(p => p.name),
      creatorID: room.creatorID
    });

    room.status = "playing";

    // Initialize game state
    room.gameState = new GameState(room.players);

    // Broadcast initial game state
    broadcastGameState(room);

    // Start AI turn if first player is AI
    const firstPlayer = room.gameState.getCurrentPlayer();
    if (firstPlayer.isAI) {
      processAITurn(room);
    }

    io.to(room.id).emit("gameStarted");
    broadcastRoomList();
  });

  socket.on("addAI", ({ roomName }) => {
    addAIPlayer(roomName, socket, undefined, false);
  });

  socket.on("removePlayer", ({ roomName, playerName }) => {
    const room = rooms.get(roomName);
    if (!room) return;

    if (room.creatorID !== socket.id) {
      socket.emit("gameError", { message: "Only the creatorID can remove players" });
      return;
    }

    console.log("Removing player " + playerName);

    // Check if removing AI player
    if (playerName.startsWith("AI_")) {
      room.players = room.players.filter(p => !p.isAI || p.name !== playerName);
    } else {
      // Find the player by name
      const playerIndex = room.players.findIndex(p => p.name === playerName);

      if (playerIndex !== -1) {
        const removedPlayer = room.players[playerIndex];
        room.players.splice(playerIndex, 1); // Remove the player from the room

        // Notify the player they are removed
        io.to(removedPlayer.id).emit("forceLeave");
        io.in(removedPlayer.id).socketsLeave(room.id);
      }
    }

    // Emit updated player list to the room
    io.to(room.id).emit("roomUpdate", {
      players: room.players.map(p => p.name),
      creatorID: room.creatorID
    });

    broadcastRoomList();
  });

  // Socket handler for all moves
  socket.on("processMove", ({ roomName, cards = [] }) => {
    const room = rooms.get(roomName);

    if (!room || room.status !== "playing") {
      socket.emit("gameError", { message: "Game not active" });
      return;
    }

    // Check if it's this player's turn
    const currentPlayer = room.gameState.getCurrentPlayer();
    if (currentPlayer.id !== socket.id && !currentPlayer.isAI) {
      socket.emit("gameError", { message: "Not your turn" });
      return;
    }

    let result;

    // Empty cards array means pass
    if (cards.length === 0) {
      result = room.gameState.passTurn(player.name);
    } else {
      result = room.gameState.playCards(player.name, cards);
    }

    if (!result.success) {
      socket.emit("gameError", { message: result.message });
      return;
    }

    // Check if game ended
    if (result.gameStatus === "finished") {
      io.to(room.id).emit("gameEnded", {
        winner: result.winner,
        scores: room.gameState.scores
      });

      // Reset all player's room to null
      for (let i = 0; i < room.players.length; i++) {
        room.players[i].room = null;
      }

      // Reset game state after a delay
      setTimeout(() => {
        room.status = "waiting";
        room.gameState = null;

        io.to(room.id).emit("roomUpdate", {
          players: room.players.map(p => p.name),
          creatorID: room.creatorID
        });

        broadcastRoomList();
      }, 1000);

      return;
    }

    // Broadcast updated game state
    broadcastGameState(room);

    // Handle AI turn if next player is AI
    const nextPlayer = room.gameState.getCurrentPlayer();
    if (nextPlayer.isAI) {
      processAITurn(room);
    }
  });

  socket.on("startGame", ({ roomName }) => {
    const room = rooms.get(roomName);

    if (!room) {
      socket.emit("gameError", { message: "Room not found" });
      return;
    }

    if (room.creatorID !== socket.id) {
      socket.emit("gameError", { message: "Only the room creator can start the game" });
      return;
    }

    room.status = "playing";

    // Initialize game state
    room.gameState = new GameState(room.players);

    // Broadcast initial game state
    broadcastGameState(room);

    // Start AI turn if first player is AI
    const firstPlayer = room.gameState.getCurrentPlayer();
    if (firstPlayer.isAI) {
      processAITurn(room);
    }

    io.to(room.id).emit("gameStarted");
    broadcastRoomList();
  });

  socket.on("leaveRoom", () => {
    // If the room the player is in does not exist for some reason do nothing
    const room = rooms.get(player.room);

    if (!room) {
      return;
    }

    if (room.creatorID === socket.id) {
      console.log("Room creator left. Deleting room:", room.name);

      // Notify all players that they are being removed
      room.players.forEach(p => {
        if (p.id !== socket.id) {
          io.to(p.id).emit("forceLeave"); // Tell them they're being removed
          io.in(p.id).socketsLeave(room.id); // Remove them from the socket room
          p.room = null;
        }
      });

      room.players = [];

      rooms.delete(player.room); // Delete the room
    } else {
      room.removePlayer(socket.id);
      socket.leave(player.room);

      console.log(socket.id + " left room " + player.room);

      if (room.isEmpty()) {
        rooms.delete(player.room);
        console.log("Room " + player.room + " deleted due to inactivity");
      } else {
        io.to(room.id).emit("roomUpdate", {
          players: room.players.map(p => p.name),
          creatorID: room.creatorID
        });
      }

      player.room = null;
    }

    broadcastRoomList();
  });

  socket.on("disconnect", () => {
    console.log("User disconnected: " + socket.id);
    console.log(`Current usernameToPlayer map size: ${usernameToPlayer.size}`);

    // Remove from map
    for (const [username, playerData] of usernameToPlayer.entries()) {
      if (playerData.id === socket.id) {
        console.log(`Removing ${username} from usernameToPlayer map`);
        usernameToPlayer.delete(username);
        break;
      }
    }

    const room = rooms.get(player.room);
    if (!room) return;

    // If the person that disconnected is the creator, delete the room and remove all players
    if (room.creatorID === socket.id) {
      console.log("Room creator left. Deleting room:", room.name);

      // Notify all players that they are being removed
      room.players.forEach(p => {
        if (p.id !== socket.id) {
          io.to(p.id).emit("forceLeave"); // Tell them they're being removed
          io.in(p.id).socketsLeave(room.id); // Remove them from the socket room
          p.room = null;
        }
      });

      room.players = [];

      rooms.delete(player.room); // Delete the room
    } else {
      room.removePlayer(socket.id);
      socket.leave(player.room);

      console.log(socket.id + " was removed from room " + player.room);
      if (room.isEmpty()) {
        rooms.delete(player.room);
        console.log("Room " + player.room + " deleted due to inactivity");
      } else {
        io.to(room.id).emit("roomUpdate", {
          players: room.players.map(p => p.name),
          creatorID: room.creatorID
        });
      }
    }

    broadcastRoomList();
  });
});

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Start server
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
