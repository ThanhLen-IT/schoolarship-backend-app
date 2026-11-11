const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sharp = require("sharp");
const express = require("express");
const { createRequestLogger } = require("../src/middlewares/requestLogger");
const { errorHandler } = require("../src/middlewares/errorHandler");

test(
  "mobile completion: real HTTP, authorization and PostgreSQL SQL",
  { timeout: 60000 },
  async (t) => {
    const db = new PGlite();
    await db.exec(
      await fs.readFile(
        path.join(__dirname, "fixtures/database-v1-schema.sql"),
        "utf8",
      ),
    );
    await db.exec("SET search_path TO public");
    for (const migration of [
      "20261110_midterm_mentor_ranking.sql",
      "20261111_mobile_completion.sql",
    ])
      await db.exec(
        await fs.readFile(
          path.join(__dirname, "../migrations", migration),
          "utf8",
        ),
      );
    // Migrations are safe to run again on the existing schema.
    await db.exec(
      await fs.readFile(
        path.join(__dirname, "../migrations/20261111_mobile_completion.sql"),
        "utf8",
      ),
    );
    const pool = {
      query: (sql, params) => db.query(sql, params),
      connect: async () => ({
        query: (sql, params) => db.query(sql, params),
        release() {},
      }),
    };
    const key = require.resolve("../src/config/db");
    require.cache[key] = {
      id: key,
      filename: key,
      loaded: true,
      exports: pool,
    };
    const priorSecret = process.env.JWT_SECRET,
      priorBase = process.env.PUBLIC_BASE_URL;
    process.env.JWT_SECRET = "mobile-test-only-secret";
    const password = " TestPassword123 ";
    const hash = await bcrypt.hash(password, 4);
    const user = (
      await db.query(
        "INSERT INTO users(email,password_hash,full_name) VALUES('mentee@example.test',$1,'Mentee') RETURNING id",
        [hash],
      )
    ).rows[0].id;
    const mentor = (
      await db.query(
        "INSERT INTO users(email,password_hash,full_name,role,is_mentor) VALUES('mentor@example.test',$1,'Mentor','mentor',TRUE) RETURNING id",
        [hash],
      )
    ).rows[0].id;
    const other = (
      await db.query(
        "INSERT INTO users(email,password_hash,full_name) VALUES('other@example.test',$1,'Other') RETURNING id",
        [hash],
      )
    ).rows[0].id;
    const scholarship = (
      await db.query(
        "INSERT INTO scholarships(title,organization,country,type,majors,study_levels,status) VALUES('Visible','School','Testland','full',ARRAY['Networks'],ARRAY['master'],'published') RETURNING id",
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO scholarships(title,organization,country,type,study_levels,status) VALUES('Private','School','Hiddenland','private',ARRAY['doctoral'],'pending')",
    );
    await db.query(
      "INSERT INTO mentor_verifications(user_id,scholarship_id,evidence_file_url,status) VALUES($1,$2,'fixture.pdf','approved')",
      [mentor, scholarship],
    );
    const app = express(),
      logs = [];
    app.use(createRequestLogger({ write: (l) => logs.push(JSON.parse(l)) }));
    app.use(express.json());
    app.use("/api/users", require("../src/routes/userRoutes"));
    app.use("/api/scholarships", require("../src/routes/scholarshipRoutes"));
    app.use("/api/mentoring", require("../src/routes/mentoringRoutes"));
    app.use("/api/mentors", require("../src/routes/mentorRoutes"));
    app.use("/api", require("../src/routes/mobileRoutes"));
    app.get(
      "/media/avatars/:file",
      require("../src/controllers/mobileFilesController").serveAvatar,
    );
    app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    process.env.PUBLIC_BASE_URL = base;
    const cleanup = [];
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      for (const file of cleanup) await fs.unlink(file).catch(() => {});
      await db.close();
      if (priorSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = priorSecret;
      if (priorBase === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = priorBase;
    });
    const token = (id) =>
      jwt.sign({ id, role: "admin" }, process.env.JWT_SECRET, {
        expiresIn: "1h",
      }); // forged role must not grant privileges
    async function api(url, { method = "GET", actor = user, body, form } = {}) {
      const headers = { Authorization: "Bearer " + token(actor) };
      if (body) headers["Content-Type"] = "application/json";
      const response = await fetch(base + url, {
        method,
        headers,
        body: form || (body ? JSON.stringify(body) : undefined),
      });
      return { status: response.status, body: await response.json() };
    }
    let application, conversation, message, avatar;
    await t.test("filter values come only from published records", async () => {
      const r = await api("/api/scholarships/filters");
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.data.countries, ["Testland"]);
      assert.deepEqual(r.body.data.types, ["full"]);
      assert.deepEqual(r.body.data.majors, ["Networks"]);
    });
    await t.test(
      "submit private PDF application and notify the actual mentor",
      async () => {
        const form = new FormData();
        form.set("mentor_id", mentor);
        form.set("scholarship_id", scholarship);
        form.set("introduction", "Networks coaching");
        form.set(
          "cv",
          new Blob(["%PDF-1.4\nprivate test CV\n%%EOF"], {
            type: "application/pdf",
          }),
          "cv.pdf",
        );
        const r = await api("/api/mentoring/applications/with-cv", {
          method: "POST",
          form,
        });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        application = r.body.data.id;
        const row = (
          await db.query(
            "SELECT cv_file_url FROM mentee_applications WHERE id=$1",
            [application],
          )
        ).rows[0];
        cleanup.push(
          path.join(__dirname, "../uploads", row.cv_file_url.split("/").pop()),
        );
        const notes = await api("/api/notifications", { actor: mentor });
        assert.equal(notes.body.unread_count, 1);
        assert.equal(notes.body.data[0].reference_id, application);
      },
    );
    await t.test(
      "CV is readable only by application participants",
      async () => {
        let response = await fetch(
          base + "/api/mentoring/applications/" + application + "/cv",
          { headers: { Authorization: "Bearer " + token(mentor) } },
        );
        assert.equal(response.status, 200);
        assert.match(await response.text(), /private test CV/);
        response = await fetch(
          base + "/api/mentoring/applications/" + application + "/cv",
          { headers: { Authorization: "Bearer " + token(other) } },
        );
        assert.equal(response.status, 404);
      },
    );
    await t.test(
      "chat requires accepted mentoring and progress checks actual actors",
      async () => {
        let r = await api("/api/chat/conversations", {
          method: "POST",
          body: { participant_id: mentor },
        });
        assert.equal(r.status, 403);
        r = await api(
          "/api/mentoring/applications/" + application + "/progress",
          { method: "PATCH", body: { action: "accept" } },
        );
        assert.equal(r.status, 403);
        r = await api(
          "/api/mentoring/applications/" + application + "/progress",
          { method: "PATCH", actor: mentor, body: { action: "accept" } },
        );
        assert.equal(r.status, 200, JSON.stringify(r.body));
        r = await api("/api/chat/conversations", {
          method: "POST",
          body: { participant_id: mentor },
        });
        assert.equal(r.status, 200);
        conversation = r.body.data.id;
        const duplicate = await api("/api/chat/conversations", {
          method: "POST",
          actor: mentor,
          body: { participant_id: user },
        });
        assert.equal(duplicate.body.data.id, conversation);
      },
    );
    await t.test(
      "new messages are persisted exactly once across retries",
      async () => {
        const body = {
          message: "Hello Mentor",
          client_message_id: randomUUID(),
        };
        let r = await api(`/api/chat/conversations/${conversation}/messages`, {
          method: "POST",
          body,
        });
        assert.equal(r.status, 201);
        message = r.body.data.id;
        r = await api(`/api/chat/conversations/${conversation}/messages`, {
          method: "POST",
          body,
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.data.id, message);
        const count = await db.query(
          "SELECT COUNT(*)::int AS n FROM chat_messages WHERE conversation_id=$1",
          [conversation],
        );
        assert.equal(count.rows[0].n, 1);
        const count2 = await db.query(
          "SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=$1 AND type='chat'",
          [mentor],
        );
        assert.equal(count2.rows[0].n, 1);
      },
    );
    await t.test(
      "message paging, unread state and membership are enforced",
      async () => {
        let r = await api(`/api/chat/conversations/${conversation}/messages`, {
          actor: other,
        });
        assert.equal(r.status, 404);
        r = await api(`/api/chat/conversations/${conversation}/messages`, {
          actor: mentor,
        });
        assert.equal(r.body.data[0].message, "Hello Mentor");
        assert.equal(r.body.data[0].is_read, false);
        r = await api(`/api/chat/conversations/${conversation}/read`, {
          method: "PATCH",
          actor: other,
          body: { through_id: message },
        });
        assert.equal(r.status, 404);
        r = await api(`/api/chat/conversations/${conversation}/read`, {
          method: "PATCH",
          actor: mentor,
          body: { through_id: message },
        });
        assert.equal(r.status, 200);
        r = await api("/api/chat/conversations", { actor: mentor });
        assert.equal(r.body.data[0].unread_count, 0);
        r = await api(
          `/api/chat/conversations/${conversation}/messages?after_id=${message}`,
          { actor: mentor },
        );
        assert.deepEqual(r.body.data, []);
      },
    );
    await t.test("notification read is scoped to its owner", async () => {
      let r = await api("/api/notifications", { actor: mentor });
      const n = r.body.data[0].id;
      r = await api(`/api/notifications/${n}/read`, {
        method: "PATCH",
        actor: other,
      });
      assert.equal(r.status, 404);
      r = await api("/api/notifications/read-all", {
        method: "PATCH",
        actor: mentor,
      });
      assert.equal(r.status, 200);
      r = await api("/api/notifications", { actor: mentor });
      assert.equal(r.body.unread_count, 0);
    });
    await t.test("support tickets are stored and private", async () => {
      let r = await api("/api/support/tickets", {
        method: "POST",
        body: { subject: "App feedback", message: "Please help with filters" },
      });
      assert.equal(r.status, 201);
      r = await api("/api/support/tickets");
      assert.equal(r.body.data.length, 1);
      assert.equal(r.body.data[0].subject, "App feedback");
      r = await api("/api/support/tickets", { actor: other });
      assert.deepEqual(r.body.data, []);
    });
    await t.test(
      "only admins can reply to support tickets and replies notify the ticket owner",
      async () => {
        let r = await api("/api/admin/support/tickets", { actor: other });
        assert.equal(r.status, 403);
        await db.query("UPDATE users SET role='admin' WHERE id=$1", [other]);
        r = await api("/api/admin/support/tickets", { actor: other });
        assert.equal(r.status, 200);
        const ticket = r.body.data[0].id;
        r = await api(`/api/admin/support/tickets/${ticket}/reply`, {
          method: "PATCH",
          actor: other,
          body: { response: "We have checked your request" },
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        r = await api("/api/support/tickets");
        assert.equal(
          r.body.data[0].admin_response,
          "We have checked your request",
        );
        r = await api("/api/notifications");
        assert.ok(
          r.body.data.some(
            (n) => n.type === "support" && n.reference_id === ticket,
          ),
        );
        await db.query("UPDATE users SET role='user' WHERE id=$1", [other]);
      },
    );
    await t.test(
      "avatar is decoded, resized, saved and served without exposing private uploads",
      async () => {
        const bytes = await sharp({
          create: { width: 16, height: 16, channels: 3, background: "#ff0000" },
        })
          .png()
          .toBuffer();
        const form = new FormData();
        form.set(
          "avatar",
          new Blob([bytes], { type: "image/png" }),
          "photo.png",
        );
        const r = await api("/api/users/avatar", { method: "POST", form });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        avatar = r.body.data.avatar_url;
        cleanup.push(
          path.join(__dirname, "../media/avatars", avatar.split("/").pop()),
        );
        const response = await fetch(avatar);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /image\/webp/);
        const metadata = await sharp(
          Buffer.from(await response.arrayBuffer()),
        ).metadata();
        assert.equal(metadata.format, "webp");
      },
    );
    await t.test(
      "fake image payload is rejected before changing the profile",
      async () => {
        const form = new FormData();
        form.set(
          "avatar",
          new Blob(["<script>alert(1)</script>"], { type: "image/png" }),
          "fake.png",
        );
        const r = await api("/api/users/avatar", { method: "POST", form });
        assert.equal(r.status, 400);
        const row = (
          await db.query("SELECT avatar_url FROM users WHERE id=$1", [user])
        ).rows[0];
        assert.equal(row.avatar_url, avatar);
      },
    );
    await t.test(
      "mentoring can start, receive support requests and complete",
      async () => {
        let r = await api(
          `/api/mentoring/applications/${application}/progress`,
          { method: "PATCH", actor: mentor, body: { action: "start" } },
        );
        assert.equal(r.status, 200);
        r = await api(
          `/api/mentoring/applications/${application}/response-requests`,
          { method: "POST", body: { request_note: "Review my essay" } },
        );
        assert.equal(r.status, 201);
        const request = r.body.data.id;
        r = await api(`/api/mentoring/response-requests/${request}/respond`, {
          method: "PATCH",
          actor: mentor,
          body: { response_note: "Here is the feedback" },
        });
        assert.equal(r.status, 200);
        r = await api(`/api/mentoring/applications/${application}/progress`, {
          method: "PATCH",
          body: { action: "complete" },
        });
        assert.equal(r.status, 200);
        r = await api("/api/mentoring/applications/mine");
        assert.equal(r.body.data[0].viewer_role, "mentee");
        assert.equal(r.body.data[0].introduction, "Networks coaching");
      },
    );
    await t.test(
      "closing an account requires password, anonymizes it and invalidates old JWTs",
      async () => {
        let r = await api("/api/users/me", {
          method: "DELETE",
          body: { current_password: "incorrect" },
        });
        assert.equal(r.status, 403);
        r = await api("/api/users/me", {
          method: "DELETE",
          body: { current_password: password },
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        r = await api("/api/users/saved");
        assert.equal(r.status, 403);
        const row = (
          await db.query(
            "SELECT email,full_name,avatar_url,is_active FROM users WHERE id=$1",
            [user],
          )
        ).rows[0];
        assert.equal(row.is_active, false);
        assert.equal(row.avatar_url, null);
        assert.notEqual(row.email, "mentee@example.test");
        const cv = (
          await db.query(
            "SELECT cv_file_url,introduction FROM mentee_applications WHERE id=$1",
            [application],
          )
        ).rows[0];
        assert.equal(cv.cv_file_url, "");
        assert.equal(cv.introduction, null);
        assert.equal((await fetch(avatar)).status, 404);
      },
    );
    assert.ok(logs.length > 20);
    assert.ok(!JSON.stringify(logs).includes("private test CV"));
    assert.ok(!JSON.stringify(logs).includes(password));
  },
);
