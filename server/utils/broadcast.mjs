/**
 * Send updated room list to all connected clients.
 */
export function broadcastRoomList(io, rooms) {
  io.emit("roomList", { rooms: [...rooms.values()].map(r => r.summary()) });
}

/**
 * Send each player their personalized view of the game state.
 */
export function broadcastGameState(io, room) {
  if (!room.gameState) return;

  room.players.forEach((player) => {
    if (player.isAI || !player.id) return;

    const state = room.gameState;
    const current = state.getCurrentPlayer().name;
    const lastPlayedBy =
      state.lastPlayedHand.length > 0 && state.moveHistory.length > 0
        ? state.moveHistory[state.moveHistory.length - 1].name
        : null;

    const view = {
      hand: state.playerHands[player.name] || [],
      lastPlayedHand: state.lastPlayedHand,
      currentPlayer: current,
      players: room.players.map((p) => ({
        name: p.name,
        cardCount: state.playerHands[p.name]?.length || 0,
        isCurrentPlayer: p.name === current,
      })),
      round: state.round,
      lastPlayedBy,
    };

    io.to(player.id).emit("gameStateUpdate", view);
  });
}

/**
 * Notify all clients in a room of a status change.
 */
export function broadcastRoomUpdate(io, room) {
  io.to(room.id).emit("roomUpdate", {
    players: room.players.map((p) => p.name),
    creatorID: room.creatorID,
  });
}

/**
 * Notify room of game end and reset state later.
 */
export function broadcastGameEnd(io, room, winner, scores) {
  io.to(room.id).emit("gameEnded", { winner, scores });
}
