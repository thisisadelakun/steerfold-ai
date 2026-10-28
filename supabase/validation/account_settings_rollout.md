# Account and Organization Settings: Approval Boundary

## Final Owner-Run Rollout

The owner reported successful preflight and rollback-only validation. This does
not apply or authorize automatic application of either migration.

Use `supabase/validation/account_settings_owner_rollout.sql` for the approved
owner-run rollout, not the rollback dry-run file. It contains both exact reviewed
migration bodies in dependency order, omitting only their individual transaction
wrappers in favor of one atomic outer transaction. It DOES contain a COMMIT.
Neither source migration is edited. Do not also run the two migrations separately.

1. Confirm the intended Supabase project (`jjueiraqxzubqsdnzway`) and owner SQL
   Editor role. Obtain the approved recoverable backup and pause project,
   governance, import and settings writes during this short rollout window.
2. Confirm these still-unapplied files remain the reviewed versions:
   `20261026_organization_currency.sql`, then `20261027_company_user_profiles.sql`.
   Do not replay other migrations or run a blanket `db push`.
3. Open a fresh SQL Editor query, paste the ENTIRE owner-rollout script, review
   the COMMIT boundary, and run once. Never execute only a selected fragment.
   The script stops if settings/profiles already exist or the baseline differs.
4. The required baseline is 11 projects with fingerprint
   `8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758`,
   1 import, 1 import row, 2 change requests and 11 change-request events.
   Pre-commit full-row hashes also check historical import currency/results and
   all project columns, including BAC/PV/EV/AC, are unchanged. No write RPC or
   business-ID generator is invoked. Brisk & Zip is seeded as CAD, never changed.
5. Confirm PASS notices and post-commit results: Brisk & Zip/CAD, profile RLS,
   required RPCs, the same project fingerprint and the same history counts.
   Historical currency fields must match the PRE_ROLLOUT output. The intended
   account is checked for an existing recognized Governance Admin assignment;
   the script does not assign roles or establish a permanent administrator.
6. If any error occurs before COMMIT, run `ROLLBACK;` and stop. If a post-commit
   verification fails, COMMIT has already happened: do not blindly rerun or drop
   data. Preserve the result/error, inspect concurrent writes and use the reviewed
   recovery process below. Do not deploy the frontend until verification passes.
7. Keep the SQL Editor execution record with both source migration filenames.
   This script does not fabricate CLI migration-ledger entries.

### Immediate Browser Acceptance

After the owner-approved frontend deployment, perform these deliberate saves;
the SQL rollout itself does not create or edit personal profiles.

- Account: reload, enter Full Name and Job Title, save, reload, then sign out/in.
  Verify both values persist and the saved identity/initials appear consistently.
  Existing signup metadata may initialize a missing profile on first authenticated
  read; users without valid metadata retain the profile-completion form.
- Settings: verify Organization Name is Brisk & Zip; save the intended Industry
  and reload to verify persistence. Confirm Organization Currency is CAD.
- As Governance Admin, save CAD without changing the selection. This must not
  require a currency-change acknowledgement or rewrite financial data.
- Do NOT select/save a different production organization currency. Do not create,
  edit, delete or import projects, change governance requests, or test passwords
  as part of this acceptance. Display Currency remains presentation-only.
- Confirm account/profile errors are not hidden, public reads still work while
  signed out, and ordinary users cannot edit organization settings.

## Earlier Preparation and Recovery Context

Nothing in this change has been applied to Supabase. The configured application
project reference is `jjueiraqxzubqsdnzway`; its environment must be confirmed by
the owner in the Supabase dashboard, not inferred from its URL alone.

## Before Approval

1. Run `account_settings_preflight.sql` using an authorized database session in
   the confirmed project. It is read-only and ends with ROLLBACK. Inspect the
   actual migration ledger (or SQL Editor deployment records), schema, existing
   organization/profile records, RLS and grants. Keep the project fingerprint.
   Supply the intended Auth user UUID in `v_admin_user_id` first. An unset UUID,
   missing governance structures, unsupported governance_admin role or missing
   existing assignment blocks rollout. The script makes no role assignments and
   probes the helper using transaction-local JWT context that is restored.
2. Stop if either proposed migration version is already applied, if the new
   relations/functions already exist, or if the live schema differs. Reconcile
   explicitly; do not use IF NOT EXISTS, reset, seed overwrite or blanket db push.
3. Verify all prerequisites from `20261026_organization_currency.sql`, including
   the deployed Safe Import and Governance role functions. Several older local
   migrations share a date/version prefix: do not infer a usable CLI deployment
   ledger or automatically replay historical files.
4. Confirm the Brisk & Zip seed is CAD. Export a recoverable schema/data backup
   using the owner's approved backup process, outside the public Git repository.
5. In staging, run each exact migration body inside an operator-controlled
   transaction with final COMMIT replaced by ROLLBACK. Check runtime function
   creation, RLS, grants, own-profile access and existing project policies. Do not
   call project/import commit RPCs or consume project IDs in the dry-run.

## Explicit Application Order (After Owner Approval Only)

1. `20261026_organization_currency.sql`
2. `20261027_company_user_profiles.sql`

The profile migration was previously named
`20261026000100_company_user_profiles.sql`. It was local/unapplied; the new version
sorts after the currency dependency under both filename and version ordering.
Each file is transactional. Do not run either as part of frontend deployment.

## Acceptance and Recovery

- Verify authoritative organization currency is CAD. Projects/financial values
  must match the preflight fingerprint; no financial conversion is authorized.
- With owner-provided test accounts in staging, save/reload personal details,
  sign out/in, and verify initials. Check another user's row cannot be read or
  changed. Ordinary users must be denied organization writes server-side.
  For signup, verify Auth user metadata contains `full_name` while email
  verification is pending. On the first authenticated profile read, a missing
  profile is initialized from that server-side metadata only. Existing profiles
  are not overwritten. Users without a valid supplied name complete the normal
  profile form. Verify created_at remains fixed while updated_at advances on edits.
- With a Governance Admin test account in staging, save/reload name/industry.
  Currency changes must require the warning and explicit acknowledgement. Reject
  real changes without p_confirm = true, stale expected-current currency and
  unauthorized callers. Confirm an approved change updates only the organization
  setting: existing numeric project/governance amounts are reinterpreted, not
  converted. Recorded import history remains unchanged. Do not change production
  CAD as part of deployment or acceptance without separate approval.
- Test password changes/verification only with the account owner's participation;
  no live password or verification-email operation was performed by this change.
- If application fails before COMMIT, the transaction rolls back. If a problem
  appears after COMMIT, revert the frontend release and revoke new mutation RPC
  grants through an approved recovery change if needed. Preserve any saved
  profiles/history; prefer a reviewed forward fix. Do not drop populated tables
  or rewrite financial records as a rollback shortcut. Restore backups only with
  explicit owner approval and a reviewed data-loss assessment.

Production approval and a credentialed deployment session (or owner-run SQL)
are required before persistent saves can be verified against Supabase. Never
paste service-role keys, database passwords or session tokens into source/chat.
