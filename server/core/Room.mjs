import { generateRoomId } from "../utils/id.mjs";

export class Room {
  constructor(name, creatorID, options = {}) {
    this.id = generateRoomId(name);
    this.name = name;
    this.creatorID = creatorID; // standardized casing
    this.players = [];        // Array of player objects
    this.status = "waiting";  // "waiting" | "playing" | "finished"
    this.gameState = null;    // Instance of GameState
    this.rated = Boolean(options.rated);
  }

  /** Add a player object */
  addPlayer(player) {
    if (!player?.name) {
      return { success: false, message: "Invalid player." };
    }

    if (this.players.length >= 4) {
      return { success: false, message: "Room is full." };
    }

    if (
      player.participantId &&
      this.players.some((p) => p.participantId && p.participantId === player.participantId)
    ) {
      return { success: false, message: "Player already in room." };
    }

    if (this.players.some((p) => p.name === player.name)) {
      return { success: false, message: "Username is already taken in this room." };
    }

    this.players.push(player);
    return { success: true };
  }

  /** Remove player by stable participant id */
  removePlayer(participantId) {
    this.players = this.players.filter(p => p.participantId !== participantId);
  }

  /** Returns true if all players are AIs or none remain */
  isEmpty() {
    if (this.players.length === 0) return true;
    const aiCount = this.players.filter(p => p.isAI).length;
    return aiCount === this.players.length;
  }

  /** Return player object by socket id, participant id, or name */
  findPlayer(identifier) {
    return this.players.find(
      p => p.id === identifier || p.participantId === identifier || p.name === identifier
    );
  }

  /** Check if player is room creator */
  isCreator(playerId) {
    return this.creatorID === playerId;
  }

  /** Reset after game finishes */
  reset() {
    this.status = "waiting";
    this.gameState = null;
    this.players.forEach(p => (p.room = null));
  }

  /** Return lightweight summary for room list broadcast */
  summary() {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      rated: this.rated,
      players: this.players.map((player) => ({
        name: player.name,
        connected: Boolean(player.connected || player.isAI),
        isAI: Boolean(player.isAI),
        hasAccount: Boolean(player.userId),
        rating: player.rating || null,
      })),
      creatorID: this.creatorID,
    };
  }
}
