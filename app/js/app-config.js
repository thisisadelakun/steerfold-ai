import { getOrganizationCurrency } from "./organization-currency.js";
import { ORGANIZATION_CONFIG } from "./organization-config.js";

export const APP_CONFIG = Object.freeze({
  product: Object.freeze({
    name: "Steerfold AI",
  }),

  organization: ORGANIZATION_CONFIG,

  portfolio: Object.freeze({
    get currencyCode() { return getOrganizationCurrency(); },
    locale: "en-CA",
    sampleDataNotice:
      "Simulated portfolio data for planning and demonstration.",
    riskScoreBands: Object.freeze({
      lowMax: 8,
      mediumMax: 16,
    }),
    performanceThresholds: Object.freeze({
      warningIndex: 0.9,
      targetIndex: 1.0,
      highCompletionPressureTcpi: 1.1,
    }),
    decisionThresholds: Object.freeze({
      highRiskScore: 12,
      criticalRiskScore: 16,
      inefficientIndex: 1.0,
      highCompletionPressureTcpi: 1.1,
    }),
  }),
});
