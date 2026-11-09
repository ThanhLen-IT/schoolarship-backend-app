const WEIGHTS = Object.freeze({
  success: 0.25,
  rating: 0.25,
  completion: 0.25,
  response: 0.25
});
const MIN_SAMPLE_SIZE = 5;

function asNonNegativeCount(value) {
  const result = Number(value || 0);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function percent(numerator, denominator) {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function scoreMentor(row) {
  const results = asNonNegativeCount(row.decided_count);
  const successes = asNonNegativeCount(row.awarded_count);
  const rated = asNonNegativeCount(row.rating_count);
  const avgRating = rated > 0 ? Number(row.avg_rating) : null;
  const started = asNonNegativeCount(row.started_count);
  const completed = asNonNegativeCount(row.completed_count);
  const requests = asNonNegativeCount(row.request_count);
  const answered = asNonNegativeCount(row.responded_count);

  const successRate = percent(successes, results);
  const ratingScore = rated > 0 && Number.isFinite(avgRating)
    ? Math.round((avgRating / 5) * 10000) / 100
    : null;
  const completionRate = percent(completed, started);
  const responseRate = percent(answered, requests);

  const values = [successRate, ratingScore, completionRate, responseRate];
  const complete = values.every(value => value !== null && Number.isFinite(value));
  const totalScore = complete
    ? Math.round((
        successRate * WEIGHTS.success +
        ratingScore * WEIGHTS.rating +
        completionRate * WEIGHTS.completion +
        responseRate * WEIGHTS.response
      ) * 100) / 100
    : null;
  const sampleCounts = [results, rated, started, requests];
  const sampleSize = sampleCounts.reduce((a, b) => a + b, 0);
  const rankingStatus = !complete
    ? 'insufficient_data'
    : sampleCounts.some(count => count < MIN_SAMPLE_SIZE)
      ? 'provisional'
      : 'established';

  return {
    mentor_id: Number(row.mentor_id),
    full_name: row.full_name,
    username: row.username,
    avatar_url: row.avatar_url,
    university: row.university,
    mentee_success_rate: successRate,
    average_rating: avgRating,
    average_rating_score: ratingScore,
    mentoring_completion_rate: completionRate,
    response_rate: responseRate,
    ranking_score: totalScore,
    ranking_status: rankingStatus,
    sample_counts: {
      decided_mentees: results,
      awarded_mentees: successes,
      reviews: rated,
      started_mentees: started,
      completed_mentees: completed,
      help_requests: requests,
      responded_requests: answered
    },
    _sample_size: sampleSize
  };
}

function rankMentors(rows) {
  const scored = rows.map(scoreMentor);
  scored.sort((a, b) => {
    // A mentor with enough observations outranks provisional samples:
    // 2 perfect reviews must not automatically beat 100 very good reviews.
    const priority = { established: 0, provisional: 1, insufficient_data: 2 };
    const tierDifference = priority[a.ranking_status] - priority[b.ranking_status];
    if (tierDifference !== 0) return tierDifference;
    if (a.ranking_score === null && b.ranking_score !== null) return 1;
    if (a.ranking_score !== null && b.ranking_score === null) return -1;
    if (a.ranking_score !== null && b.ranking_score !== null) {
      const delta = b.ranking_score - a.ranking_score;
      if (delta !== 0) return delta;
    }
    if (a._sample_size !== b._sample_size) return b._sample_size - a._sample_size;
    return a.mentor_id - b.mentor_id;
  });

  let latestScore = null;
  let lastRank = null;
  return scored.map((row, index) => {
    const rank = row.ranking_score === null ? null :
      (latestScore === row.ranking_score &&
       scored[index - 1]?.ranking_status === row.ranking_status
        ? lastRank : index + 1);
    if (rank !== null) {
      latestScore = row.ranking_score;
      lastRank = rank;
    }
    const { _sample_size, ...publicRow } = row;
    return { rank, ...publicRow };
  });
}

module.exports = { WEIGHTS, MIN_SAMPLE_SIZE, percent, scoreMentor, rankMentors };
