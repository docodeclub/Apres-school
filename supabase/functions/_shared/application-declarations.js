// Applicant responses remain separate from verified recruitment checks.
export const declarationVersion = "2026-09-11";
export const applicationDeclarations = {
  hasQualification: { label: "Teaching or childcare qualifications?", options: ["No", "Yes", "Needs discussion"] },
  employmentGaps: { label: "Any employment gaps?", options: ["No", "Yes", "Needs discussion"] },
  criminalDisclosure: { label: "Criminal disclosure?", options: ["No", "Yes", "Needs discussion"] },
  barredListDisclosure: { label: "Barred from working with children?", options: ["No", "Yes", "Needs discussion"] },
  dbsUpdateService: { label: "DBS update service?", options: ["No", "Yes", "Needs discussion"] },
  medicalFitness: { label: "Medical fitness declaration", options: ["Confirmed", "Needs discussion"] },
  livedAbroad: { label: "Lived outside the UK for 3+ months?", options: ["No", "Yes", "Needs discussion"] },
  rightToWork: { label: "Do you have the right to work in the UK?", options: ["No", "Yes", "Needs discussion"] },
  rightToWorkType: { label: "Right to work type", options: ["Permanent", "Time limited", "Needs discussion"] },
};
export function validateApplicationDeclarations(details = {}) {
  if (!details || typeof details !== "object") return "Please answer the recruitment declarations.";
  for (const [key, question] of Object.entries(applicationDeclarations)) {
    if (!question.options.includes(details[key])) return `Please answer: ${question.label}`;
  }
  if (details.safeguardingStatement !== "Confirmed") return "Please acknowledge the safer recruitment requirements.";
  return "";
}
export function declarationRecord(details, respondedAt) {
  return { version: declarationVersion, respondedAt, source: "applicant", verified: false,
    responses: Object.fromEntries(Object.entries(applicationDeclarations).map(([key, question]) => [key, { question: question.label, answer: details[key] }])) };
}
