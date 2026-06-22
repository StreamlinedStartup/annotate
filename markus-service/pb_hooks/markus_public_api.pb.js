function markusPublicApi(e) {
  function setCors(origin) {
    e.response.header().set("Vary", "Origin");
    e.response.header().set("Access-Control-Allow-Origin", origin || "*");
    e.response.header().set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
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

  function deleteComment(reviewId, commentId) {
    var scope = requireSession(reviewId);
    var comment = e.app.findRecordById("review_comments", commentId);
    if (comment.getString("session") !== scope.session.id || comment.getBool("deleted")) {
      throw new NotFoundError("Comment not found.");
    }

    comment.set("deleted", true);
    e.app.save(comment);
    return e.json(200, { "deletedId": comment.id });
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
    if (e.request.method === "DELETE" && parts.length === 4 && parts[2] === "comments") {
      return deleteComment(reviewId, parts[3]);
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

function markusSetupPage(e) {
  var setupTokenConfigured = !!($os.getenv("MARKUS_SETUP_TOKEN") || "");
  var publicBaseUrl = ($os.getenv("MARKUS_PUBLIC_BASE_URL") || "http://localhost:8090").replace(/\/+$/, "");
  var scriptUrl = $os.getenv("MARKUS_SCRIPT_URL") || "https://unpkg.com/@vulture916/markus/markus.js";
  var disabled = setupTokenConfigured ? "" : " disabled";
  var banner = setupTokenConfigured
    ? ""
    : "<div class=\"notice error\" role=\"alert\">Set MARKUS_SETUP_TOKEN before creating review sessions.</div>";

  e.response.header().set("Content-Type", "text/html; charset=utf-8");
  return e.string(200, [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>MarkUS setup</title>",
    "<style>",
    ":root{color-scheme:light;--bg:#f7f8fa;--surface:#fff;--ink:#17202a;--muted:#5d6673;--line:#d9dee7;--accent:#1f6feb;--danger:#b42318;--ok:#067647;}",
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;}",
    "main{max-width:960px;margin:0 auto;padding:32px 20px 56px;}h1{font-size:28px;line-height:1.15;margin:0 0 8px;}p{color:var(--muted);margin:0 0 20px;}",
    ".panel{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:20px;margin-top:18px;}label{display:block;font-weight:650;margin:0 0 6px;}",
    "input,textarea{width:100%;border:1px solid var(--line);border-radius:6px;padding:10px 11px;font:inherit;background:#fff;color:var(--ink);}textarea{min-height:84px;resize:vertical;}",
    ".grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.full{grid-column:1/-1}.hint{display:block;color:var(--muted);font-size:13px;margin-top:5px;}",
    ".checks{display:flex;gap:18px;flex-wrap:wrap}.checks label{font-weight:500;display:flex;align-items:center;gap:8px;margin:0}.checks input{width:auto;}",
    "button{border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:650;padding:10px 14px;cursor:pointer;}button.secondary{background:#edf2f7;color:var(--ink);}",
    "button:disabled{opacity:.55;cursor:not-allowed}.actions{display:flex;align-items:center;gap:10px;margin-top:18px}.notice{border-radius:6px;padding:10px 12px;margin:0 0 16px;font-weight:600}.error{background:#fff1f0;color:var(--danger);border:1px solid #ffcdc7}.ok{background:#ecfdf3;color:var(--ok);border:1px solid #abefc6}",
    ".result{display:none}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0 8px;}pre{white-space:pre-wrap;word-break:break-word;background:#f3f5f8;border:1px solid var(--line);border-radius:6px;padding:12px;margin:0;}",
    "@media(max-width:700px){.grid{grid-template-columns:1fr}main{padding:24px 14px 40px}.actions,.row{align-items:stretch;flex-direction:column}.row button{width:100%;}}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    "<h1>Create a MarkUS review</h1>",
    "<p>Create the review session and allowed origins without opening the PocketBase database.</p>",
    "<section class=\"panel\" aria-labelledby=\"form-title\">",
    "<h2 id=\"form-title\">Review details</h2>",
    banner,
    "<form id=\"setup-form\">",
    "<div class=\"grid\">",
    "<div><label for=\"token\">Setup token</label><input id=\"token\" name=\"token\" type=\"password\" autocomplete=\"off\"" + disabled + " required><span class=\"hint\">Sent as a bearer token. It is not stored or shown in generated output.</span></div>",
    "<div><label for=\"name\">Review name</label><input id=\"name\" name=\"name\" placeholder=\"Launch homepage v3\"" + disabled + " required></div>",
    "<div><label for=\"project\">Project</label><input id=\"project\" name=\"project\" placeholder=\"Hartford\"" + disabled + "></div>",
    "<div><label for=\"slug\">Review ID</label><input id=\"slug\" name=\"slug\" placeholder=\"Auto-generated if blank\"" + disabled + "></div>",
    "<div class=\"full\"><label for=\"origins\">Page URL or origins</label><textarea id=\"origins\" name=\"origins\" placeholder=\"https://staging.example.com/page\nhttp://localhost:4200\"" + disabled + " required></textarea><span class=\"hint\">One per line. Full URLs are converted to exact browser origins.</span></div>",
    "<div><label for=\"pageKey\">Page key</label><input id=\"pageKey\" name=\"pageKey\" value=\"/\"" + disabled + " required></div>",
    "<div><label for=\"retentionDays\">Retention days</label><input id=\"retentionDays\" name=\"retentionDays\" type=\"number\" min=\"0\" value=\"0\"" + disabled + "></div>",
    "<div class=\"full checks\"><label><input id=\"stripQuery\" name=\"stripQuery\" type=\"checkbox\" checked" + disabled + "> Strip query strings</label><label><input id=\"allowScreenshots\" name=\"allowScreenshots\" type=\"checkbox\"" + disabled + "> Allow screenshots</label></div>",
    "</div>",
    "<div class=\"actions\"><button type=\"submit\"" + disabled + ">Create review</button><span id=\"status\" aria-live=\"polite\"></span></div>",
    "</form>",
    "</section>",
    "<section id=\"result\" class=\"panel result\" aria-labelledby=\"result-title\">",
    "<h2 id=\"result-title\">Generated review</h2>",
    "<div id=\"result-status\" class=\"notice ok\"></div>",
    "<div class=\"row\"><strong>Script tag</strong><button class=\"secondary\" type=\"button\" data-copy=\"snippet\">Copy</button></div><pre id=\"snippet\"></pre>",
    "<div class=\"row\"><strong>Public key</strong><button class=\"secondary\" type=\"button\" data-copy=\"publicKey\">Copy</button></div><pre id=\"publicKey\"></pre>",
    "<div class=\"row\"><strong>Review test link</strong><button class=\"secondary\" type=\"button\" data-copy=\"reviewUrl\">Copy</button></div><pre id=\"reviewUrl\"></pre>",
    "</section>",
    "</main>",
    "<script>",
    "var publicBaseUrl=" + JSON.stringify(publicBaseUrl) + ";",
    "var scriptUrl=" + JSON.stringify(scriptUrl) + ";",
    "var form=document.getElementById('setup-form');var statusEl=document.getElementById('status');var latest={};",
    "function originFromLine(line){var value=line.trim();if(!value)return '';try{var url=new URL(value);if(url.protocol==='http:'||url.protocol==='https:')return url.origin;}catch(e){}return value.replace(/\\/+$/,'');}",
    "function lines(value){return value.split(/\\r?\\n|,/).map(originFromLine).filter(Boolean).filter(function(v,i,a){return a.indexOf(v)===i;});}",
    "function escAttr(value){return String(value).replace(/&/g,'&amp;').replace(/\"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
    "function snippet(data){return '<script src=\"'+escAttr(scriptUrl)+'\" data-review-id=\"'+escAttr(data.reviewId)+'\" data-api-base-url=\"'+escAttr(publicBaseUrl)+'\" data-public-key=\"'+escAttr(data.publicKey)+'\" defer></'+'script>';}",
    "function show(data){latest=data;latest.snippet=snippet(data);document.getElementById('result-status').textContent='Created '+data.reviewId+' for '+data.origins.join(', ')+'.';document.getElementById('snippet').textContent=latest.snippet;document.getElementById('publicKey').textContent=data.publicKey;document.getElementById('reviewUrl').textContent=data.reviewUrl;document.getElementById('result').style.display='block';}",
    "form.addEventListener('submit',function(ev){ev.preventDefault();statusEl.textContent='Creating...';var fd=new FormData(form);var body={name:String(fd.get('name')||''),slug:String(fd.get('slug')||''),project:String(fd.get('project')||''),origins:lines(String(fd.get('origins')||'')),pageKey:String(fd.get('pageKey')||'/'),allowScreenshots:document.getElementById('allowScreenshots').checked,stripQuery:document.getElementById('stripQuery').checked,retentionDays:Number(fd.get('retentionDays')||0)};fetch('/api/markus/setup/reviews',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+String(fd.get('token')||'')},body:JSON.stringify(body)}).then(function(res){return res.json().then(function(data){if(!res.ok)throw new Error(data.error&&data.error.message?data.error.message:'Create failed');return data;});}).then(function(data){statusEl.textContent='Created';show(data);}).catch(function(err){statusEl.textContent=err.message;});});",
    "document.addEventListener('click',function(ev){var key=ev.target&&ev.target.getAttribute('data-copy');if(!key)return;var text=latest[key]||'';if(!text)return;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){ev.target.textContent='Copied';setTimeout(function(){ev.target.textContent='Copy';},1200);});}else{window.prompt('Copy this:',text);}});",
    "</script>",
    "</body>",
    "</html>"
  ].join(""));
}

function markusSetupApi(e) {
  function cleanText(value, max) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function error(status, code, message) {
    return e.json(status, { "error": { "code": code, "message": message } });
  }

  function requireSetupPageKey(value) {
    var pageKey = cleanText(value, 512);
    if (!pageKey) {
      throw new BadRequestError("Missing pageKey.");
    }
    return pageKey;
  }

  function requireSetupToken() {
    var expected = $os.getenv("MARKUS_SETUP_TOKEN") || "";
    if (!expected) {
      return { status: 503, code: "SETUP_DISABLED", message: "MarkUS setup is disabled until MARKUS_SETUP_TOKEN is configured." };
    }

    var auth = e.request.header.get("Authorization") || "";
    var actual = "";
    if (auth.indexOf("Bearer ") === 0) {
      actual = auth.slice(7);
    }
    if (!actual || !$security.equal(actual, expected)) {
      return { status: 401, code: "UNAUTHORIZED", message: "Invalid MarkUS setup token." };
    }
    return null;
  }

  function slugify(value) {
    return cleanText(value, 120)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
  }

  function sessionExists(slug) {
    try {
      e.app.findFirstRecordByFilter("review_sessions", "slug = {:slug}", { "slug": slug });
      return true;
    } catch (_) {
      return false;
    }
  }

  function uniqueSlug(base, explicit) {
    if (!base) {
      throw new BadRequestError("Missing review name or review ID.");
    }
    if (!sessionExists(base)) {
      return base;
    }
    if (explicit) {
      return null;
    }
    for (var i = 0; i < 5; i += 1) {
      var candidate = (base.slice(0, 111).replace(/-+$/, "") + "-" + $security.randomString(8).toLowerCase()).slice(0, 120);
      if (!sessionExists(candidate)) {
        return candidate;
      }
    }
    throw new BadRequestError("Could not generate a unique review ID.");
  }

  function normalizeOrigin(value) {
    var origin = cleanText(value, 512).replace(/\/+$/, "");
    if (!/^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(origin)) {
      throw new BadRequestError("Origins must be exact http:// or https:// browser origins.");
    }
    return origin;
  }

  function normalizeOrigins(values) {
    if (!Array.isArray(values)) {
      throw new BadRequestError("Missing origins.");
    }
    var seen = {};
    var origins = [];
    for (var i = 0; i < values.length; i += 1) {
      var origin = normalizeOrigin(values[i]);
      if (!seen[origin]) {
        seen[origin] = true;
        origins.push(origin);
      }
    }
    if (!origins.length) {
      throw new BadRequestError("At least one origin is required.");
    }
    return origins;
  }

  function buildSnippet(scriptUrl, publicBaseUrl, reviewId, publicKey) {
    return [
      "<script",
      "  src=\"" + scriptUrl + "\"",
      "  data-review-id=\"" + reviewId + "\"",
      "  data-api-base-url=\"" + publicBaseUrl + "\"",
      "  data-public-key=\"" + publicKey + "\"",
      "  defer></script>"
    ].join("\n");
  }

  var tokenError = requireSetupToken();
  if (tokenError) {
    return error(tokenError.status, tokenError.code, tokenError.message);
  }

  try {
    var body = e.requestInfo().body || {};
    var explicitSlug = !!cleanText(body.slug, 120);
    var slug = uniqueSlug(slugify(body.slug || body.name), explicitSlug);
    if (slug === null) {
      return error(409, "REVIEW_ID_EXISTS", "A review with this ID already exists.");
    }

    var origins = normalizeOrigins(body.origins);
    var pageKey = requireSetupPageKey(body.pageKey == null ? "/" : body.pageKey);
    var publicKey = "rvw_pub_" + $security.randomString(48);
    var publicBaseUrl = ($os.getenv("MARKUS_PUBLIC_BASE_URL") || "http://localhost:8090").replace(/\/+$/, "");
    var scriptUrl = $os.getenv("MARKUS_SCRIPT_URL") || "https://unpkg.com/@vulture916/markus/markus.js";
    var session;

    $app.runInTransaction(function (txApp) {
      var sessionCollection = txApp.findCollectionByNameOrId("review_sessions");
      session = new Record(sessionCollection);
      session.set("slug", slug);
      session.set("publicKey", publicKey);
      session.set("name", cleanText(body.name || slug, 160));
      session.set("project", cleanText(body.project || "", 160));
      session.set("enabled", true);
      session.set("allowScreenshots", body.allowScreenshots === true);
      session.set("stripQuery", body.stripQuery !== false);
      session.set("retentionDays", Math.max(0, Number(body.retentionDays || 0)));
      session.set("settings", {});
      txApp.save(session);

      var originCollection = txApp.findCollectionByNameOrId("review_origins");
      for (var i = 0; i < origins.length; i += 1) {
        var originRecord = new Record(originCollection);
        originRecord.set("session", session.id);
        originRecord.set("origin", origins[i]);
        originRecord.set("enabled", true);
        txApp.save(originRecord);
      }
    });

    var reviewUrl = origins[0] + pageKey;
    return e.json(201, {
      "reviewId": slug,
      "publicKey": publicKey,
      "origins": origins,
      "pageKey": pageKey,
      "apiBaseUrl": publicBaseUrl,
      "scriptUrl": scriptUrl,
      "snippet": buildSnippet(scriptUrl, publicBaseUrl, slug, publicKey),
      "reviewUrl": reviewUrl
    });
  } catch (err) {
    return error(400, "SETUP_CREATE_FAILED", cleanText(err && err.message ? err.message : err, 400));
  }
}

routerAdd("GET", "/api/markus/v1/{path...}", markusPublicApi);
routerAdd("POST", "/api/markus/v1/{path...}", markusPublicApi);
routerAdd("PATCH", "/api/markus/v1/{path...}", markusPublicApi);
routerAdd("DELETE", "/api/markus/v1/{path...}", markusPublicApi);
routerAdd("OPTIONS", "/api/markus/v1/{path...}", markusPublicApi);
routerAdd("GET", "/markus/setup", markusSetupPage);
routerAdd("POST", "/api/markus/setup/reviews", markusSetupApi);
