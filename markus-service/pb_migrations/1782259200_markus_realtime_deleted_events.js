migrate((app) => {
  const comments = app.findCollectionByNameOrId("review_comments");
  comments.listRule = "session.publicKey = @request.query.publicKey && pageKey = @request.query.pageKey";
  app.save(comments);
}, (app) => {
  const comments = app.findCollectionByNameOrId("review_comments");
  comments.listRule = "session.publicKey = @request.query.publicKey && pageKey = @request.query.pageKey && deleted = false";
  app.save(comments);
});
