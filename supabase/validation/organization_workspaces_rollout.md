# Controlled Workspace Rollout

Owner-run only. Nothing is applied or deployed by preparing this package.
The owner reports PASS_BEFORE_ROLLBACK and PASS_AFTER_ROLLBACK for the reviewed
rehearsal. These results are evidence, not permission to skip the following gates.

## Release Inputs

- Exact migration: `supabase/migrations/20261028_organization_workspaces.sql`.
- SHA-256 (file bytes):
  `6961B74FC9645A404EFC012236EAFE5881F16FE687AF44444E063616359F69F2`.
- PostgreSQL 15+; use the reviewed Supabase SQL Editor postgres owner.
- Approved baseline: projects=11, imports=1, import rows=1, requests=2, events=11.
- Original project fingerprint:
  `8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758`.
- Business sequence: last_value=12, is_called=true. Reading it does not allocate IDs.
- Brisk & Zip / CAD becomes the one Demo organization,
  `00000000-0000-4000-8000-000000000001`. There are NOT two seeded workspaces.
  Industry and timestamps are preserved from the singleton.
- Intended existing admin: `ed1005a0-76e4-4614-8a66-589c055ecff5`.
  This is a rollout verification account, not a permanent universal administrator.
- Have the workspace-aware frontend release ready and separately authorized.
  Old clients without the organization header fail closed after migration.

## Exact Owner Order

1. Put the application in maintenance / restrict public traffic. Quiesce ALL project,
   import, governance, settings, profile and Auth writers, background jobs and direct
   sequence consumers. Keep traffic held throughout database verification.
2. Confirm a recoverable backup/PITR recovery point, restore access, and responsible
   operator. Preserve the successful rehearsal reports. Do not proceed without a
   reviewed recovery plan. A post-commit SQL ROLLBACK cannot undo tenantization.
3. Verify the migration file SHA above. In SQL Editor run the entire
   `supabase/validation/organization_workspaces_preflight.sql` against the intended
   project. Review all grids/notices, including generator/trigger/Auth hook evidence
   and owner attestations. Require PASS and the exact approved baseline. On error,
   issue `ROLLBACK;`, STOP and investigate. Never override mismatches to force PASS.
4. Still before migration, run the entire READ-ONLY
   `supabase/validation/organization_workspaces_rollout_capture.sql`.
   Save the complete ROLLOUT_EVIDENCE cell privately, with project/environment and
   capture time. Do not put private catalog evidence into Git. It pins original
   function/default/trigger/profile catalogs and sequence definitions/state.
5. Paste that ONE exported cell verbatim over `null` between the verifier's
   `$rollout_evidence$` delimiters. It is JSON data, not SQL. Do not remove JSON
   `\u0024` escaping, add a CSV wrapper, or change any other verifier text.
   Missing, incomplete, different-database or mismatched evidence fails closed.
6. Execute the ENTIRE EXACT ORIGINAL migration file once in SQL Editor. It owns its
   BEGIN and COMMIT. Do not add wrappers, paste a partial selection, replay a prior
   successful execution, run db push, or run a generated substitute.
   Capture all results/notices and confirm final success/COMMIT. If any statement
   errors, issue `ROLLBACK;`, keep traffic held, and determine actual catalog state.
   If connection/commit outcome is ambiguous, inspect before deciding anything.
7. Before any browser signup/profile/bootstrap or business writes, run the ENTIRE
   `supabase/validation/organization_workspaces_post_rollout_verify.sql` containing
   the fresh evidence. Require `PASS_POST_ROLLOUT` and no error. Its final ROLLBACK
   ends only its read-only transaction. Save output/notices privately.
8. While traffic remains restricted, owner releases the separately authorized
   workspace-aware frontend and performs the smoke checks below from its actual
   deployed origin. Do not leave old frontend traffic running against the new schema.
   No deployment is authorized or executed by preparation of this runbook.
9. Confirm every database, browser, gateway and isolation gate passed. Record owner
   sign-off, migration SHA, backup point, timing, notices and frontend version.
   Only then restore normal traffic/writers and monitor normal errors.

## Post-Rollout Verifier Coverage

The verifier is one READ ONLY repeatable-read transaction ending ROLLBACK; no
temporary objects, writes, generator calls, sequence advancement or mutation RPCs.
It checks all original financial/business/audit fields by sorted SHA-256 row
fingerprints excluding only added organization_id; profiles and archived singleton
are compared in full. It checks all public sequences, original functions/ACLs,
default bindings, original trigger modes, role/schema/default grants, and event
triggers against fresh pre-rollout evidence.

