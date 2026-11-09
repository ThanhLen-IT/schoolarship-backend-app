# User Profile, Username & Community API

Checked against the existing `Database-v1.0` schema:
`users.username` (varchar(30), check lower-case alphanumeric/_ 3–30), unique
`uq_users_username_lower` index, `users.major`, `users.skills`,
`saved_scholarships`, `posts`, `post_likes`, `comments`.

**No migration or direct database changes are required for this PR.**

## Username and Profile

- `username` is a public **handle**, not a replacement for the immutable numeric `users.id`.
- Accept `@KimLoan12` on registration/profile update, save `kimloan12` in the DB.
- If a username conflicts case-insensitively, PostgreSQL's existing unique index rejects it and the API responds HTTP 409.
- Leaving `username` absent at registration preserves backward compatibility; setting it to `null` in profile update clears it.
- Newly registered accounts require a password of 8–72 UTF-8 bytes.
- All stored new account emails are lower-case; login supports case-insensitive email lookup.
- Role, XP, mentor flags and account status **cannot be updated** by profile API.

| Method | Endpoint | Auth | Body/Notes |
|---|---|---|---|
| POST | `/api/auth/register` | Public | `{email, password, full_name, username?, university?, major?}` |
| POST | `/api/auth/login` | Public | Existing `{email,password}`, or `{username:"@kimloan12",password}`, or `{identifier:"@kimloan12",password}` |
| GET | `/api/auth/me` | JWT | Adds `username`, `major`, `skills` |
| PUT | `/api/users/profile` | JWT | One or more of `full_name`, `username`, `university`, `major`, `bio`, `skills`, `avatar_url` |
| POST | `/api/users/saved/:scholarshipId` | JWT | Save published scholarship; 404 if unpublished |
| DELETE | `/api/users/saved/:scholarshipId` | JWT | Remove bookmark (idempotent) |
| GET | `/api/users/saved` | JWT | Only published scholarships, sanitized `content_html`, no original HTML/moderation metadata |

Profile update validation:
- `full_name`: required nonblank when supplied, max 100 characters.
- `university`, `major`: nullable, max 150 characters each.
- `bio`: nullable, max 3000 characters.
- `skills`: nullable or array of up to 30 strings, each 1–80 chars (deduplicated).
- `avatar_url`: nullable or absolute HTTP(S) URL, max 2048 chars.
- `username`: nullable or `^[a-z0-9_]{3,30}$` after lowercase and optional `@` prefix.

## Community

The previously existing `postRoutes.js` was not mounted in `src/app.js`. It is now served under `/api/posts`.

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/api/posts?page=1&limit=10&search=&scholarship_id=` | Public | Paginated results with a real total count; limits 1–100 |
| GET | `/api/posts/:id` | Public | Post detail |
| POST | `/api/posts` | JWT | `{title,content,scholarship_id?,image_url?}` |
| POST | `/api/posts/:id/like` | JWT | Toggle like; return `is_liked` and `like_count` |
| GET | `/api/posts/:id/comments?page=1&limit=50` | Public | Chronological paginated comments |
| POST | `/api/posts/:id/comments` | JWT | `{content, parent_id?}`, max 3000 chars |

Only posts from active authors and posts with no associated scholarship or an associated **published** scholarship are visible through public routes. A new post cannot reference a scholarship not yet published.

Likes and comments now serialize on the parent post row using a DB transaction and recompute counters from the corresponding rows. A parent comment must belong to the same post, preventing cross-post comment trees.

## Testing

```bash
npm ci
npm test
```

This runs the existing scholarship HTML tests plus the new user/community test suite.
The tests use mocks for controllers; real PostgreSQL, concurrent client traffic and Express integration must still be tested before production.

Suggested manual tests:
1. Register a user with `username="@kimloan12"`, try same handle with different case, expect 409.
2. Log in with existing email flow and then `{username:"@kimloan12",password:"..."}`.
3. Update profile with `{major:"Mạng máy tính",skills:["TCP/IP","SQL"]}`. Try `{role:"admin"}` and expect 400.
4. View `GET /api/auth/me` and verify `username`, `major`, `skills`.
5. List saved scholarships; no `original_content_html`, `rejection_reason`, `reviewed_by`.
6. Create an independent post (without `scholarship_id`) and a post about a published scholarship. Posting about a pending scholarship should return 404.
7. Like the same post twice; like count returns to its original value.
8. Post a comment, then reply with `parent_id`. A parent comment from another post should return 400.
9. Check that `GET /api/posts` includes `total` across all pages, not only the page length.
10. Test the endpoints in Android and the Web Admin if it consumes these APIs.

## Not changed
- DB schema, database records, data migrations, and role management.
- Deletion/editing of community posts/comments and moderation tools are **not** implemented by this PR.
- Existing mobile UI may need updates to show username/major and interpret paginated comments.
