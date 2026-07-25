export const REWARD_BADGES = [
  {
    type: "excellent_behaviour",
    icon: "🏆",
    title: "Excellent Behaviour",
    description: "Followed expectations brilliantly and set a fantastic example.",
  },
  {
    type: "fab_friend",
    icon: "🤝",
    title: "Fab Friend",
    description: "Kind, helpful and supportive to others.",
  },
  {
    type: "what_would_we_do_without_you",
    icon: "🌟",
    title: "What Would We Do Without You?",
    description: "Went above and beyond today.",
  },
  {
    type: "creativity",
    icon: "🎨",
    title: "Creativity",
    description: "Fantastic imagination and creative thinking.",
  },
  {
    type: "perseverance",
    icon: "💪",
    title: "Perseverance",
    description: "Kept trying and never gave up.",
  },
  {
    type: "team_player",
    icon: "⚽",
    title: "Team Player",
    description: "Worked brilliantly with others.",
  },
  {
    type: "positive_attitude",
    icon: "😊",
    title: "Positive Attitude",
    description: "Brought great energy and enthusiasm.",
  },
  {
    type: "kindness",
    icon: "❤️",
    title: "Kindness",
    description: "Showed exceptional kindness and care.",
  },
];

export const REWARD_BADGE_MAP = Object.fromEntries(REWARD_BADGES.map((badge) => [badge.type, badge]));

export function rewardBadge(type) {
  return REWARD_BADGE_MAP[type] || {
    type: type || "reward",
    icon: "🏅",
    title: "Après School Badge",
    description: "A special achievement at Après School.",
  };
}
