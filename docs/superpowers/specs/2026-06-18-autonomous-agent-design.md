# Funtastic SaaS Autonomous Agent Design

## Goal

Configure the repository agent to complete clear development requests end to
end without repeatedly asking for approval.

## Default Workflow

For a clear and scoped request, the agent should:

1. Inspect the relevant code and current repository state.
2. Implement the smallest change that satisfies the request.
3. Run focused tests, lint checks, and a production build when practical.
4. Review the resulting diff for unrelated changes.
5. Commit only the files related to the request.
6. Push the commit to `origin main`.
7. Verify the configured Railway production deployment and public URL.
8. Report the change, verification results, commit, and deployment status.

The agent should continue through this workflow without requesting approval at
every step.

## Approval Boundaries

The agent must request approval before:

- deleting or irreversibly rewriting production data;
- applying destructive or difficult-to-reverse production database changes;
- changing, exposing, rotating, or removing credentials and secret values;
- intentionally disabling a security or access-control safeguard;
- deploying when the requested behavior or production target is ambiguous.

Normal source edits, tests, builds, commits, pushes, and deployment verification
do not require separate approval when they are necessary to complete a clear
request.

## Existing Project Protections

All existing order immutability, duplicate-collection, marketplace isolation,
workspace ownership, Next.js documentation, GitHub repository, Railway
deployment, production branch, and production URL rules remain authoritative.
Autonomous execution does not permit bypassing those protections.

## Dirty Worktree Handling

The agent must preserve user changes already present in the working tree. It
should commit only files directly related to the current request and must not
revert, overwrite, or silently include unrelated modifications.

## Failure Handling

- Do not push or deploy when required verification fails.
- Diagnose and fix failures when they are caused by the current change.
- Report unrelated pre-existing failures without modifying unrelated code.
- Never include unrelated user changes in a commit.

## Success Criteria

- Clear requests run from implementation through production verification with
  no unnecessary approval pauses.
- High-risk data, schema, credential, and security operations still require
  explicit approval.
- Existing project-specific safety rules remain unchanged.
