const PROJECT_FIELDS = {
  projectName: "project_name", projectManager: "project_manager", projectType: "project_type",
  strategicPriority: "strategic_priority", budgetBAC: "budget_bac", plannedValuePV: "planned_value_pv",
  earnedValueEV: "earned_value_ev", actualCostAC: "actual_cost_ac", percentComplete: "percent_complete",
  riskScore: "risk_score", startDate: "start_date", endDate: "end_date",
  resourceDemand: "resource_demand", projectStatus: "project_status",
};

export function buildProjectImportPayload({ results, selectedRows, fileName, worksheetName, sourceNamespace }) {
  if (!results || results.mappingIssues.length || results.summary.error) {
    throw new Error("Resolve validation errors and missing mappings before reviewing conflicts.");
  }
  const rows = results.rows.filter((row) => selectedRows.has(row.rowNumber));
  if (!rows.length) throw new Error("Select at least one valid row to review.");
  if (rows.some((row) => row.errors.length)) throw new Error("Selected rows contain validation errors.");
  return {
    contract_version: 1,
    file_name: fileName,
    worksheet_name: worksheetName || null,
    source_namespace: sourceNamespace?.trim() || null,
    currency_code: "CAD",
    rows: rows.map((row) => ({
      source_row: row.rowNumber,
      source_project_id: row.project.projectId?.trim() || null,
      project: Object.fromEntries(Object.entries(PROJECT_FIELDS).map(([key, column]) => [column, row.project[key]])),
    })),
  };
}

export const CONFLICT_MESSAGES = {
  invalid_project: "Project values failed server validation. Review this row's required fields, amounts and dates.",
  duplicate_source_id: "The same source Project ID appears more than once in this batch.",
  source_id_already_imported: "This source Project ID was already imported in this namespace.",
  name_match: "Project name matches an existing Steerfold project.",
  name_manager_match: "Project name and manager match an existing project.",
  name_start_date_match: "Project name and start date match an existing project.",
  name_manager_start_date_match: "Project name, manager and start date match an existing project.",
  source_id_matches_live_code: "Source Project ID matches an existing Steerfold project code.",
  name_repeated_in_upload: "Multiple selected rows use the same normalized project name.",
};

export function normalizeImportAnalysis(value, payload) {
  const invalid = () => { throw new Error("The server returned an unsupported or incomplete conflict review. Run Review Conflicts again."); };
  const hash = (text) => typeof text === "string" && /^[a-f0-9]{64}$/.test(text);
  const count = (number) => Number.isSafeInteger(number) && number >= 0;
  if (!value || value.contract_version !== 1 || !hash(value.payload_hash)
    || value.rows_submitted !== payload.rows.length
    || !count(value.blocking_count) || !count(value.warning_count)
    || !Array.isArray(value.blocking_conflicts) || !Array.isArray(value.warnings)
    || value.blocking_count !== value.blocking_conflicts.length || value.warning_count !== value.warnings.length
    || value.warning_count > 10000 || value.ready_for_confirmation !== (value.blocking_count === 0)
    || value.requires_acknowledgement !== (value.warning_count > 0)) invalid();
  const rowNumbers = new Set(payload.rows.map((row) => row.source_row));
  const ids = new Set();
  function normalize(item, warning) {
    const allowed = warning
      ? ["name_match", "name_manager_match", "name_start_date_match", "name_manager_start_date_match", "source_id_matches_live_code", "name_repeated_in_upload"]
      : ["invalid_project", "duplicate_source_id", "source_id_already_imported"];
    if (!item || !allowed.includes(item.code)) invalid();
    const grouped = ["duplicate_source_id", "name_repeated_in_upload"].includes(item.code);
    if (grouped ? !Array.isArray(item.source_rows) || item.source_rows.length < 2
      || new Set(item.source_rows).size !== item.source_rows.length || item.source_rows.some((row) => !rowNumbers.has(row))
      : !rowNumbers.has(item.source_row)) invalid();
    if (warning && (!hash(item.conflict_id) || ids.has(item.conflict_id))) invalid();
    if (warning) ids.add(item.conflict_id);
    const result = { code: item.code };
    if (grouped) result.source_rows = [...item.source_rows];
    else result.source_row = item.source_row;
    if (warning) result.conflict_id = item.conflict_id;
    // Only business context is exposed to the renderer, never SQL details or hints.
    for (const key of ["source_project_id", "existing_project_id", "existing_project_name", "existing_project_manager", "existing_start_date"]) {
      if (item[key] != null) {
        if (typeof item[key] !== "string" || item[key].length > 1000) invalid();
        result[key] = item[key];
      }
    }
    if (warning && !grouped && !result.existing_project_id) invalid();
    return result;
  }
  return {
    contract_version: 1, payload_hash: value.payload_hash, rows_submitted: value.rows_submitted,
    blocking_count: value.blocking_count, warning_count: value.warning_count,
    ready_for_confirmation: value.ready_for_confirmation, requires_acknowledgement: value.requires_acknowledgement,
    blocking_conflicts: value.blocking_conflicts.map((item) => normalize(item, false)),
    warnings: value.warnings.map((item) => normalize(item, true)),
  };
}

export function createConflictReview() {
  let revision = 0;
  let analysis = null;
  const acknowledgements = new Set();
  return {
    get revision() { return revision; },
    get analysis() { return analysis; },
    get acknowledgedCount() { return acknowledgements.size; },
    get ready() { return !!analysis && analysis.ready_for_confirmation && acknowledgements.size === analysis.warning_count; },
    invalidate() { revision += 1; analysis = null; acknowledgements.clear(); },
    accept(result, expectedRevision) {
      if (revision !== expectedRevision) return false;
      analysis = result;
      acknowledgements.clear();
      return true;
    },
    isAcknowledged(id) { return acknowledgements.has(id); },
    acknowledge(id, checked) {
      if (!analysis?.warnings.some((warning) => warning.conflict_id === id)) return;
      if (checked) acknowledgements.add(id); else acknowledgements.delete(id);
    },
    acknowledgeAll() { analysis?.warnings.forEach((warning) => acknowledgements.add(warning.conflict_id)); },
  };
}
