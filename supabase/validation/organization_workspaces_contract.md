# Workspace Database Contract

Local review artifacts only. No migration, query, remote connection, commit or push
was performed. The static checks below do not create or connect to a database.

This migration is deliberately pinned to the verified Brisk & Zip baseline: 11
projects, 1 import, 1 import row, 2 requests and 11 events. Under source-table locks,
it uses the original preflight's transaction-local UTC timezone and requires project fingerprint
`8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758`
using the original preflight expression:

```sql
encode(sha256(convert_to(coalesce(
  string_agg(to_jsonb(p)::text, '' order by p.project_id), ''), 'UTF8')), 'hex')
```

The final check repeats the same ordering and serialization with
`(to_jsonb(p) - 'organization_id')::text`, requires the same known counts, and
asserts Demo matches the original Brisk & Zip/CAD singleton including industry and
updated_at. A changed baseline aborts instead of being accepted just because the
generic before/after fingerprints match. Reconcile any legitimate baseline change
explicitly before a later rollout; do not disable these assertions to force an apply.

## Frontend Contract

`list_my_workspaces()` returns a JSON array, including when called anonymously.
Anonymous callers receive only Demo. Authenticated callers receive their member
organizations plus Demo once. No selected header is needed for discovery or creation.
Each row has this shape; `industry` is always text and `can_write` is always boolean:

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "organization_name": "Brisk & Zip",
  "industry": "",
  "organization_currency": "CAD",
  "is_demo": true,
  "can_write": false,
  "membership_role": null
}
```

The example identity is the stable migrated Demo ID; name, industry, currency and
updated timestamp are copied from the existing settings row, not overwritten.
`membership_role` is `owner`, `member`, or null for a public Demo visitor.

`create_workspace(p_name text,p_industry text,p_currency text)` requires an
authenticated user and returns one object of the same shape. Industry may be an
empty string, but not null. Name and industry are trimmed and limited to 120
characters; name must be nonempty. Currency is explicitly CAD, USD, GBP, or EUR,
with no default. The creator becomes owner and scoped Governance Admin. No
projects, requests, imports, profiles or historical data are copied. Governance
Admin is not a wildcard for requester/reviewer/approver/baseline-controller roles.
The owner may assign their own workspace business roles through existing RPCs.

All tenant REST and RPC requests send the exact header
`x-steerfold-organization-id: <UUID>`. JSON null, arrays, comma-separated values,
whitespace-padded UUIDs and malformed UUIDs are rejected. Missing headers and
inaccessible IDs raise 42501; malformed header values raise 22023. No default
workspace is selected. The separate personal profile RPCs remain header independent.
The header is request context, not authorization: the server checks membership
or permits reading Demo. Clients should also send `organization_id=eq.<UUID>`
on REST reads/updates/deletes and include `organization_id` on project POSTs.
The database rejects a body tenant that disagrees with the header.

`organization_settings` is a SELECT-only, security-invoker compatibility view:
`id=true`, `organization_name`, `industry`, `organization_currency`, `updated_at`,
and additional `organization_id`, scoped to the selected header. Existing
`set_organization_currency` and `save_organization_profile` names, arguments,
confirmation/concurrency checks and JSON response fields are retained. They lock
and update only the selected organization. The old singleton becomes an archive
with no public/anon/authenticated privileges or read policy. It is not authoritative.

## Authorization And Preservation

- `organizations` stores identity, explicit currency, Demo status and timestamps.
  `organization_memberships` stores `(organization_id,user_id)`, owner/member role,
  creation timestamp and a server-only frozen Demo write eligibility flag.
- Existing governance role holders receive Demo membership; assignments retain
  their user IDs, roles, assignment actors and timestamps. Unassigned Auth users
  receive no membership. There is no signup trigger or automatic global admin.
- Membership is required to write normal workspaces. Demo writes additionally
  require frozen migration eligibility AND a current scoped Governance Admin
  assignment. Granting a new Demo admin does not give that account write eligibility.
  Browser clients cannot insert memberships or set eligibility.
- Projects and organization context use real RLS for selected-member or public-Demo
  reads. Requests/events retain authenticated-only reads scoped to the selected
  workspace AND require actual membership, including Demo. Imports/provenance
  require authentication, actual membership AND actor ownership in the selected
  workspace; other members cannot read an actor's import history. Each history
  policy has a correlated own-membership EXISTS check. The own-membership policy
  itself does not query memberships, so these checks do not recurse through RLS.
  A new authenticated nonmember selecting Demo receives no operational history.
  Import reconciliation remains security-invoker, so it cannot bypass these rules;
  a nonmember receives not_found rather than historical result data. Existing
  assigned Demo users retain the memberships created during this migration.
  No anonymous filenames, source provenance or governance audit actors are exposed.
  Personal profiles remain private.
  Governance assignments remain RPC-only; the user directory contains only members
  of the selected organization. Import reconciliation still requires actor + tenant.
- Every known business definer RPC validates write context and uses scoped
  lookups. Role reads and reconciliation validate read context. Internal analyze
  is revoked from browsers and also enforces write authorization. New and replaced
  functions have empty search paths and explicit execute ACLs.
- The migration aborts on unknown non-extension public definer RPC signatures or
  detected signup hooks that assign roles/memberships. Reconcile such deployed
  additions before rollout. The base projects DDL and ID generator are external
  to this repository and must be inspected separately before execution.
  One explicit infrastructure exception is the owner-reviewed
  `public.rls_auto_enable()`: a postgres-owned, VOLATILE PL/pgSQL SECURITY DEFINER
  returning event_trigger with exactly `search_path=pg_catalog`. It must have
  exactly one binding, postgres-owned `ensure_rls`, origin-enabled on
  `ddl_command_end`, with exactly CREATE TABLE / CREATE TABLE AS / SELECT INTO
  tags. Additional non-extension public-function event-trigger bindings stop
  validation, even if SECURITY INVOKER. This is not a general event-trigger exemption.
  Its owner-reviewed body must only inspect DDL commands, restrict public table /
  partitioned-table objects and enable their RLS, with diagnostic logging only.
  Exact UTF-8 `pg_get_functiondef` SHA-256 pinning protects that reviewed behavior.
  The owner-supplied reviewed definition is embedded as inert text in both
  validators. Canonicalization converts CRLF to LF and removes final CR/LF only;
  internal whitespace, literals, statements and dollar-quote tags remain exact.
  The canonical reviewed definition SHA-256 is
  `62e77d28f3013a8047bb431be5f8b174ad51cdde883dcc3b0d6c6c0a84e954a3`.
  No behavioral regex exemption is used. A different definition fails closed;
  re-review rather than trusting a new live hash merely to pass. Neither function
  definition nor its ACL is altered. Its execution on newly created public
  workspace tables is expected; enabling RLS before policies are installed is
  compatible with the transactional migration.
- Composite foreign keys bind requests to projects, events to requests, role
  holders to memberships, and import rows to batches/projects in one organization.
  Project deletion retains provenance while nulling only `project_uuid`.
  Business IDs/default generators stay unchanged, including global code uniqueness.
  Redundant child organization IDs allow direct RLS/index filtering. Composite
  unique parent indexes and composite FKs prevent a child tenant from disagreeing
  with its parent tenant, even when a malicious caller supplies a valid foreign UUID.
- Only `organization_id` is backfilled onto business/history rows. Existing user
  triggers are suspended for that metadata update and restored to their original
  disabled/origin/replica/always modes. Original IDs, business fields, audit fields,
  timestamps, stored payload hashes, acknowledgements and result JSON are retained.
  The migration locks source tables, captures original row counts and sorted SHA-256
  row fingerprints, and asserts those counts/fingerprints before COMMIT, excluding
  only the added organization_id. This includes private profiles and the archived
  singleton; trigger modes are also asserted. Any mismatch aborts the transaction.
  Every existing public sequence is also captured by OID/name, definition,
  last_value and is_called, then checked unchanged before COMMIT. No sequence is
  advanced or reset for verification. Quiesce direct sequence consumers as well
  as application writes during any future rehearsal/rollout: sequence advances
  are not undone by PostgreSQL rollback.
- SafeImport source uniqueness, source-match joins, live-match joins, advisory
  idempotency locks, replay lookup and reconciliation are tenant scoped. Reusing
  one actor/key in another workspace creates an independent import. Historical
  results gain `organization_id` only in the response, without rewriting storage.
  Existing payload hashes are preserved. New warning tokens include the tenant;
  discard pre-migration review tokens and re-review before committing.
- New imports lock their organization currency row and then the existing global
  projects write-exclusion lock. Exact warnings are rechecked and acknowledged.
  Successful historical replays precede current-currency validation. Amounts are
  not converted or rewritten when the selected organization's currency changes.
  Demo has a table-level CAD invariant and its currency RPC rejects non-CAD even
  for eligible admins. The seed preserves existing settings verbatim; a legacy
  non-CAD singleton fails the invariant instead of being silently rewritten.
- Existing approval, review-cycle verification, requester/reviewer/approver/controller
  separation, baseline drift detection and audit writes are retained verbatim,
  with tenant guards and predicates added. Last-admin protection is per workspace.
- Membership invitations/removal and ownership transfer are not introduced.
  Role assignment targets must already be workspace members; this foundation
  intentionally has no global Auth-directory lookup or arbitrary-user enrollment.

## Local Static Checks

From the repository root:

```powershell
node --experimental-vm-modules --test tests/organization-workspaces-migration.test.mjs
python supabase/validation/organization_workspaces_parse.py --pglast-path "$env:TEMP/steerfold-phase18-parser"
```

The Node suite has no dependencies or network access. The optional parser uses
an existing readable `pglast` installation; omit `--pglast-path` if it is already
installed normally. It parses SQL and PL/pgSQL without executing either. No
package installation is performed. Sandbox restrictions can require permission
for Node subprocesses or reading the existing temporary parser installation.

Static checks cover prior privileged RPC inventory, exact discovery contracts,
header authorization structure, explicit currency, Demo eligibility, tenant
predicates, import replay/matching/acknowledgements, cross-tenant foreign keys,
RLS replacement, ACL coverage, trigger restoration and unchanged separation rules.
Checks also compare all 17 replaced existing RPC argument names/types/defaults and
return declarations with their latest prior migration definitions. Existing
composite return types keep their type identity and naturally gain organization_id
when their underlying row type gains that column. The exact dropped constraint
`project_imports_actor_key_unique` and index `project_import_rows_source_unique`
are declared by the 20261022 foundation; they are not inferred alternate names.
They do not prove runtime RLS behavior, deployed schema compatibility, concurrent
locking behavior, trigger ordering, performance or PostgreSQL dependency handling.

## Future Database Verification

Owner review evidence supplied for the current environment: the business-ID
generator is SQL and uses only the global `public.project_business_id_seq`, not
projects, organization context or RLS (last_value 12, is_called true at review;
this is evidence, not a fixed future sequence baseline). The only project user
trigger updates NEW.updated_at and returns NEW. No custom auth.users triggers or
external Supabase Auth Hooks are configured. The preflight's three attestations
are now true; all automatic baseline, schema and security assertions still apply.
These attestations do not replace the exact RLS infrastructure body fingerprint.

Not executed or authorized by this task. After separate rollout authorization,
use a disposable clone on PostgreSQL 15+ with all prerequisite migrations and the
actual projects DDL/defaults. Inventory public functions, views, grants, triggers,
Auth signup hooks and sequences, including extension functions outside this repo.
Confirm exposed views cannot bypass tenant RLS and installed trigger functions
cannot perform unscoped reads/writes. Never treat static parsing as an apply test.

Release the workspace-aware frontend and backend together. The old frontend sends
no organization header and will fail closed after the migration; there is no
backward-compatible default workspace or header fallback. Stage and verify the
release order and maintenance window before enabling traffic.

Include a browser-to-Supabase-gateway check from the actual deployed frontend
origin: its OPTIONS preflight must allow `x-steerfold-organization-id` along with
the existing authorization, apikey and content-type headers and required methods.
Check both REST and RPC routes. Verify the gateway forwards the exact selected
UUID into PostgREST request.headers rather than stripping or replacing it: member
requests with valid A/B headers must resolve the corresponding workspace; omitted,
malformed and inaccessible IDs must fail closed. Verify anonymous Demo discovery
and project reads through the same browser/gateway path. CORS success alone does
not establish forwarding or authorization. No live CORS, gateway or header-forwarding
checks were performed by this task.

Before a rollback-only rehearsal, capture sorted `to_jsonb(row)` snapshots of
projects, requests, events, imports, provenance, assignments and profiles. After
the migration compare old business rows against new rows minus organization_id;
all original fields and row counts must match exactly. Compare profile rows and
profile function definitions unchanged. Validate all constraints and trigger modes.

| Case | Required result |
| --- | --- |
| Anon discovery with no header | Exactly Demo, industry text, can_write false |
| Auth user with no memberships | Demo only; no role assignment or private data |
| Workspace creation with no header | Explicit valid currency, empty workspace, owner/admin scoped to new ID |
| Missing/malformed/random/nonmember header | Closed access; no fallback data |
| Anon Demo / auth nonmember Demo reads | Only Demo projects/org context public; private workspace ID denied |
| Anon governance/import history read | Denied, including Demo |
| New authenticated nonmember with Demo header | No requests/events/imports/provenance; simulator uses public projects only |
| Removed membership with own historic Demo imports | No history; invoker reconciliation returns not_found |
| Auth member reading another actor's imports | No batches/provenance visible |
| Normal member Demo project writes and every mutating RPC | Denied without side effects |
| Newly assigned Demo admin | No write eligibility |
| Preserved eligible Demo admin | Maintenance writes permitted; business role/SOD checks still enforced |
| Header A, body organization B | Reject create/update/tenant move |
| Header A, project/request/batch UUID from B | Reject all RPCs, CR creation and child references |
| Same source namespace/ID in A and B | Independent; repeat inside A blocks |
| Same actor/idempotency key in A and B | Independent imports and reconciliation |
| Same key in A, different actor | No replay of original actor's result |
| Import review in A with matching names/source codes only in B | No B conflicts or metadata returned |
| Import warnings reviewed in A then committed in B | A's tokens rejected; B reanalysis required |
| Currency update A concurrently with new import A | Serialized currency check; atomic import |
| Currency update B while import A | B's currency row remains independent |
| Eligible Demo admin attempts currency USD/GBP/EUR | Reject; Demo remains CAD |
| Currency changed after committed import | Identical replay returns original currency/results |
| Role assignment/revocation/directory in A | Only A members/roles; B admin confers no A authority |
| Last admin removal in A when B has admins | Reject; A must retain an admin |
| All CR lifecycle, review cycles and baseline apply | Existing role/SOD, drift, exact-once rules retained |
| Delete imported project | Keep source identity and code/name snapshot; project UUID null, org ID retained |
| New Auth signup | No memberships or governance roles; personal profile behavior unchanged |

End the rehearsal with ROLLBACK and verify original schema/data/privileges are
restored. Do not use a reverse migration as a substitute for a recoverable backup:
after real multi-workspace writes, collapsing tenants back to a singleton is lossy.

## Owner-Run Rollback Rehearsal

Three local artifacts are prepared; none was executed against Supabase. They are
not permanent rollout commands. Prefer a disposable clone; any owner-run rehearsal
in the verified live environment requires a recoverable backup and a maintenance
window. Quiesce application, Auth/profile and direct sequence writers through all
three steps. Expect DDL/source-table locks and a 120-second rehearsal timeout.
External diagnostic server logs from the already-reviewed ensure_rls trigger can
persist; no external hooks or business-ID generators are invoked by the probes.

Owner execution order in the intended Supabase SQL Editor, as postgres:

1. Run the entire `organization_workspaces_baseline_capture.sql`. This is read-only
   and ends in ROLLBACK. Save the complete `BASELINE_MANIFEST` JSON result outside
   the transaction. If it errors, issue `ROLLBACK;` and stop. It requires the
   approved counts/fingerprint, Brisk & Zip/CAD and business sequence 12/called.
2. Copy the baseline-capture result cell verbatim in place of JSON `null` in the single marked
   `$baseline_manifest$...$baseline_manifest$` constant in BOTH
   `organization_workspaces_rehearsal.sql` and
   `organization_workspaces_rollback_verify.sql`. Do not replace other nulls or
   derive a replacement baseline from post-rehearsal state. The capture exports
   JSON as safe text, with every dollar sign encoded as JSON `\u0024`, preventing
   text fields from closing either the inner literal or outer DO dollar quotes.
   Preserve these escapes; do not JSON-reformat/unescape the cell, paste a CSV/grid
   wrapper, or edit the delimiter tags. The `::jsonb` cast restores the original
   characters before full equality checks. Inputs intentionally
   fail closed until supplied. Do not save private manifests in Git.
3. Review and run the ENTIRE `organization_workspaces_rehearsal.sql`. Its locked
   baseline must match the saved manifest before migration logic starts. The exact
   reviewed migration is retained between clearly marked rehearsal-only insertions;
   only its final transaction COMMIT is replaced with ROLLBACK. The synchronization
   test reconstructs the original SQL byte-for-byte after LF normalization.
   A successful run returns `PASS_BEFORE_ROLLBACK`, repeats the baseline manifest,
   then rolls back. This is not proof of rollback until step 4 passes.
4. After success OR any error, explicitly issue `ROLLBACK;` before further SQL if
   there is any uncertainty about session state. Never COMMIT an errored/interrupted
   rehearsal. Run the ENTIRE separate `organization_workspaces_rollback_verify.sql`
   with the ORIGINAL saved manifest. It is read-only and ends in ROLLBACK. Require
   `PASS_AFTER_ROLLBACK`. A mismatch is STOP: investigate, do not reset a sequence,
   rerun a migration, or replace the original baseline to make it pass.

The saved manifest hashes all original business/history/profile rows and semantic
public catalogs: relations/RLS/ACLs, columns/defaults, constraints, indexes,
policies, public/Auth function definitions/security/ACLs, user triggers and modes,
event triggers, schema ACLs, roles/memberships/default ACLs, and definitions/state
of every public sequence. Planner statistics and physical storage files are not
identity assertions. The separate capture is necessary because an errored SQL
Editor multi-statement run may not return an earlier result grid. The verifier
also independently rejects workspace tables/archive/project ownership left behind.

Inside the rehearsal, new-table RLS is checked BEFORE explicit migration RLS setup
to verify ensure_rls behavior. Expected schema/FKs/indexes/RPC signatures/ACLs,
membership/backfill, settings/profile preservation and unknown privileged objects
are checked. JWT probes use SET LOCAL ROLE authenticated/anon, not owner-only
queries masquerading as RLS tests. Synthetic A/B organizations and project rows
use the existing reviewed admin; a third inaccessible fixture organization has
no membership. The admin belongs to A and B, with governance_admin in A only;
discovery correctly includes A/B plus Demo but not the inaccessible fixture.
No Auth users are created. Every project column,
including UUID/business ID/audit fields, is supplied from an explicit populated
composite so no project default/generator executes. Fixture collision checks fail
closed. Fixture setup is a separate SQL statement before validation, so STABLE
authorization functions and view-planning snapshots see already-existing rows.
Creating fixtures and testing the security-barrier settings view inside one DO
command reproduced a false Organization access denied in an isolated PostgreSQL
engine, even with the correct admin/A identity; preceding-statement setup fixes it
without changing the migration. This was not an earlier negative-probe state leak.

The session-private SECURITY INVOKER `pg_temp.workspace_rehearsal_probe` sets the
complete actor/role/header context for each of 20 reviewed SQL probes. A deliberate
PZ002 exception restores the previous context after success; an expected SQLSTATE
is accepted only after actual query execution started. Both paths check exact
restoration of current_user, role, headers, sub, JWT role and claims. Unexpected
failures also restore context before being rethrown, with the observed simulated
identity in diagnostics. No positive settings failure is accepted as an expected
denial. Dynamic SQL inputs are trusted artifact literals or safely quoted %L data,
never baseline JSON. Browser roles cannot execute the temporary runner directly.
Owner cleanup removes only fixture IDs before the original final preservation
assertions. The final outer ROLLBACK discards migration, helper and all fixture
changes. On any setup/cleanup error, stop and issue ROLLBACK; do not continue.

Probes cover selected A/B and Brisk & Zip Demo reads, inaccessible/missing/malformed
headers, membership-only discovery, private history/profile isolation, blocked
cross-tenant project updates/ownership moves and a rejected cross-tenant baseline
RPC call. Read-only Safe Import review checks tenant-local matches and current
workspace currency; reconciliation cannot expose another workspace's history.
Governance Admin is not a workflow wildcard. The CURRENT reviewed migration still
allows anonymous Demo project reads/discovery, but not private workspaces,
profiles, governance or import history. Authenticated-only Demo remains a separate
unapproved policy change, not silently introduced by this rehearsal.

This is not a load/concurrency or browser/gateway test, nor a full successful
workflow/import-commit exercise. No import commit, business-ID advancement,
signup, profile bootstrap/save, successful lifecycle action or baseline change is
performed. Runtime PostgreSQL/dependency compatibility remains unproven until the
owner executes the rehearsal. If it fails, preserve the error and verify rollback;
do not alter the migration merely to make a probe pass.

Local static commands (no SQL execution):

```powershell
node --experimental-vm-modules --test tests/organization-workspaces-migration.test.mjs tests/organization-workspaces-rehearsal.test.mjs
python supabase/validation/organization_workspaces_parse.py --pglast-path "$env:TEMP/steerfold-phase18-parser" --sql-file supabase/validation/organization_workspaces_rehearsal.sql --rollback-only
python supabase/validation/organization_workspaces_parse.py --pglast-path "$env:TEMP/steerfold-phase18-parser" --sql-file supabase/validation/organization_workspaces_rollback_verify.sql --rollback-only
python supabase/validation/organization_workspaces_parse.py --pglast-path "$env:TEMP/steerfold-phase18-parser" --sql-file supabase/validation/organization_workspaces_baseline_capture.sql --rollback-only
```

`tests/workspace-authorization-probes.test.mjs` additionally reproduces the original
failure and exercises the exact temporary runner and migration authorization/view
definitions against an isolated in-memory PostgreSQL engine, never Supabase. Set
`STEERFOLD_PGLITE_PATH` to an independently installed PGlite `dist/index.js` and run
that Node test (or the full suite). It skips explicitly when no engine path is
provided; it neither downloads dependencies nor creates a persistent database.
The static parser also parses all 20 dynamic SQL templates and nested DO bodies.
The full live migration/rehearsal is still NOT executed by these local tests.
