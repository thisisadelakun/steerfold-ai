export const APP_CONFIG = Object.freeze({
  product: Object.freeze({
    name: "Steerfold AI",
  }),

  organization: Object.freeze({
    name: "Brisk & Zip",
    shortName: "Brisk & Zip",
  }),

  portfolio: Object.freeze({
    currencyCode: "CAD",
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
