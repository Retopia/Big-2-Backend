export const rooms = new Map();          // roomName → Room instance
export const usernameToPlayer = new Map(); // username → Player instance

export function cleanupEmptyRooms() {
  for (const [name, room] of rooms.entries()) {
    if (room.isEmpty()) rooms.delete(name);
  }
}