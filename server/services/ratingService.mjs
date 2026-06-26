import { hasDatabaseConfig, query, withTransaction } from "../db.mjs";
import { generateUserId } from "../utils/id.mjs";

const DEFAULT_RATING = 1000;
const K_FACTOR = 32;

function expectedScore(playerRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

async function ensureRatings(userIds) {
  for (const userId of userIds) {
    await query(
      `
        INSERT INTO ratings (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
      `,
      [userId]
    );
  }
}

async function getRatings(userIds) {
  await ensureRatings(userIds);
  const result = await query(
    "SELECT user_id, rating FROM ratings WHERE user_id = ANY($1)",
    [userIds]
  );

  const ratings = new Map();
  result.rows.forEach((row) => {
    ratings.set(row.user_id, Number(row.rating || DEFAULT_RATING));
  });
  userIds.forEach((userId) => {
    if (!ratings.has(userId)) ratings.set(userId, DEFAULT_RATING);
  });
  return ratings;
}

export async function recordGameResult(room, winnerName) {
  if (!room?.rated || !hasDatabaseConfig()) return null;

  const humanPlayers = room.players.filter((player) => !player.isAI);
  const winner = humanPlayers.find((player) => player.name === winnerName);

  if (
    !winner ||
    humanPlayers.length < 2 ||
    humanPlayers.some((player) => !player.userId)
  ) {
    return null;
  }

  const userIds = humanPlayers.map((player) => player.userId);

  try {
    const ratingsBefore = await getRatings(userIds);
    const deltas = new Map(userIds.map((userId) => [userId, 0]));
    const winnerRating = ratingsBefore.get(winner.userId) || DEFAULT_RATING;

    humanPlayers.forEach((opponent) => {
      if (opponent.userId === winner.userId) return;

      const opponentRating = ratingsBefore.get(opponent.userId) || DEFAULT_RATING;
      const winnerDelta = Math.round(
        K_FACTOR * (1 - expectedScore(winnerRating, opponentRating))
      );
      const loserDelta = Math.round(
        K_FACTOR * (0 - expectedScore(opponentRating, winnerRating))
      );

      deltas.set(winner.userId, (deltas.get(winner.userId) || 0) + winnerDelta);
      deltas.set(opponent.userId, (deltas.get(opponent.userId) || 0) + loserDelta);
    });

    const matchId = generateUserId();

    // All rating/match writes must be atomic: a mid-loop failure would otherwise
    // leave Elo non-zero-sum (some players updated, others not) and orphan match rows.
    await withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO matches (id, room_name, player_count, rated, winner_user_id, ended_at)
          VALUES ($1, $2, $3, TRUE, $4, NOW())
        `,
        [matchId, room.name, humanPlayers.length, winner.userId]
      );

      for (const player of humanPlayers) {
        const before = ratingsBefore.get(player.userId) || DEFAULT_RATING;
        const delta = deltas.get(player.userId) || 0;
        const after = before + delta;
        const won = player.userId === winner.userId;

        await client.query(
          `
            UPDATE ratings
            SET
              rating = $2,
              games_played = games_played + 1,
              wins = wins + $3,
              losses = losses + $4,
              updated_at = NOW()
            WHERE user_id = $1
          `,
          [player.userId, after, won ? 1 : 0, won ? 0 : 1]
        );

        await client.query(
          `
            INSERT INTO match_participants (
              id,
              match_id,
              user_id,
              display_name,
              placement,
              cards_remaining,
              rating_before,
              rating_after,
              rating_delta
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            generateUserId(),
            matchId,
            player.userId,
            player.name,
            won ? 1 : 2,
            room.gameState?.playerHands?.[player.name]?.length ?? null,
            before,
            after,
            delta,
          ]
        );
      }
    });

    // Only mirror the new ratings onto the in-memory players after the commit.
    for (const player of humanPlayers) {
      player.rating = (ratingsBefore.get(player.userId) || DEFAULT_RATING) +
        (deltas.get(player.userId) || 0);
    }

    return { matchId, rated: true };
  } catch (error) {
    if (error?.code !== "DATABASE_UNAVAILABLE") {
      console.error("Failed to record rated game:", error);
    }
    return null;
  }
}

/**
 * Record a ranked game that ended because a player abandoned it (timed out on
 * their turn or left mid-game). The leaver is treated as having lost a pairwise
 * Elo match to EACH remaining human (zero-sum vs them); the survivors each take
 * the corresponding gain and a forfeit win. No single winner is recorded.
 *
 * `leaver` and `remainingHumans` must be captured by the caller BEFORE the room
 * is mutated. Safe to call fire-and-forget.
 */
export async function recordAbandonment(room, leaver, remainingHumans) {
  if (!room?.rated || !hasDatabaseConfig()) return null;
  if (!leaver || leaver.isAI || !leaver.userId) return null;

  const survivors = (remainingHumans || []).filter(
    (p) => p && !p.isAI && p.userId && p.userId !== leaver.userId
  );
  if (survivors.length === 0) return null;

  const userIds = [leaver.userId, ...survivors.map((p) => p.userId)];

  try {
    const ratingsBefore = await getRatings(userIds);
    const deltas = new Map(userIds.map((userId) => [userId, 0]));
    const leaverRating = ratingsBefore.get(leaver.userId) || DEFAULT_RATING;

    survivors.forEach((survivor) => {
      const survivorRating = ratingsBefore.get(survivor.userId) || DEFAULT_RATING;
      const survivorDelta = Math.round(
        K_FACTOR * (1 - expectedScore(survivorRating, leaverRating))
      );
      const leaverDelta = Math.round(
        K_FACTOR * (0 - expectedScore(leaverRating, survivorRating))
      );
      deltas.set(survivor.userId, (deltas.get(survivor.userId) || 0) + survivorDelta);
      deltas.set(leaver.userId, (deltas.get(leaver.userId) || 0) + leaverDelta);
    });

    const matchId = generateUserId();
    const participants = [
      { player: leaver, won: false },
      ...survivors.map((player) => ({ player, won: true })),
    ];

    await withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO matches (id, room_name, player_count, rated, winner_user_id, ended_at)
          VALUES ($1, $2, $3, TRUE, NULL, NOW())
        `,
        [matchId, room.name, participants.length]
      );

      for (const { player, won } of participants) {
        const before = ratingsBefore.get(player.userId) || DEFAULT_RATING;
        const delta = deltas.get(player.userId) || 0;
        const after = before + delta;

        await client.query(
          `
            UPDATE ratings
            SET
              rating = $2,
              games_played = games_played + 1,
              wins = wins + $3,
              losses = losses + $4,
              updated_at = NOW()
            WHERE user_id = $1
          `,
          [player.userId, after, won ? 1 : 0, won ? 0 : 1]
        );

        await client.query(
          `
            INSERT INTO match_participants (
              id, match_id, user_id, display_name, placement,
              cards_remaining, rating_before, rating_after, rating_delta
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            generateUserId(),
            matchId,
            player.userId,
            player.name,
            won ? 1 : 2,
            null,
            before,
            after,
            delta,
          ]
        );
      }
    });

    participants.forEach(({ player }) => {
      player.rating =
        (ratingsBefore.get(player.userId) || DEFAULT_RATING) +
        (deltas.get(player.userId) || 0);
    });

    return { matchId, rated: true, abandoned: true };
  } catch (error) {
    if (error?.code !== "DATABASE_UNAVAILABLE") {
      console.error("Failed to record abandoned game:", error);
    }
    return null;
  }
}
