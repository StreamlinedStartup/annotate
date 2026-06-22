migrate((app) => {
  const sessions = new Collection({
    type: "base",
    name: "review_sessions",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "slug", type: "text", required: true, max: 120 },
      { name: "publicKey", type: "text", required: true, max: 160, hidden: true },
      { name: "name", type: "text", max: 160 },
      { name: "project", type: "text", max: 160 },
      { name: "enabled", type: "bool", required: true },
      { name: "allowScreenshots", type: "bool" },
      { name: "stripQuery", type: "bool" },
      { name: "retentionDays", type: "number", min: 0 },
      { name: "settings", type: "json" }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_review_sessions_slug ON review_sessions (slug)",
      "CREATE UNIQUE INDEX idx_review_sessions_public_key ON review_sessions (publicKey)"
    ]
  });
  app.save(sessions);

  const origins = new Collection({
    type: "base",
    name: "review_origins",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "session", type: "relation", required: true, maxSelect: 1, collectionId: sessions.id, cascadeDelete: true },
      { name: "origin", type: "text", required: true, max: 512 },
      { name: "enabled", type: "bool", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_review_origins_session_origin ON review_origins (session, origin)"
    ]
  });
  app.save(origins);

  const comments = new Collection({
    type: "base",
    name: "review_comments",
    listRule: "session.publicKey = @request.query.publicKey && pageKey = @request.query.pageKey && deleted = false",
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "session", type: "relation", required: true, maxSelect: 1, collectionId: sessions.id, cascadeDelete: true },
      { name: "pageKey", type: "text", required: true, max: 512 },
      { name: "pageUrl", type: "text", max: 2048 },
      { name: "origin", type: "text", required: true, max: 512 },
      { name: "annotationType", type: "text", required: true, max: 32 },
      { name: "author", type: "text", max: 120 },
      { name: "text", type: "text", required: true, max: 4000 },
      { name: "color", type: "text", max: 32 },
      { name: "anchor", type: "json" },
      { name: "geometry", type: "json" },
      { name: "resolved", type: "bool" },
      { name: "deleted", type: "bool" },
      { name: "clientId", type: "text", max: 120 }
    ],
    indexes: [
      "CREATE INDEX idx_review_comments_session_page ON review_comments (session, pageKey)",
      "CREATE INDEX idx_review_comments_open ON review_comments (session, pageKey, deleted, resolved)"
    ]
  });
  app.save(comments);

  const replies = new Collection({
    type: "base",
    name: "review_replies",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "session", type: "relation", required: true, maxSelect: 1, collectionId: sessions.id, cascadeDelete: true },
      { name: "comment", type: "relation", required: true, maxSelect: 1, collectionId: comments.id, cascadeDelete: true },
      { name: "author", type: "text", max: 120 },
      { name: "text", type: "text", required: true, max: 4000 },
      { name: "deleted", type: "bool" },
      { name: "clientId", type: "text", max: 120 }
    ],
    indexes: [
      "CREATE INDEX idx_review_replies_comment ON review_replies (comment, deleted)"
    ]
  });
  app.save(replies);

  const solutions = new Collection({
    type: "base",
    name: "review_solutions",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "session", type: "relation", required: true, maxSelect: 1, collectionId: sessions.id, cascadeDelete: true },
      { name: "comment", type: "relation", required: true, maxSelect: 1, collectionId: comments.id, cascadeDelete: true },
      { name: "reply", type: "relation", maxSelect: 1, collectionId: replies.id, cascadeDelete: true },
      { name: "targetType", type: "text", required: true, max: 16 },
      { name: "targetId", type: "text", required: true, max: 32 },
      { name: "actor", type: "text", max: 120 },
      { name: "deleted", type: "bool" }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_review_solutions_target ON review_solutions (session, targetType, targetId)"
    ]
  });
  app.save(solutions);

  const screenshots = new Collection({
    type: "base",
    name: "review_screenshots",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "session", type: "relation", required: true, maxSelect: 1, collectionId: sessions.id, cascadeDelete: true },
      { name: "comment", type: "relation", maxSelect: 1, collectionId: comments.id, cascadeDelete: true },
      { name: "pageKey", type: "text", required: true, max: 512 },
      { name: "image", type: "file", maxSelect: 1, maxSize: 10485760, mimeTypes: ["image/png", "image/jpeg", "image/webp"] },
      { name: "metadata", type: "json" },
      { name: "deleted", type: "bool" }
    ],
    indexes: [
      "CREATE INDEX idx_review_screenshots_session_page ON review_screenshots (session, pageKey, deleted)"
    ]
  });
  app.save(screenshots);
}, (app) => {
  [
    "review_screenshots",
    "review_solutions",
    "review_replies",
    "review_comments",
    "review_origins",
    "review_sessions"
  ].forEach((name) => {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (_) {
      // Collection already absent during a partial rollback.
    }
  });
});
