import { APP_CONFIG } from "./app-config.js";

export const IMPORT_FIELDS = [
  { key: "projectId", label: "Project ID", required: false, aliases: ["id", "projectid"] },
  { key: "projectName", label: "Project Name", aliases: ["project", "name"] },
  { key: "projectManager", label: "Project Manager", aliases: ["pm", "manager"] },
  { key: "projectType", label: "Project Type", aliases: ["type", "category", "businessunit"] },
  { key: "strategicPriority", label: "Strategic Priority", options: ["High", "Medium", "Low"], aliases: ["priority"] },
  { key: "budgetBAC", label: "Budget at Completion (BAC)", type: "money", aliases: ["bac", "budget", "approvedbudget"] },
  { key: "plannedValuePV", label: "Planned Value (PV)", type: "money", aliases: ["pv", "plannedvalue"] },
  { key: "earnedValueEV", label: "Earned Value (EV)", type: "money", aliases: ["ev", "earnedvalue"] },
  { key: "actualCostAC", label: "Actual Cost (AC)", type: "money", aliases: ["ac", "actualcost", "amountspent"] },
  { key: "percentComplete", label: "Percent Complete", type: "percent", aliases: ["completion", "complete", "percentcomplete", "percentagecomplete"] },
  { key: "riskScore", label: "Risk Score", type: "risk", aliases: ["risk"] },
  { key: "startDate", label: "Start Date", type: "date", aliases: ["start"] },
  { key: "endDate", label: "End Date", type: "date", aliases: ["end", "finish", "finishdate"] },
  { key: "resourceDemand", label: "Resource Demand", options: ["High", "Medium", "Low"], aliases: ["resources"] },
  { key: "projectStatus", label: "Project Status", options: ["On Track", "At Risk", "Critical"], aliases: ["status"] },
].map((field) => Object.freeze({ required: true, ...field }));

const normalizedHeader = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const currencyCode = APP_CONFIG.portfolio.currencyCode;
const currencySymbol = new Intl.NumberFormat(APP_CONFIG.portfolio.locale, { style: "currency", currency: currencyCode })
  .formatToParts(0).find((part) => part.type === "currency").value;
const currencyPrefixes = [...new Set([currencyCode, currencySymbol, ...(currencySymbol.includes("$") ? ["$"] : [])])];

export function suggestImportMappings(headers) {
  const used = new Set();
  return headers.map((header) => {
    const name = normalizedHeader(header);
    const field = IMPORT_FIELDS.find((item) => [item.key, item.label, ...item.aliases].some((alias) => normalizedHeader(alias) === name));
    if (!field || used.has(field.key)) return "";
    used.add(field.key);
    return field.key;
  });
}

export function validateImportMappings(mappings) {
  const issues = [];
  IMPORT_FIELDS.forEach((field) => {
    const count = mappings.filter((key) => key === field.key).length;
    if (!count && field.required) issues.push(`${field.label} must be mapped.`);
    if (count > 1) issues.push(`${field.label} is mapped more than once.`);
  });
  if (mappings.some((key) => key && !IMPORT_FIELDS.some((field) => field.key === key))) issues.push("A mapping uses an unsupported field.");
  return issues;
}

function normalizeDate(value) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!iso && !slash) return null;
  const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(slash[3]), Number(slash[1]), Number(slash[2])];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function numericValue(value, monetary = false) {
  let text = String(value).trim();
  if (monetary) {
    for (const prefix of currencyPrefixes) {
      if (text.startsWith(prefix)) { text = text.slice(prefix.length).trim(); break; }
    }
    if (text.endsWith(currencyCode)) text = text.slice(0, -currencyCode.length).trim();
  }
  // Accept ungrouped decimals or comma-separated thousands, not malformed grouping.
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text.replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

export function validateImportRows(source, mappings, percentMode = "percent") {
  const mappingIssues = validateImportMappings(mappings);
  const rows = source.rows.map((row) => {
    const project = {};
    const errors = [];
    const warnings = [];
    IMPORT_FIELDS.forEach((field) => {
      const column = mappings.indexOf(field.key);
      if (column < 0) return;
      const raw = row.values[column];
      if (row.cellErrors?.includes(column)) {
        errors.push(`${field.label} contains a spreadsheet error.`);
        project[field.key] = null;
        return;
      }
      const text = String(raw ?? "").trim();
      if (!text) {
        if (field.required) errors.push(`${field.label} is required.`);
        return;
      }
      let value = text;
      if (field.type === "date") {
        value = normalizeDate(row.dates?.[column] ?? text);
        if (!value) errors.push(`${field.label} must be a valid YYYY-MM-DD or M/D/YYYY date.`);
      } else if (["money", "risk", "percent"].includes(field.type)) {
        const markedPercent = text.endsWith("%");
        value = numericValue(field.type === "percent" && markedPercent ? text.slice(0, -1) : text, field.type === "money");
        if (value === null) errors.push(`${field.label} must be numeric${field.type === "money" ? ` in ${APP_CONFIG.portfolio.currencyCode}` : ""}.`);
        else if (field.type === "percent") {
          if (markedPercent || (percentMode === "percent" && !row.percentages?.includes(column))) value /= 100;
          if (value < 0 || value > 1) errors.push("Percent Complete must be between 0% and 100%.");
        } else if (field.type === "risk" && (value < 0 || value > 25)) errors.push("Risk Score must be between 0 and 25.");
        else if (field.type === "money" && value < 0) errors.push(`${field.label} must be zero or greater.`);
      } else if (field.options) {
        value = field.options.find((option) => option.toLowerCase() === text.toLowerCase());
        if (!value) errors.push(`${field.label} must be ${field.options.join(", ")}.`);
      }
      if (row.formulas?.includes(column)) warnings.push(`${field.label} uses a cached spreadsheet formula result; formulas are not recalculated.`);
      project[field.key] = value ?? null;
    });
    if (project.startDate && project.endDate && project.endDate < project.startDate) errors.push("End Date must be on or after Start Date.");
    return { rowNumber: row.rowNumber, project, errors, warnings };
  });
  const ids = new Map();
  rows.forEach((row) => {
    if (!row.project.projectId) return;
    const id = row.project.projectId;
    if (!ids.has(id)) ids.set(id, []);
    ids.get(id).push(row);
  });
  ids.forEach((matches, id) => {
    if (matches.length > 1) matches.forEach((row) => row.errors.push(`Duplicate source Project ID: ${id}.`));
  });
  const summary = { valid: 0, warning: 0, error: 0 };
  rows.forEach((row) => {
    row.status = row.errors.length || mappingIssues.length ? "error" : row.warnings.length ? "warning" : "valid";
    summary[row.status] += 1;
  });
  return { rows, summary, mappingIssues };
}
