export const defaultMultiActivityCampInfo = {
  title: "Multi-Activity Holiday Camp",
  description: [
    "Our Multi-Activity Holiday Camps are designed to keep children active, creative and engaged throughout the day. No two days are exactly the same, with a mixture of sports, games, creative activities, challenges and guided play.",
    "We also mix things up with themed days, special activities and visiting experiences. Depending on the venue and holiday, this might include bouncy castles, water games, tournaments or special visitors such as Lava Leigh.",
  ],
  typicalDay: [
    ["Welcome & Guided Play", "Children settle in, meet their friends and choose from a selection of guided activities supported by our team."],
    ["Morning Activities", "A mixture of sports, team games, challenges and creative activities. Football, dodgeball, tennis, arts and crafts, quizzes and competitions are just some of the activities that might feature."],
    ["Snack & Guided Play", "Time to refuel and enjoy a change of pace with guided activities and friends."],
    ["Activities & Challenges", "More activities before lunch, with our team adapting the programme to the children, venue and weather."],
    ["Lunch & Guided Play", "Children eat together, socialise and enjoy some guided play before the afternoon programme begins."],
    ["Afternoon Activities", "More sports, games, creative activities and challenges, often linked to the day's theme."],
    ["Group Games & Home Time", "We finish the day with group games and challenges before getting everyone ready for collection."],
  ],
  typicalDayNote: "Activities and schedules vary by venue and holiday period. The timetable above is an example rather than a fixed daily programme.",
  whatToBring: [
    "A packed lunch",
    "A snack",
    "A clearly labelled water bottle",
    "Comfortable clothing suitable for active play",
    "Weather-appropriate clothing",
  ],
  weatherItems: ["Waterproof coat", "Sun hat", "Additional layers"],
  bringNote: "Please ensure all belongings are clearly labelled with your child's name.",
  food: [
    "Children should bring their own packed lunch and snack unless otherwise stated for a particular camp or event.",
    "Please follow any allergy or food restrictions communicated for your chosen venue.",
  ],
  specialActivities: [
    "Bouncy castles and inflatables",
    "Themed activity days",
    "Sports tournaments",
    "Water games",
    "Creative workshops",
    "Visiting entertainers and activity providers",
    "Special visitors such as Lava Leigh",
  ],
  specialActivitiesIntro: "Some camp days may include additional activities, themed events or visiting providers.",
  specialActivitiesNote: "Where appropriate, we'll let parents know about particularly special activities in advance.",
  additionalInformation: "If there is anything we need to know about your child before they attend, including medical, SEND, allergy or additional support information, please make sure their account details are up to date before booking.",
};

function textParagraphs(value, fallback) {
  if (Array.isArray(value) && value.length) return value.filter(Boolean).map(String);
  if (typeof value === "string" && value.trim()) return value.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  return fallback;
}

function listItems(value, fallback) {
  if (Array.isArray(value) && value.length) return value.filter(Boolean).map(String);
  if (typeof value === "string" && value.trim()) return value.split("\n").map((item) => item.replace(/^[-•]\s*/, "").trim()).filter(Boolean);
  return fallback;
}

function typicalDayItems(value) {
  if (Array.isArray(value) && value.length) {
    return value.map((item) => Array.isArray(item) ? item : [item.title, item.description]).filter(([title, description]) => title && description);
  }
  if (typeof value === "string" && value.trim()) {
    const rows = value.split("\n").map((item) => item.trim()).filter(Boolean).map((item) => {
      const [title, ...description] = item.split("|");
      return [title?.trim(), description.join("|").trim()];
    }).filter(([title, description]) => title && description);
    if (rows.length) return rows;
  }
  return defaultMultiActivityCampInfo.typicalDay;
}

export function resolveHolidayCampInfo(camp = {}) {
  const overrides = camp.campInfo || camp.presentation?.campInfo || {};
  const campType = camp.campType || camp.presentation?.campType || "Multi-Activity";
  return {
    title: overrides.title || (/holiday camp$/i.test(campType) ? campType : `${campType} Holiday Camp`),
    description: textParagraphs(overrides.description, defaultMultiActivityCampInfo.description),
    typicalDay: typicalDayItems(overrides.typicalDay),
    typicalDayNote: overrides.typicalDayNote || defaultMultiActivityCampInfo.typicalDayNote,
    whatToBring: listItems(overrides.whatToBring, defaultMultiActivityCampInfo.whatToBring),
    weatherItems: listItems(overrides.weatherItems, defaultMultiActivityCampInfo.weatherItems),
    bringNote: overrides.bringNote || defaultMultiActivityCampInfo.bringNote,
    food: textParagraphs(overrides.food, defaultMultiActivityCampInfo.food),
    specialActivities: listItems(overrides.specialActivities, defaultMultiActivityCampInfo.specialActivities),
    specialActivitiesIntro: overrides.specialActivitiesIntro || defaultMultiActivityCampInfo.specialActivitiesIntro,
    specialActivitiesNote: overrides.specialActivitiesNote || defaultMultiActivityCampInfo.specialActivitiesNote,
    additionalInformation: overrides.additionalInformation || defaultMultiActivityCampInfo.additionalInformation,
  };
}

export function trackHolidayCampInfoOpened(camp = {}) {
  if (typeof window === "undefined") return;
  const detail = {
    venue: camp.site || camp.venue || "",
    camp: camp.title || camp.campName || "Holiday Camp",
    holidayPeriod: camp.period || "",
  };
  window.dispatchEvent(new CustomEvent("apres:holiday-camp-info-opened", { detail }));
  if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: "holiday_camp_more_info_opened", ...detail });
}
