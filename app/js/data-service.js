import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
} from "./supabase-config.js";

import { getValidAccessToken } from "./auth-service.js";

const PROJECTS_CSV_PATH = "data/Steerfold_AI_Project_Data.csv";

const USE_SUPABASE = true;

let lastPortfolioDataSource = null;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if (
      (character === "\n" || character === "\r") &&
      !inQuotes
    ) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      row.push(field);
      rows.push(row);

      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows.filter((csvRow) => {
    return csvRow.some((value) => value.trim() !== "");
  });

  return dataRows.map((dataRow) => {
    return headers.reduce((record, header, index) => {
      record[header.trim()] = (dataRow[index] ?? "").trim();
      return record;
    }, {});
  });
}

function parseNumber(value) {
  const normalizedValue = String(value ?? "")
    .replace(/[$,%\s]/g, "")
    .replace(/,/g, "");

  const parsedValue = Number(normalizedValue);

  return Number.isNaN(parsedValue) ? 0 : parsedValue;
}

function parsePercent(value) {
  return parseNumber(value) / 100;
}

function normalizeProject(row) {
  return {
    projectId: row.Project_ID,
    projectName: row.Project_Name,
    projectManager: row.Project_Manager,
    projectType: row.Project_Type,
    strategicPriority: row.Strategic_Priority,
    budgetBAC: parseNumber(row.Budget_BAC),
    plannedValuePV: parseNumber(row.Planned_Value_PV),
    earnedValueEV: parseNumber(row.Earned_Value_EV),
    actualCostAC: parseNumber(row.Actual_Cost_AC),
    percentComplete: parsePercent(row.Percent_Complete),
    riskScore: parseNumber(row.Risk_Score),
    startDate: row.Start_Date,
    endDate: row.End_Date,
    resourceDemand: row.Resource_Demand,
    projectStatus: row.Project_Status,
  };
}

async function loadProjectsFromCsv() {
  const response = await fetch(PROJECTS_CSV_PATH);

  if (!response.ok) {
    throw new Error(
      `CSV request failed with status ${response.status}`,
    );

  }

  const csvText = await response.text();

  return parseCsv(csvText).map(normalizeProject);
}

function convertSupabaseDate(value) {
  if (typeof value !== "string") {
    return value;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return value;
  }

  return `${month}/${day}/${year}`;
}

function normalizeSupabaseProject(row) {
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    projectManager: row.project_manager,
    projectType: row.project_type,
    strategicPriority: row.strategic_priority,
    budgetBAC: parseNumber(row.budget_bac),
    plannedValuePV: parseNumber(row.planned_value_pv),
    earnedValueEV: parseNumber(row.earned_value_ev),
    actualCostAC: parseNumber(row.actual_cost_ac),
    percentComplete: parseNumber(row.percent_complete),
    riskScore: parseNumber(row.risk_score),
    startDate: convertSupabaseDate(row.start_date),
    endDate: convertSupabaseDate(row.end_date),
    resourceDemand: row.resource_demand,
    projectStatus: row.project_status,
  };
}

function isValidDateParts(year, month, day) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return false;
  }

  const daysByMonth = [
    31,
    year % 4 === 0 &&
    (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysByMonth[month - 1];
}

function formatSupabaseDate(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function convertFrontendDateToSupabaseDate(value) {
  if (typeof value !== "string") {
    return value;
  }

  const normalizedMatch =
    value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (normalizedMatch) {
    const [, yearText, monthText, dayText] =
      normalizedMatch;

    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);

    if (isValidDateParts(year, month, day)) {
      return value;
    }

    return value;
  }

  const slashDateMatch =
    value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!slashDateMatch) {
    return value;
  }

  const [, monthText, dayText, yearText] =
    slashDateMatch;

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!isValidDateParts(year, month, day)) {
    return value;
  }

  return formatSupabaseDate(
    year,
    month,
    day,
  );
}

function mapProjectToSupabaseRow(project) {
  return {
    project_name: project.projectName,
    project_manager: project.projectManager,
    project_type: project.projectType,
    strategic_priority: project.strategicPriority,
    budget_bac: project.budgetBAC,
    planned_value_pv: project.plannedValuePV,
    earned_value_ev: project.earnedValueEV,
    actual_cost_ac: project.actualCostAC,
    percent_complete: project.percentComplete,
    risk_score: project.riskScore,
    start_date: convertFrontendDateToSupabaseDate(
      project.startDate,
    ),
    end_date: convertFrontendDateToSupabaseDate(
      project.endDate,
    ),
    resource_demand: project.resourceDemand,
    project_status: project.projectStatus,
  };
}

async function getAuthenticatedHeaders() {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    throw new Error(
      "Authentication is required to modify projects.",
    );
  }

  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

async function getSupabaseErrorMessage(response, fallbackMessage) {
  try {
    const errorData = await response.json();

    const messageParts = [
      errorData?.message,
      errorData?.details,
      errorData?.hint,
      errorData?.error_description,
      errorData?.msg,
    ].filter(Boolean);

    if (messageParts.length > 0) {
      return messageParts.join(" ");
    }
  } catch {
    // Keep fallback message if JSON parsing fails
  }

  return fallbackMessage;
}

