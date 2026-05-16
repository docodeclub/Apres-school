export const staff = [
  {
    id: "sample-001",
    name: "Sample Staff A",
    role: "Club Manager",
    location: "Example School",
    siteAssignments: [
      { school: "Example School", role: "Club Manager", startDate: "2025-09-01", endDate: "", status: "Active" },
      { school: "Example Holiday Venue", role: "Camp Lead", startDate: "2026-05-26", endDate: "2026-05-29", status: "Scheduled" },
    ],
    compliance: "Compliant",
    dbsRenewal: "2027-01-18",
    safeguardingExpiry: "2026-08-20",
    allergyAwarenessExpiry: "2027-08-20",
    eyfsLevel: "Level 3",
    firstAidExpiry: "2026-11-05",
    payRate: 18,
  },
  {
    id: "sample-002",
    name: "Sample Staff B",
    role: "Playworker",
    location: "Example Site",
    siteAssignments: [
      { school: "Example Site", role: "Playworker", startDate: "2026-01-08", endDate: "", status: "Active" },
    ],
    compliance: "Expiring soon",
    dbsRenewal: "2026-06-12",
    safeguardingExpiry: "2026-05-30",
    allergyAwarenessExpiry: "2026-05-30",
    eyfsLevel: "",
    firstAidExpiry: "Not required",
    payRate: 13.5,
  },
  {
    id: "sample-003",
    name: "Sample Staff C",
    role: "Enrichment Lead",
    location: "Multiple sites",
    siteAssignments: [
      { school: "Example School", role: "Enrichment Lead", startDate: "2026-04-15", endDate: "", status: "Active" },
      { school: "Example Site", role: "Cover Lead", startDate: "2026-05-01", endDate: "2026-07-31", status: "Cover" },
      { school: "Example Holiday Venue", role: "Enrichment Lead", startDate: "2026-05-26", endDate: "2026-05-29", status: "Scheduled" },
    ],
    compliance: "Missing evidence",
    dbsRenewal: "Pending",
    safeguardingExpiry: "2027-02-14",
    allergyAwarenessExpiry: "Pending",
    eyfsLevel: "Level 3",
    firstAidExpiry: "2026-09-22",
    payRate: 21,
  },
];

export const sessions = [
  { site: "Example School", programme: "Stay & Create", date: "Today", time: "15:15-18:00", staff: "Sample Staff A", status: "Fully staffed" },
  { site: "Example Site", programme: "Active Club", date: "Tomorrow", time: "15:00-17:45", staff: "Cover needed", status: "Planning" },
  { site: "Example Holiday Venue", programme: "Holiday Lab", date: "26 May", time: "08:30-17:30", staff: "Sample Staff C", status: "Planning" },
];

export const documents = [
  { name: "Safeguarding Policy", version: "2026.1", assigned: 38, read: 31, status: "Chase 7" },
  { name: "Staff Handbook", version: "2026.2", assigned: 38, read: 35, status: "Chase 3" },
  { name: "First Aid Policy", version: "2026.1", assigned: 14, read: 12, status: "Chase 2" },
  { name: "Behaviour Policy", version: "2026.1", assigned: 38, read: 38, status: "Complete" },
];

export const enquiries = [
  { name: "Sample Parent", type: "Parent", organisation: "Example School", subject: "After-school care", status: "New" },
  { name: "Sample School Lead", type: "School", organisation: "Example School", subject: "Wraparound partnership", status: "Follow up" },
  { name: "Sample Applicant", type: "Staff", organisation: "Applicant", subject: "Club assistant role", status: "Screening" },
];

export const rewards = [
  { title: "Safeguarding Champion", icon: "Shield", awarded: "Apr 2026", note: "Excellent policy leadership" },
  { title: "Above and Beyond", icon: "Star", awarded: "Mar 2026", note: "Stepped in for emergency cover" },
  { title: "50 Sessions", icon: "Award", awarded: "Feb 2026", note: "Consistent, trusted delivery" },
];
