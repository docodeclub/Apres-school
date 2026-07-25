import sharp from "sharp";

const zonesForSide = (side) => {
  const torsoPart = side === "front" ? "Chest" : "Upper back";
  const lowerTorsoPart = side === "front" ? "Abdomen" : "Lower back";
  // On a front-facing figure, the child's left is on the viewer's right.
  // On a back-facing figure, the child's left is on the viewer's left.
  const viewerLeftPart = (part) => `${side === "front" ? "Right" : "Left"} ${part}`;
  const viewerRightPart = (part) => `${side === "front" ? "Left" : "Right"} ${part}`;
  return [
    ["Head", '<path d="M100 9c-15 0-25 11-25 27 0 15 10 28 25 28s25-13 25-28c0-16-10-27-25-27Z"/>'],
    ["Neck", '<path d="M89 58h22l4 16H85l4-16Z"/>'],
    [torsoPart, '<path d="M82 70c-10 3-17 10-19 21l7 53c9 7 19 10 30 10s21-3 30-10l7-53c-2-11-9-18-19-21-11 6-25 6-36 0Z"/>'],
    [lowerTorsoPart, '<path d="M70 139c8 8 18 12 30 12s22-4 30-12l-4 37c-8 7-17 10-26 10s-18-3-26-10l-4-37Z"/>'],
    [viewerLeftPart("arm"), '<path d="M66 80c-8 3-13 9-17 19l-18 59c-2 7 2 13 8 15 6 1 11-3 13-9l20-56 6-26-12-2Z"/>'],
    [viewerRightPart("arm"), '<path d="M134 80c8 3 13 9 17 19l18 59c2 7-2 13-8 15-6 1-11-3-13-9l-20-56-6-26 12-2Z"/>'],
    [viewerLeftPart("hand"), '<path d="M39 166c-8-2-15 3-16 11-1 6 3 13 9 15 8 2 16-3 17-11 1-7-3-13-10-15Z"/>'],
    [viewerRightPart("hand"), '<path d="M161 166c8-2 15 3 16 11 1 6-3 13-9 15-8 2-16-3-17-11-1-7 3-13 10-15Z"/>'],
    [viewerLeftPart("leg"), '<path d="M75 176c6 6 14 9 23 10l-5 82c-1 10-7 16-15 15-8-1-12-8-11-18l8-89Z"/>'],
    [viewerRightPart("leg"), '<path d="M125 176c-6 6-14 9-23 10l5 82c1 10 7 16 15 15 8-1 12-8 11-18l-8-89Z"/>'],
    [viewerLeftPart("foot"), '<path d="M78 272c-7-1-12 4-16 10l-7 8c-3 4 0 8 5 8h27c6 0 9-4 8-9l-2-12-15-5Z"/>'],
    [viewerRightPart("foot"), '<path d="M122 272c7-1 12 4 16 10l7 8c3 4 0 8-5 8h-27c-6 0-9-4-8-9l2-12 15-5Z"/>'],
  ];
};

const availableParts = new Map(
  ["front", "back"].flatMap((side) =>
    zonesForSide(side).map(([part]) => [`${side}:${part.toLowerCase()}`, { side, part }]),
  ),
);

function parseAreas(value) {
  const raw = Array.isArray(value) ? value.join("|") : String(value || "");
  const selected = new Map();
  raw.split("|").slice(0, 24).forEach((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 1) return;
    const side = entry.slice(0, separator).trim().toLowerCase();
    const part = entry.slice(separator + 1).trim().toLowerCase();
    const area = availableParts.get(`${side}:${part}`);
    if (area) selected.set(`${area.side}:${area.part.toLowerCase()}`, area);
  });
  return [...selected.values()];
}

const vectorLabel = (word, centreX, y) => {
  const glyphs = {
    A: '<path d="M1 16 7 0l6 16M3.5 10h7"/>',
    B: '<path d="M1 0v16h7c7 0 7-8 0-8H1h7c6 0 6-8 0-8H1"/>',
    C: '<path d="M13 2C10 0 8 0 6 0 2 0 1 3 1 8s1 8 5 8c2 0 4 0 7-2"/>',
    F: '<path d="M1 16V0h12M1 7h9"/>',
    K: '<path d="M1 0v16M13 0 1 10m5-4 7 10"/>',
    N: '<path d="M1 16V0l12 16V0"/>',
    O: '<path d="M5 0h4c3 0 4 2 4 5v6c0 3-1 5-4 5H5c-3 0-4-2-4-5V5c0-3 1-5 4-5Z"/>',
    R: '<path d="M1 16V0h7c7 0 7 8 0 8H1m7 0 6 8"/>',
    T: '<path d="M1 0h12M7 0v16"/>',
  };
  const letterWidth = 14;
  const gap = 5;
  const width = word.length * letterWidth + (word.length - 1) * gap;
  return `<g transform="translate(${centreX - width / 2} ${y})" fill="none" stroke="#314bb8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    ${[...word].map((letter, index) => `<g transform="translate(${index * (letterWidth + gap)} 0)">${glyphs[letter]}</g>`).join("")}
  </g>`;
};

function bodyFigure(side, selectedKeys, x) {
  return `<g transform="translate(${x} 55) scale(1.05)">
    ${zonesForSide(side).map(([part, shape]) => {
      const selected = selectedKeys.has(`${side}:${part.toLowerCase()}`);
      return `<g fill="${selected ? "#ffad32" : "#dce5ff"}" stroke="${selected ? "#c96d00" : "#365bb5"}" stroke-width="${selected ? "5" : "3.5"}" stroke-linejoin="round">${shape}</g>`;
    }).join("")}
    ${side === "front" ? `<g fill="#365bb5">
      <circle cx="91" cy="35" r="2.2"/>
      <circle cx="109" cy="35" r="2.2"/>
      <path d="M91 46c5 5 13 5 18 0" fill="none" stroke="#365bb5" stroke-width="2.4" stroke-linecap="round"/>
    </g>` : ""}
  </g>`;
}

function mapSvg(areas) {
  const selectedKeys = new Set(areas.map(({ side, part }) => `${side}:${part.toLowerCase()}`));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="390" viewBox="0 0 720 390">
    <rect width="720" height="390" rx="30" fill="#f4fbf7"/>
    ${vectorLabel("FRONT", 202, 14)}
    ${vectorLabel("BACK", 518, 14)}
    ${bodyFigure("front", selectedKeys, 97)}
    ${bodyFigure("back", selectedKeys, 413)}
  </svg>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }

  const areas = parseAreas(req.query?.areas);
  if (!areas.length) return res.status(400).send("At least one valid affected area is required");

  try {
    const image = await sharp(Buffer.from(mapSvg(areas)))
      .png({ compressionLevel: 9 })
      .toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(image);
  } catch (error) {
    console.error("Unable to render first-aid body map", error);
    return res.status(500).send("Unable to render body map");
  }
}
