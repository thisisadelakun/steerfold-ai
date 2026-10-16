import { APP_CONFIG } from "./app-config.js";
import { calculateProjectEvm, calculateProjectForecast } from "./portfolio-analytics.js";
import { formatCurrency } from "./formatters.js";
import { createUtilityDialog } from "./utility-dialog.js";

let parserPromise;
const INPUTS = [
  ["budgetBAC", "BAC", "Budget at completion"],
  ["plannedValuePV", "PV", "Planned value"],
  ["earnedValueEV", "EV", "Earned value"],
  ["actualCostAC", "AC", "Actual cost"],
];

async function evaluateArithmetic(expression) {
  const source = expression.trim().replaceAll("\u00d7", "*").replaceAll("\u00f7", "/");
  if (!source || source.length > 256 || !/^[\d\s.+\-*/()%]+$/.test(source)) {
    throw new Error("Enter up to 256 characters using numbers, +, -, \u00d7, \u00f7, %, decimals and parentheses.");
  }
  parserPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      script.remove();
      reject(new Error("Arithmetic is temporarily unavailable. Close and reopen Calculator to try again."));
    }, 15000);
    script.src = new URL("../vendor/mathjs/math.js", import.meta.url).href;
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error("Arithmetic could not be loaded. EVM calculations remain available."));
    };
    document.head.append(script);
  }).catch((error) => {
    parserPromise = null;
    throw error;
  });
  await parserPromise;
  let result;
  try {
    const tree = globalThis.math.parse(source);
    tree.traverse((node) => {
      const number = node.type === "ConstantNode" && typeof node.value === "number";
      const operator = node.type === "OperatorNode" && ["add", "subtract", "multiply", "divide", "unaryMinus", "unaryPlus"].includes(node.fn) && !node.implicit;
      if (!number && !operator && node.type !== "ParenthesisNode") throw new Error("Unsupported expression");
    });
    result = tree.evaluate(new Map());
  } catch {
    throw new Error("Check the expression. Use explicit operators and balanced parentheses; % is a percentage.");
  }
  if (!Number.isFinite(result)) throw new Error("The result is not finite. Check for division by zero or values that are too large.");
  return result;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function openCalculator(project = null) {
  const modal = createUtilityDialog("Calculator", "sf-calculator");
  if (!modal) return;
  const { dialog } = modal;
  dialog.append(element("p", "sf-utility-intro", `Temporary scratchpad. EVM inputs and monetary results use ${APP_CONFIG.portfolio.currencyCode}; nothing is saved.`));

  const arithmetic = element("form", "sf-calculator-form");
  const expressionLabel = element("label", "", "Arithmetic expression");
  expressionLabel.htmlFor = "sf-calculator-expression";
  const expression = element("input");
  expression.id = "sf-calculator-expression";
  expression.type = "text";
  expression.maxLength = 256;
  expression.autocomplete = "off";
  expression.spellcheck = false;
  expression.placeholder = "(175000 - 150000) / 175000 * 100";
  const calculate = element("button", "sf-utility-primary", "Calculate");
  calculate.type = "submit";
  const answer = element("output", "sf-calculator-answer");
  answer.setAttribute("aria-live", "polite");
  const arithmeticError = element("p", "sf-utility-error");
  arithmeticError.setAttribute("role", "alert");
  arithmetic.append(expressionLabel, expression, calculate, answer, arithmeticError);
  expression.addEventListener("input", () => { answer.textContent = ""; arithmeticError.textContent = ""; });
  arithmetic.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (calculate.disabled) return;
    calculate.disabled = true;
    arithmeticError.textContent = "";
    answer.textContent = "";
    try {
      const result = await evaluateArithmetic(expression.value);
      answer.textContent = new Intl.NumberFormat(APP_CONFIG.portfolio.locale, { maximumSignificantDigits: 15 }).format(result);
    } catch (error) {
      arithmeticError.textContent = error.message;
    } finally {
      calculate.disabled = false;
    }
  });

  const evm = element("form", "sf-calculator-form");
  evm.noValidate = true;
  evm.append(element("h3", "", "Earned value check"));
  const grid = element("div", "sf-calculator-inputs");
  const inputs = new Map();
  INPUTS.forEach(([key, abbreviation, title]) => {
    const field = element("div", "sf-calculator-field");
    const label = element("label", "", `${abbreviation} (${APP_CONFIG.portfolio.currencyCode})`);
    const input = element("input");
    input.id = `sf-calculator-${key}`;
    input.name = key;
    input.type = "number";
    input.min = "0";
    input.step = "any";
    input.required = true;
    input.title = title;
    label.htmlFor = input.id;
    inputs.set(key, input);
    field.append(label, input);
    grid.append(field);
  });
  const results = element("dl", "sf-calculator-results");
  results.setAttribute("aria-live", "polite");
  const error = element("p", "sf-utility-error");
  error.setAttribute("role", "alert");
  const run = element("button", "sf-utility-primary", "Calculate EVM");
  run.type = "submit";
  evm.append(grid);
  if (project) {
    const prefill = element("button", "sf-utility-secondary", "Use current project values");
    prefill.type = "button";
    prefill.addEventListener("click", () => {
      inputs.forEach((input, key) => { input.value = Number.isFinite(project[key]) ? project[key] : ""; });
      results.replaceChildren();
      error.textContent = "";
      inputs.get("budgetBAC").focus();
    });
    evm.append(element("p", "sf-utility-intro", project.projectName), prefill);
  }
  evm.append(run, error, results);
  evm.addEventListener("input", () => { results.replaceChildren(); error.textContent = ""; });
  evm.addEventListener("submit", (event) => {
    event.preventDefault();
    results.replaceChildren();
    error.textContent = "";
    const scratchpad = {};
    for (const [key, input] of inputs) {
      const value = input.valueAsNumber;
      if (!input.value.trim() || !Number.isFinite(value) || value < 0) {
        error.textContent = "Enter a finite, non-negative amount in all four fields.";
        input.focus();
        return;
      }
      scratchpad[key] = value;
    }
    const metrics = { ...calculateProjectEvm(scratchpad), ...calculateProjectForecast(scratchpad) };
    for (const key of ["cv", "sv", "cpi", "spi", "eac", "etc", "vac", "tcpi"]) {
      const value = metrics[key];
      const money = ["cv", "sv", "eac", "etc", "vac"].includes(key);
      results.append(
        element("dt", "", key.toUpperCase()),
        element("dd", "", Number.isFinite(value)
          ? (money ? formatCurrency(value, APP_CONFIG.portfolio.currencyCode, APP_CONFIG.portfolio.locale, "code") : value.toFixed(2))
          : "Unavailable"),
      );
    }
    if ([metrics.cpi, metrics.spi, metrics.eac, metrics.tcpi].some((value) => !Number.isFinite(value))) {
      error.textContent = "Some measures are unavailable: a denominator is zero, efficiency is not positive, or the result exceeds the numeric range.";
    }
  });
  dialog.append(arithmetic, evm);
  modal.open();
  expression.focus();
}