async function parseReturnedRows(response) {
  try {
    const rows = await response.json();

    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

const csvProvider = {
  loadProjects: loadProjectsFromCsv,

  async getProject(projectId) {
    const projects = await loadProjectsFromCsv();

    return (
      projects.find(
        (project) => project.projectId === projectId,
      ) ?? null
    );
  },
};

const supabaseProvider = {
  async loadProjects() {
    const url = new URL("/rest/v1/projects", SUPABASE_URL);
    url.searchParams.set("select", "*");
    url.searchParams.set("order", "project_id.asc");

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Supabase loadProjects failed with status ${response.status}`,
      );
    }

    const rows = await response.json();

    return rows.map(normalizeSupabaseProject);
  },

  async getProject(projectId) {
    const url = new URL("/rest/v1/projects", SUPABASE_URL);
    url.searchParams.set("select", "*");
    url.searchParams.set("project_id", `eq.${projectId}`);
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Supabase getProject failed with status ${response.status}`,
      );
    }

    const rows = await response.json();

    if (!rows || rows.length === 0) {
      return null;
    }

    return normalizeSupabaseProject(rows[0]);
  },

  async createProject(projectData) {
    const url = new URL("/rest/v1/projects", SUPABASE_URL);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        ...(await getAuthenticatedHeaders()),
        Prefer: "return=representation",
      },
      body: JSON.stringify(
        mapProjectToSupabaseRow(projectData),
      ),
    });

    if (!response.ok) {
      throw new Error(
        await getSupabaseErrorMessage(
          response,
          `Supabase createProject failed with status ${response.status}`,
        ),
      );
    }

    const rows = await parseReturnedRows(response);

    if (!rows || rows.length === 0) {
      throw new Error(
        "Project creation did not return a project row.",
      );
    }

    return normalizeSupabaseProject(rows[0]);
  },

  async updateProject(projectId, projectData) {
    const url = new URL("/rest/v1/projects", SUPABASE_URL);
    url.searchParams.set("project_id", `eq.${projectId}`);

    const response = await fetch(url.toString(), {
      method: "PATCH",
      headers: {
        ...(await getAuthenticatedHeaders()),
        Prefer: "return=representation",
      },
      body: JSON.stringify(
        mapProjectToSupabaseRow(projectData),
      ),
    });

    if (!response.ok) {
      throw new Error(
        await getSupabaseErrorMessage(
          response,
          `Supabase updateProject failed with status ${response.status}`,
        ),
      );
    }

    const rows = await parseReturnedRows(response);

    if (!rows || rows.length === 0) {
      throw new Error(
        "Project could not be found for update.",
      );
    }

    return normalizeSupabaseProject(rows[0]);
  },

  async deleteProject(projectId) {
    const url = new URL("/rest/v1/projects", SUPABASE_URL);
    url.searchParams.set("project_id", `eq.${projectId}`);

    const response = await fetch(url.toString(), {
      method: "DELETE",
      headers: {
        ...(await getAuthenticatedHeaders()),
        Prefer: "return=representation",
      },
    });

    if (!response.ok) {
      throw new Error(
        await getSupabaseErrorMessage(
          response,
          `Supabase deleteProject failed with status ${response.status}`,
        ),
      );
    }

    const rows = await parseReturnedRows(response);

    if (!rows || rows.length === 0) {
      throw new Error(
        "Project could not be found for deletion.",
      );
    }

    return normalizeSupabaseProject(rows[0]);
  },
};

export async function loadPortfolioData({
  allowCsvFallback = true,
} = {}) {
  if (USE_SUPABASE === false) {
    lastPortfolioDataSource = "csv";
    return csvProvider.loadProjects();
  }

  try {
    const projects = await supabaseProvider.loadProjects();

    lastPortfolioDataSource = "supabase";

    return projects;
  } catch (error) {
    if (!allowCsvFallback) {
      throw error;
    }

    console.warn(
      "Supabase load failed. Falling back to CSV.",
      error,
    );

    const projects = await csvProvider.loadProjects();

    lastPortfolioDataSource = "csv-fallback";

    return projects;
  }
}

export function getLastPortfolioDataSource() {
  return lastPortfolioDataSource;
}

export async function getProject(projectId) {
  if (USE_SUPABASE === false) {
    return csvProvider.getProject(projectId);
  }

  try {
    return await supabaseProvider.getProject(projectId);
  } catch (error) {
    console.warn(
      "Supabase project load failed. Falling back to CSV.",
      error,
    );

    return csvProvider.getProject(projectId);
  }
}

export async function createProject(projectData) {
  if (USE_SUPABASE === false) {
    throw new Error(
      "Project creation requires a writable data provider.",
    );
  }

  return supabaseProvider.createProject(projectData);
}

export async function updateProject(projectId, projectData) {
  if (USE_SUPABASE === false) {
    throw new Error(
      "Project updates require a writable data provider.",
    );
  }

  return supabaseProvider.updateProject(projectId, projectData);
}

export async function deleteProject(projectId) {
  if (USE_SUPABASE === false) {
    throw new Error(
      "Project deletion requires a writable data provider.",
    );
  }

  return supabaseProvider.deleteProject(projectId);
}
