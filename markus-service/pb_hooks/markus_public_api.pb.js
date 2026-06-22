function markusPublicApi(e) {
  function setCors(origin) {
    e.response.header().set("Vary", "Origin");
    e.response.header().set("Access-Control-Allow-Origin", origin || "*");
    e.response.header().set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    e.response.header().set("Access-Control-Allow-Headers", "Content-Type, X-Markus-Public-Key, Authorization");
    e.response.header().set("Access-Control-Allow-Private-Network", "true");
    e.response.header().set("Access-Control-Max-Age", "600");
  }

  function cleanText(value, max) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function requirePageKey(value) {
    var pageKey = cleanText(value, 512);
    if (!pageKey) {
      throw new BadRequestError("Missing pageKey.");
    }
    return pageKey;
  }

  function requireSession(reviewId) {
    var publicKey = e.request.header.get("X-Markus-Public-Key") || "";
    var origin = e.request.header.get("Origin") || "";
    setCors(origin);

    if (!publicKey) {
      throw new UnauthorizedError("Missing MarkUS public key.");
    }
    if (!origin) {
      throw new ForbiddenError("Missing request origin.");
    }

    var session;
    try {
      session = e.app.findFirstRecordByFilter(
        "review_sessions",
        "slug = {:slug} && publicKey = {:publicKey} && enabled = true",
        { "slug": reviewId, "publicKey": publicKey }
      );
    } catch (_) {
      throw new UnauthorizedError("Invalid MarkUS review scope.");
    }

    try {
      e.app.findFirstRecordByFilter(
        "review_origins",
        "session = {:session} && enabled = true && (origin = {:origin} || origin = '*')",
        { "session": session.id, "origin": origin }
      );
    } catch (_) {
      throw new ForbiddenError("Origin is not allowed for this review.");
    }

    return { session: session, origin: origin };
  }

  function exportRecord(record) {
    return {
      "id": record.id,
      "created": record.get("created"),
      "updated": record.get("updated"),
      "session": record.getString("session"),
      "comment": record.getString("comment"),
      "reply": record.getString("reply"),
      "pageKey": record.getString("pageKey"),
      "page": record.getString("pageKey"),
      "pageUrl": record.getString("pageUrl"),
      "url": record.getString("pageUrl"),
      "origin": record.getString("origin"),
      "annotationType": record.getString("annotationType"),
      "type": record.getString("annotationType"),
      "author": record.getString("author"),
      "text": record.getString("text"),
      "color": record.getString("color"),
      "anchor": record.get("anchor") || null,
      "geometry": record.get("geometry") || null,
      "geom": record.get("geometry") || null,
      "resolved": record.getBool("resolved"),
      "deleted": record.getBool("deleted"),
      "clientId": record.getString("clientId"),
      "targetType": record.getString("targetType"),
      "targetId": record.getString("targetId"),
      "actor": record.getString("actor")
    };
  }

  function exportThread(comment) {
    var data = exportRecord(comment);
    data.replies = [];
    data.solutions = [];

    var replies = e.app.findRecordsByFilter(
      "review_replies",
      "comment = {:comment} && deleted = false",
      "id",
      100,
      0,
      { "comment": comment.id }
    );
    for (var i = 0; i < replies.length; i += 1) {
      data.replies.push(exportRecord(replies[i]));
    }

    var solutions = e.app.findRecordsByFilter(
      "review_solutions",
      "comment = {:comment} && deleted = false",
      "id",
      100,
      0,
      { "comment": comment.id }
    );
    for (var j = 0; j < solutions.length; j += 1) {
      data.solutions.push(exportRecord(solutions[j]));
    }

    return data;
  }

  function publicRead(reviewId, pageKey) {
    var scope = requireSession(reviewId);
    var comments = e.app.findRecordsByFilter(
      "review_comments",
      "session = {:session} && pageKey = {:pageKey} && deleted = false",
      "id",
      200,
      0,
      { "session": scope.session.id, "pageKey": pageKey }
    );

    var threads = [];
    for (var i = 0; i < comments.length; i += 1) {
      threads.push(exportThread(comments[i]));
    }

    return e.json(200, { "reviewId": reviewId, "pageKey": pageKey, "threads": threads });
  }

  function createComment(reviewId, body) {
    var scope = requireSession(reviewId);
    var maxCommentBytes = Number($os.getenv("MARKUS_MAX_COMMENT_BYTES") || 4000);
    var text = cleanText(body.text, maxCommentBytes);
    if (!text) {
      throw new BadRequestError("Missing comment text.");
    }

    var collection = e.app.findCollectionByNameOrId("review_comments");
    var record = new Record(collection);
    record.set("session", scope.session.id);
    record.set("pageKey", requirePageKey(body.pageKey));
    record.set("pageUrl", cleanText(body.pageUrl, 2048));
    record.set("origin", scope.origin);
    record.set("annotationType", cleanText(body.annotationType || body.type || "note", 32));
    record.set("author", cleanText(body.author || "Anonymous", 120));
    record.set("text", text);
    record.set("color", cleanText(body.color || "", 32));
    record.set("anchor", body.anchor || null);
    record.set("geometry", body.geometry || null);
    record.set("resolved", false);
    record.set("deleted", false);
    record.set("clientId", cleanText(body.clientId || "", 120));

    // TODO: replace this placeholder with persistent per-IP/session/action rate limiting.
    e.app.save(record);
    return e.json(201, { "comment": exportThread(record) });
  }

  function createReply(reviewId, commentId, body) {
    var scope = requireSession(reviewId);
    var comment = e.app.findRecordById("review_comments", commentId);
    if (comment.getString("session") !== scope.session.id || comment.getBool("deleted")) {
      throw new NotFoundError("Comment not found.");
    }

    var maxCommentBytes = Number($os.getenv("MARKUS_MAX_COMMENT_BYTES") || 4000);
    var text = cleanText(body.text, maxCommentBytes);
    if (!text) {
      throw new BadRequestError("Missing reply text.");
    }

    var collection = e.app.findCollectionByNameOrId("review_replies");
    var record = new Record(collection);
    record.set("session", scope.session.id);
    record.set("comment", comment.id);
    record.set("author", cleanText(body.author || "Anonymous", 120));
    record.set("text", text);
    record.set("deleted", false);
    record.set("clientId", cleanText(body.clientId || "", 120));

    // TODO: apply the same rate-limit bucket used by comment creation.
    e.app.save(record);
    return e.json(201, { "reply": exportRecord(record), "thread": exportThread(comment) });
  }

  function updateComment(reviewId, commentId, body) {
    var scope = requireSession(reviewId);
    var comment = e.app.findRecordById("review_comments", commentId);
    if (comment.getString("session") !== scope.session.id || comment.getBool("deleted")) {
      throw new NotFoundError("Comment not found.");
    }

    if (typeof body.resolved === "boolean") {
      comment.set("resolved", body.resolved);
    }
    if (typeof body.text === "string") {
      var text = cleanText(body.text, Number($os.getenv("MARKUS_MAX_COMMENT_BYTES") || 4000));
      if (!text) {
        throw new BadRequestError("Missing comment text.");
      }
      comment.set("text", text);
    }

    e.app.save(comment);
    return e.json(200, { "comment": exportThread(comment) });
  }

  function setSolution(reviewId, body) {
    var scope = requireSession(reviewId);
    var targetType = cleanText(body.targetType, 16);
    var targetId = cleanText(body.targetId, 32);
    var enabled = body.enabled !== false;
    var comment;
    var replyId = "";

    if (targetType === "comment") {
      comment = e.app.findRecordById("review_comments", targetId);
    } else if (targetType === "reply") {
      var reply = e.app.findRecordById("review_replies", targetId);
      if (reply.getString("session") !== scope.session.id || reply.getBool("deleted")) {
        throw new NotFoundError("Reply not found.");
      }
      comment = e.app.findRecordById("review_comments", reply.getString("comment"));
      replyId = reply.id;
    } else {
      throw new BadRequestError("Invalid solution target.");
    }

    if (comment.getString("session") !== scope.session.id || comment.getBool("deleted")) {
      throw new NotFoundError("Comment not found.");
    }

    var existing = null;
    try {
      existing = e.app.findFirstRecordByFilter(
        "review_solutions",
        "session = {:session} && targetType = {:targetType} && targetId = {:targetId}",
        { "session": scope.session.id, "targetType": targetType, "targetId": targetId }
      );
    } catch (_) {
      existing = null;
    }

    if (existing) {
      existing.set("deleted", !enabled);
      existing.set("actor", cleanText(body.actor || body.author || "Anonymous", 120));
      e.app.save(existing);
      return e.json(200, { "solution": exportRecord(existing), "thread": exportThread(comment) });
    }

    if (!enabled) {
      return e.json(200, { "solution": null, "thread": exportThread(comment) });
    }

    var collection = e.app.findCollectionByNameOrId("review_solutions");
    var record = new Record(collection);
    record.set("session", scope.session.id);
    record.set("comment", comment.id);
    if (replyId) {
      record.set("reply", replyId);
    }
    record.set("targetType", targetType);
    record.set("targetId", targetId);
    record.set("actor", cleanText(body.actor || body.author || "Anonymous", 120));
    record.set("deleted", false);

    e.app.save(record);
    return e.json(201, { "solution": exportRecord(record), "thread": exportThread(comment) });
  }

  var origin = e.request.header.get("Origin") || "";
  setCors(origin);

  if (e.request.method === "OPTIONS") {
    return e.noContent(204);
  }

  var path = e.request.pathValue("path") || "";
  var parts = path.split("/").filter(Boolean);

  if (e.request.method === "GET" && parts.length === 1 && parts[0] === "health") {
    return e.json(200, { "ok": true, "service": "markus-pocketbase" });
  }

  if (parts.length >= 3 && parts[0] === "reviews") {
    var reviewId = cleanText(parts[1], 120);
    var body = e.requestInfo().body || {};

    if (e.request.method === "GET" && parts.length === 3 && parts[2] === "comments") {
      return publicRead(reviewId, requirePageKey(e.request.url.query().get("pageKey")));
    }
    if (e.request.method === "POST" && parts.length === 3 && parts[2] === "comments") {
      return createComment(reviewId, body);
    }
    if (e.request.method === "PATCH" && parts.length === 4 && parts[2] === "comments") {
      return updateComment(reviewId, parts[3], body);
    }
    if (e.request.method === "POST" && parts.length === 5 && parts[2] === "comments" && parts[4] === "replies") {
      return createReply(reviewId, parts[3], body);
    }
    if (e.request.method === "POST" && parts.length === 3 && parts[2] === "solutions") {
      return setSolution(reviewId, body);
    }
  }

  throw new NotFoundError("Unknown MarkUS endpoint.");
}

routerAdd("GET", "/api/markus/v1/{path...}", markusPublicApi);
routerAdd("POST", "/api/markus/v1/{path...}", markusPublicApi);
routerAdd("PATCH", "/api/markus/v1/{path...}", markusPublicApi);
routerAdd("OPTIONS", "/api/markus/v1/{path...}", markusPublicApi);
