import { query } from "./db.mjs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

export default function registerLeaderboardRoutes(app) {
  app.get("/api/leaderboard", async (req, res) => {
    const limit = parseLimit(req.query?.limit);

    try {
      const result = await query(
        `
          SELECT
            ROW_NUMBER() OVER (
              ORDER BY ratings.rating DESC, ratings.games_played DESC, users.username ASC
            ) AS rank,
            users.id,
            users.username,
            ratings.rating,
            ratings.games_played,
            ratings.wins,
            ratings.losses,
            ratings.updated_at
          FROM ratings
          JOIN users ON users.id = ratings.user_id
          WHERE users.deleted_at IS NULL
          ORDER BY ratings.rating DESC, ratings.games_played DESC, users.username ASC
          LIMIT $1
        `,
        [limit]
      );

      res.json({
        leaderboard: result.rows.map((row) => ({
          rank: Number(row.rank),
          userId: row.id,
          username: row.username,
          rating: Number(row.rating),
          gamesPlayed: Number(row.games_played),
          wins: Number(row.wins),
          losses: Number(row.losses),
          updatedAt: row.updated_at,
        })),
      });
    } catch (error) {
      if (error?.code === "DATABASE_UNAVAILABLE") {
        res.status(503).json({
          message: "Leaderboard storage is not configured. Set DATABASE_URL to enable rankings.",
        });
        return;
      }

      console.error("Leaderboard route error:", error);
      res.status(500).json({ message: "Unable to load leaderboard." });
    }
  });
}
