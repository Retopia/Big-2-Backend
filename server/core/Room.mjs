import { generateRoomId } from "../utils/id.mjs";

export class Room {
  constructor(name, creatorID) {
    this.id = generateRoomId(name);
    this.name = name;
    this.creatorID = creatorID; // standardized casing
    this.players = [];        // Array of player objects
    this.status = "waiting";  // "waiting" | "playing" | "finished"
    this.gameState = null;    // Instance of GameState
  }

  /** Add a player object */
  addPlayer(player) {
    this.players.push(player);
  }

  /** Remove player by id */
  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
  }

  /** Returns true if all players are AIs or none remain */
  isEmpty() {
    if (this.players.length === 0) return true;
    const aiCount = this.players.filter(p => p.isAI).length;
    return aiCount === this.players.length;
  }

  /** Return player object by id or name */
  findPlayer(identifier) {
    return this.players.find(
      p => p.id === identifier || p.name === identifier
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
      players: this.players,
      creatorID: this.creatorID,
    };
  }
}
