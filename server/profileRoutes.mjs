import { query } from "./db.mjs";

const RECENT_MATCH_LIMIT = 20;
const DEFAULT_RATING = 1500;

export default function registerProfileRoutes(app) {
  app.get("/api/users/:userId/profile", async (req, res) => {
    const userId = req.params?.userId;
    if (!userId) {
      res.status(400).json({ message: "User id is required." });
      return;
    }

    try {
      const userResult = await query(
        `
          SELECT
            users.id,
            users.username,
            users.created_at,
            ratings.rating,
            ratings.games_played,
            ratings.wins,
            ratings.losses
          FROM users
          LEFT JOIN ratings ON ratings.user_id = users.id
          WHERE users.id = $1
          LIMIT 1
        `,
        [userId]
      );

      const userRow = userResult.rows[0];
      if (!userRow) {
        res.status(404).json({ message: "Player not found." });
        return;
      }

      // 1-based leaderboard rank: how many players outrank this user, plus one.
      const rankResult = await query(
        `
          SELECT COUNT(*) + 1 AS rank
          FROM ratings r
          JOIN ratings me ON me.user_id = $1
          WHERE r.rating > me.rating
        `,
        [userId]
      );

      const matchesResult = await query(
        `
          SELECT
            mp.match_id,
            mp.placement,
            mp.cards_remaining,
            mp.rating_before,
            mp.rating_after,
            mp.rating_delta,
            mp.created_at,
            m.room_name,
            m.player_count,
            m.rated,
            m.winner_user_id,
            m.ended_at
          FROM match_participants mp
          JOIN matches m ON m.id = mp.match_id
          WHERE mp.user_id = $1
          ORDER BY mp.created_at DESC
          LIMIT $2
        `,
        [userId, RECENT_MATCH_LIMIT]
      );

      res.json({
        user: {
          id: userRow.id,
          username: userRow.username,
          rating: Number(userRow.rating ?? DEFAULT_RATING),
          gamesPlayed: Number(userRow.games_played ?? 0),
          wins: Number(userRow.wins ?? 0),
          losses: Number(userRow.losses ?? 0),
          rank: Number(rankResult.rows[0]?.rank ?? 0),
          memberSince: userRow.created_at,
        },
        recentMatches: matchesResult.rows.map((row) => ({
          matchId: row.match_id,
          roomName: row.room_name,
          playerCount: Number(row.player_count),
          rated: Boolean(row.rated),
          won: row.winner_user_id === userRow.id,
          placement: row.placement != null ? Number(row.placement) : null,
          cardsRemaining:
            row.cards_remaining != null ? Number(row.cards_remaining) : null,
          ratingBefore:
            row.rating_before != null ? Number(row.rating_before) : null,
          ratingAfter: row.rating_after != null ? Number(row.rating_after) : null,
          ratingDelta: row.rating_delta != null ? Number(row.rating_delta) : null,
          playedAt: row.ended_at || row.created_at,
        })),
      });
    } catch (error) {
      if (error?.code === "DATABASE_UNAVAILABLE") {
        res.status(503).json({
          message: "Profile storage is not configured. Set DATABASE_URL to enable profiles.",
        });
        return;
      }

      console.error("Profile route error:", error);
      res.status(500).json({ message: "Unable to load profile." });
    }
  });
}
