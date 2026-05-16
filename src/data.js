export const services = [
  {
    title: "After-School Care",
    text: "Calm, structured provision from the end of the school day with choice-led activities, homework space, snacks and trusted collection routines.",
    tag: "Term time",
  },
  {
    title: "Wraparound Care",
    text: "Reliable breakfast and extended-day support designed around each school's timetable, facilities, safeguarding procedures and family needs.",
    tag: "Schools",
  },
  {
    title: "Holiday Clubs",
    text: "Creative, active and social programmes that keep children engaged during holidays while giving parents dependable childcare.",
    tag: "Holidays",
  },
  {
    title: "Enrichment Clubs",
    text: "STEM, sport, creative arts, wellbeing and practical life-skills clubs delivered by trained, checked and supported staff.",
    tag: "Clubs",
  },
  {
    title: "School Partnerships",
    text: "A professional operating partner for headteachers, business managers and trusts who need quality provision without extra admin load.",
    tag: "Partner",
  },
  {
    title: "Staffing Support",
    text: "Vetted, trained team members, cover workflows and compliance records that help provision stay resilient when plans change.",
    tag: "Ops",
  },
];

export const faqs = [
  ["How do parents enquire?", "Use the enquiry form and select parent, school or staff. Enquiries are ready to flow into the internal follow-up system in the hosted version."],
  ["Are staff checked?", "Staff checks are managed through safer recruitment workflows, identity checks, DBS expectations and role-appropriate training records."],
  ["Can schools request assurance documents?", "Yes. School partners can request policy summaries, insurance information and safer recruitment assurance through the appropriate channel."],
  ["Is first aid mandatory for every staff member?", "First aid is recorded and planned by role, site and programme need rather than assumed as a universal requirement for every person."],
  ["Which booking platform should I use?", "Start on the Bookings page and choose your site. Each site card explains whether to use Magicbooking or Book Pebble."],
  ["Can my child attend a holiday camp if they do not go to that school?", "Some holiday camps are open to children from all schools, while others are school-specific. Check the site card before booking."],
  ["What happens if I cannot find my site?", "Contact Après School with the school, area and dates you need. The team can point you to the correct route."],
  ["Do you work with schools directly?", "Yes. Après School supports schools with wraparound care, holiday clubs, enrichment provision and staffing conversations."],
];

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

export const appData = { services, faqs, staff, sessions, documents, enquiries, rewards };
