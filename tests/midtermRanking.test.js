const test = require('node:test');
const assert = require('node:assert/strict');
const { rankMentors, scoreMentor, percent } = require('../src/utils/mentorRanking');

const base = {
  mentor_id: 12, full_name: 'Mentor A', username: 'mentor_a', avatar_url: null,
  university: 'University',
  decided_count: 25, awarded_count: 23,  // 92%
  rating_count: 10, avg_rating: 4.9,       // 98%
  started_count: 25, completed_count: 24, // 96%
  request_count: 50, responded_count: 49  // 98%
};

test('midterm example is 96/100 with equal weights', () => {
  const actual = scoreMentor(base);
  assert.equal(actual.mentee_success_rate, 92);
  assert.equal(actual.average_rating_score, 98);
  assert.equal(actual.mentoring_completion_rate, 96);
  assert.equal(actual.response_rate, 98);
  assert.equal(actual.ranking_score, 96);
  assert.equal(actual.ranking_status, 'established');
});

test('zero denominators mean insufficient data, never artificial 0% or 100%', () => {
  const actual = scoreMentor({
    ...base, decided_count: 0, awarded_count: 0, rating_count: 0,
    started_count: 0, completed_count: 0, request_count: 0,
    responded_count: 0
  });
  assert.equal(actual.mentee_success_rate, null);
  assert.equal(actual.average_rating_score, null);
  assert.equal(actual.mentoring_completion_rate, null);
  assert.equal(actual.response_rate, null);
  assert.equal(actual.ranking_score, null);
  assert.equal(actual.ranking_status, 'insufficient_data');
  assert.equal(percent(0, 0), null);
});

test('insufficient metrics never get an official rank', () => {
  const list = rankMentors([
    { ...base, mentor_id: 13, decided_count: 0, awarded_count: 0 }
  ]);
  assert.equal(list[0].rank, null);
  assert.equal(list[0].ranking_score, null);
});

test('established mentor outranks a provisional mentor with higher raw score', () => {
  const established = { ...base, mentor_id: 12 };
  const provisional = {
    ...base, mentor_id: 13,
    decided_count: 2, awarded_count: 2,
    rating_count: 2, avg_rating: 5,
    started_count: 2, completed_count: 2,
    request_count: 2, responded_count: 2
  };
  const ranked = rankMentors([provisional, established]);
  assert.equal(ranked[0].mentor_id, 12);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].ranking_status, 'established');
  assert.equal(ranked[1].mentor_id, 13);
  assert.equal(ranked[1].ranking_status, 'provisional');
});

test('ties share rank and deterministic sample-size ordering', () => {
  const ranked = rankMentors([{
    ...base, mentor_id: 22, full_name: 'Small Sample',
    decided_count: 10, awarded_count: 9,
    started_count: 10, completed_count: 10,
    request_count: 10, responded_count: 10,
    rating_count: 5, avg_rating: 4.9
  },{
    ...base, mentor_id: 23, full_name: 'Small Sample 2',
    decided_count: 10, awarded_count: 9,
    started_count: 10, completed_count: 10,
    request_count: 10, responded_count: 10,
    rating_count: 5, avg_rating: 4.9
  }]);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1);
  assert.equal(ranked[0].mentor_id, 22);
});

test('percent and score calculations remain numeric and within bounds for valid counts', () => {
  assert.equal(percent(8, 10), 80);
  assert.equal(percent(12, 20), 60);
  assert.equal(percent(95, 100), 95);
});
