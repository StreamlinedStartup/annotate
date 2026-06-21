<!-- SPROUT PRIME START -->
## Sprout

This repository uses Sprout for agent-oriented task tracking.

- Run `sprout doctor` before starting unfamiliar work.
- Use `sprout list` or `sprout next` to find work.
- Start active work with `sprout begin <task-id>`; it claims the task and prints context.
- Before editing files outside task scope, run `sprout touch <task-id> <path> --reason "..."`.
- Check prior file decisions with `sprout history <path>`.
- Record durable decisions with `sprout note <task-id> --kind decision "..."`.
- Run `sprout verify <task-id>` before completion.
- Use `sprout done <task-id>` for a dry run, then `sprout done <task-id> --yes` when ready.
- For first-time setup, `sprout prime install --target all --git-hooks` installs these instructions plus native Git commit hooks.

Keep generated binaries, caches, and disposable repos outside the repository root.

## Documentation References

Sprout documentation references are optional and documentation-system agnostic.

- Use `sprout add/update --doc-required <ref> --doc-reason "..."` when a task changes a documented contract, architecture decision, API, schema, or workflow.
- Use `--doc <ref>` for relevant context that may help implementation.
- Use `--doc-reason "assessed; no relevant docs"` when documentation was checked and nothing needs to be read.
- Refs are opaque strings such as paths, URLs, or knowledge-base page IDs; Sprout stores and shows them but does not validate or fetch them.

## Pull Requests

PR titles MUST use `Epic N: <Epic title>`.
One-off tasks or small changes that do not need an epic should use a conventional PR title such as `feat: ...`, `chore: ...`, or `fix: ...` instead of an `Epic N:` title.
PR bodies MUST use `.sprout/templates/PULL_REQUEST_TEMPLATE.md` for every GitHub PR.
Fill each section from recorded Sprout epic/task data whenever possible: epic summary, task summaries or descriptions, affected files and reasons, verification events or task verification commands, and decision or observation notes.

## Versioning

Sprout uses Git SemVer tags as the release source of truth.

- Every merged change to `main` should result in a version tag from the Version workflow.
- Use PR labels to override version inference when needed: `version:major`, `version:minor`, or `version:patch`.
- Breaking changes must be marked with `version:major` or a `BREAKING CHANGE:` note.
- Feature PRs should use `feat:` when they should create a minor version.
- Bug fixes and maintenance changes default to patch versions.
- Do not hand-edit the version string for releases; `sprout version` reads tagged Go module build info.
- The Version workflow should publish a GitHub release changelog for each created tag so users can see what changed.

<!-- SPROUT PRIME END -->