It also checks one Brisk & Zip Demo/CAD organization, memberships derived from
original role holders and frozen Demo eligibility, tenant columns/indexes/composite
FKs, exact policy predicates, RPC signatures/contracts/body fingerprints/security/
EXECUTE grants, invoker import reconciliation, profile privacy and compatibility
view/archive isolation. The RLS infrastructure is pinned to the exact reviewed
definition/binding. Read-only probes exercise existing admin reads, public Demo
reads, nonmember private-history denial, missing/malformed/inaccessible headers
and context restoration. No new projects, IDs, accounts or workspaces are created.

## Browser And API Gates

Use existing accounts and READ-ONLY requests first; inspect Network requests without
publishing bearer tokens. Existing account sign-in/out is expected to work. If
profile completion would write/bootstrap, first finish the strict baseline verifier.

- Sign In and Sign Up tabs/forms open even if discovery fails. Test existing account
  login/session refresh/signout. Opening Sign Up is safe; actual registration is a
  write and belongs in staging or a separately approved post-baseline test plan.
- Selector is populated ONLY by `list_my_workspaces()`, with real UUIDs. Existing
  role holders can select Brisk & Zip, which is also Demo; anonymous discovery and
  reads of Demo remain intentional in this reviewed migration. A new nonmember
  sees Demo read-only, no operational history. Do not invent a second seeded option.
- Direct `#projects` / `#forecasting` requests recover after actual selection.
  Sidebar routing, persistent Account and Settings work; Settings no longer says
  workspace setup is unavailable. No legacy CSV or implicit-tenant fallback.
- From the deployed origin verify REST AND RPC OPTIONS allow
  `x-steerfold-organization-id`, authorization, apikey, content-type and needed
  methods. Verify actual gateway forwarding, not merely successful OPTIONS.
  Valid Demo UUID resolves Demo; missing header fails42501, malformed fails22023,
  inaccessible UUID fails42501. No hard-coded bypass or default workspace.
- Verify projects=11 in Demo, expected project detail/analytics and CAD unchanged.
  No records from another workspace may be visible by changing filters, query
  identifiers, RPC arguments or headers. Current production has only Demo, so
  positive A/B member-isolation tests must use the already rehearsed matrix in
  staging or separately approved test workspaces, NOT fabricated production data.
- Safe Import: open staging/conflict review, inspect correct selected UUID/header,
  current CAD, actor-owned history and existing result reconciliation; never click
  Import Projects/commit or allocate IDs during this non-writing gate. Cross-tenant
  warning/replay/commit tests belong in staging; they were tested in rehearsal.
- Change Governance: existing CR histories/roles/SOD/readiness/reporting remain
  readable to eligible members; nonmembers cannot read private history. Do not
  transition/delete/apply any production request during these checks.
- Settings/Profile: verify Brisk & Zip, saved industry, organization CAD, profile
  identity/initials, Appearance and separate Display Currency. Do not change CAD,
  save profiles/settings or bootstrap a missing profile before baseline verification.
  Full save/reload tests require staging or separate explicit write approval.
- Verify generator definition/default and original sequence state through the SQL
  verifier, NEVER by inserting a test project/calling nextval. After traffic returns,
  legitimate allocations can advance beyond12; investigate unexpected movement
  during the held rollout. Sequence operations do not roll back like table writes.

## STOP / Recovery Boundary

Keep traffic quiesced on ANY preflight/baseline mismatch, SQL error, unclear COMMIT,
missing evidence/backup/admin, unexpected row/fingerprint/sequence changes, unknown
privileged function/event trigger, weakened ACL/RLS, gateway/header failure, private
cross-tenant exposure, legacy CSV fallback, wrong currency, broken auth/routing or
unverified frontend/backend coordination. Save diagnostics; do not mark completion.

An errored uncommitted transaction can be cleared with manual ROLLBACK.
A successfully committed migration cannot be reversed by that command.
There is NO automatic reverse migration in this package. Stop and investigate with
the owner; use only the separately reviewed backup/PITR recovery procedure if
required. Tenant collapse after workspace writes is lossy. Never weaken assertions,
RLS, headers or authorization to make a rollout appear successful.

## Local Validation (No Remote Access)

Run SQL/PLpgSQL parser checks on both new SQL files with --rollback-only, the
workspace migration/rehearsal/post-rollout suites, the full Node suite, syntax
checks and git diff --check. Static validation is not a fresh production execution.
