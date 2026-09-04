/** Per-connection data attached at WebSocket upgrade. Leaf module (no imports). */
export interface SocketData {
  pin: string;
  role: "host" | "player";
  /** set after PLAYER_JOIN / PLAYER_REJOIN */
  playerId: string | null;
  /** set for a verified host */
  teacherId: string | null;
}
