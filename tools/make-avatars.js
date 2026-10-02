// Draws the illustrated profile pictures used for the fictional people on /demo
// (img/avatar/*.svg). They're flat illustrations rather than photos on purpose:
// the demo people don't exist, and putting a real person's photo on a made-up
// agent would be misleading. Re-run with:  node tools/make-avatars.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'img', 'avatar');

// [base, shade]
const SKIN = {
  fair: ['#f6d5bd', '#e6b697'],
  light: ['#f0c6a2', '#dba47d'],
  olive: ['#d8a676', '#c08a5c'],
  tan: ['#c68a5c', '#a96f45'],
  brown: ['#9a6238', '#7f4c2a'],
  deep: ['#6d4227', '#57321b'],
};
const HAIR = {
  black: '#1e1a1a', darkbrown: '#3a281e', brown: '#5b3d2a', auburn: '#8b4a2c',
  blond: '#cf9f55', gray: '#a9abb0', white: '#e6e6e6',
};
const JACKET = {
  navy: '#243447', charcoal: '#3a3f47', burgundy: '#6d2f3d', forest: '#2f5d4a', slate: '#4b5d70', camel: '#b28b58',
};

function backHair(spec, hair) {
  switch (spec.hair) {
    case 'long':
      return `<path d="M34 50 C31 25 46 17 60 17 C76 17 90 27 86 52 C86 74 93 94 98 108 L22 108 C27 94 34 74 34 50 Z" fill="${hair}"/>`;
    case 'bob':
      return `<path d="M34 52 C31 27 46 18 60 18 C76 18 89 27 86 52 C87 66 89 77 84 82 L36 82 C31 77 33 66 34 52 Z" fill="${hair}"/>`;
    case 'bun':
      return `<circle cx="60" cy="17" r="10" fill="${hair}"/>`;
    case 'curly':
      return [[43, 37, 9], [52, 29, 10], [64, 28, 10], [75, 35, 10], [39, 48, 7.5], [81, 48, 7.5], [60, 24, 9]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${hair}"/>`).join('');
    default:
      return '';
  }
}

// Long hair falls over the front of the shoulders.
function drapedHair(spec, hair) {
  if (spec.hairStyle !== 'long' && spec.hair !== 'long') return '';
  return `<path d="M37 58 C32 76 30 92 25 106 C37 110 46 101 47 90 C47 77 43 66 39 58 Z" fill="${hair}"/>`
       + `<path d="M83 58 C88 76 90 92 95 106 C83 110 74 101 73 90 C73 77 77 66 81 58 Z" fill="${hair}"/>`;
}

function frontHair(spec, hair) {
  switch (spec.hair) {
    case 'long': case 'bob': case 'bun':
      return `<path d="M39 54 C36 33 48 21 60 21 C72 21 84 33 81 54 C77 42 68 35 60 31 C52 35 43 42 39 54 Z" fill="${hair}"/>`;
    case 'short':
      return `<path d="M39 52 C36 33 48 21 60 21 C74 21 85 32 81 52 C80 44 76 37 68 35 C58 33 46 37 42 46 C41 48 40 50 39 52 Z" fill="${hair}"/>`;
    case 'curly':
      return `<path d="M41 45 C43 34 52 31 60 31 C68 31 77 34 79 45 C73 39 67 37 60 37 C53 37 47 39 41 45 Z" fill="${hair}"/>`;
    case 'buzz':
      return `<path d="M40 46 C39 32 48 26 60 26 C72 26 81 32 80 46 C77 38 70 35 60 35 C50 35 43 38 40 46 Z" fill="${hair}" opacity="0.92"/>`;
    default:
      return '';
  }
}

function build(spec) {
  const [skin, shade] = SKIN[spec.skin];
  const hair = HAIR[spec.color];
  const jacket = JACKET[spec.jacket];
  const shirt = spec.shirt || '#f4f1ea';
  const bgLight = spec.bg[0];
  const bgDark = spec.bg[1];
  const mouthStroke = spec.facial === 'beard' ? '#f3d3c4' : '#7d3a33';
  const smile = spec.smile === 'wide' ? 'M52 65 Q60 74 68 65' : 'M53 66 Q60 71.5 67 66';

  const facial = spec.facial === 'beard'
    ? `<path d="M40 55 C40 70 48 84 60 84 C72 84 80 70 80 55 C78 62 74 66 70 66.5 C66 63 54 63 50 66.5 C46 66 42 62 40 55 Z" fill="${hair}"/>`
    : spec.facial === 'stubble'
      ? `<path d="M40 55 C40 70 48 82 60 82 C72 82 80 70 80 55 C78 62 74 66 70 66.5 C66 63 54 63 50 66.5 C46 66 42 62 40 55 Z" fill="${hair}" opacity="0.32"/>`
      : '';

  const glasses = spec.glasses
    ? `<g fill="none" stroke="#2a2a2e" stroke-width="1.8" stroke-linecap="round">
         <circle cx="52" cy="52" r="7.6"/><circle cx="68" cy="52" r="7.6"/>
         <path d="M59.6 51.5 Q60 50.4 60.4 51.5"/><path d="M44.4 51.5 L40.5 50.2"/><path d="M75.6 51.5 L79.5 50.2"/>
       </g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240" role="img" aria-label="${spec.label}">
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0.3" r="0.85">
      <stop offset="0" stop-color="${bgLight}"/><stop offset="1" stop-color="${bgDark}"/>
    </radialGradient>
  </defs>
  <rect width="120" height="120" fill="url(#bg)"/>
  ${backHair(spec, hair)}
  <path d="M38 84 L82 84 L82 120 L38 120 Z" fill="${shirt}"/>
  <path d="M50 64 L50 86 Q60 93 70 86 L70 64 Z" fill="${shade}"/>
  <path d="M5 120 C7 98 28 88 48 85 L60 107 L57 120 Z" fill="${jacket}"/>
  <path d="M115 120 C113 98 92 88 72 85 L60 107 L63 120 Z" fill="${jacket}"/>
  <path d="M48 85 L60 107 L51 100 Z" fill="#000" opacity="0.18"/>
  <path d="M72 85 L60 107 L69 100 Z" fill="#000" opacity="0.18"/>
  ${drapedHair(spec, hair)}
  <ellipse cx="39.5" cy="54" rx="3.6" ry="5.2" fill="${skin}"/>
  <ellipse cx="80.5" cy="54" rx="3.6" ry="5.2" fill="${skin}"/>
  <ellipse cx="60" cy="52" rx="20.5" ry="24.5" fill="${skin}"/>
  ${facial}
  <path d="M47 45.5 Q52 42.8 57 45.2" fill="none" stroke="${hair}" stroke-width="2.1" stroke-linecap="round"/>
  <path d="M63 45.2 Q68 42.8 73 45.5" fill="none" stroke="${hair}" stroke-width="2.1" stroke-linecap="round"/>
  <ellipse cx="52" cy="52" rx="2.1" ry="2.5" fill="#251c1a"/>
  <ellipse cx="68" cy="52" rx="2.1" ry="2.5" fill="#251c1a"/>
  <path d="M60 54.5 Q63 60.5 59.2 61.8" fill="none" stroke="${shade}" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="46.5" cy="60.5" r="4.2" fill="#d9584c" opacity="0.13"/>
  <circle cx="73.5" cy="60.5" r="4.2" fill="#d9584c" opacity="0.13"/>
  <path d="${smile}" fill="none" stroke="${mouthStroke}" stroke-width="2" stroke-linecap="round"/>
  ${frontHair(spec, hair)}
  ${glasses}
</svg>
`;
}

const PEOPLE = {
  'marisol-vega': { label: 'Illustrated portrait of Marisol Vega', skin: 'tan', hair: 'long', color: 'darkbrown', jacket: 'navy', bg: ['#cfe7e6', '#8fbfbd'], smile: 'wide' },
  'devon-brooks': { label: 'Illustrated portrait of Devon Brooks', skin: 'deep', hair: 'buzz', color: 'black', jacket: 'charcoal', bg: ['#d5dde8', '#98a9c0'], facial: 'beard' },
  'priya-nair': { label: 'Illustrated portrait of Priya Nair', skin: 'brown', hair: 'bob', color: 'black', jacket: 'burgundy', bg: ['#e6dcf0', '#b7a3cf'], glasses: true },
  'tom-alvarez': { label: 'Illustrated portrait of Tom Alvarez', skin: 'olive', hair: 'short', color: 'brown', jacket: 'forest', bg: ['#f1e2c6', '#d3b382'], glasses: true, facial: 'stubble', smile: 'wide' },
  'homeowner': { label: 'Illustrated portrait of the homeowner', skin: 'fair', hair: 'bun', color: 'gray', jacket: 'camel', bg: ['#f3dcd2', '#d9a998'], shirt: '#cfe0ee' },
  'jordan': { label: 'Illustrated portrait of Jordan', skin: 'light', hair: 'curly', color: 'auburn', jacket: 'slate', bg: ['#dfe9d3', '#a9c28f'], smile: 'wide' },
  'sam': { label: 'Illustrated portrait of Sam', skin: 'brown', hair: 'short', color: 'darkbrown', jacket: 'navy', bg: ['#f2d9c4', '#d6a27a'], shirt: '#cfe0ee' },
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, spec] of Object.entries(PEOPLE)) {
  fs.writeFileSync(path.join(OUT, `${name}.svg`), build(spec));
}
console.log(`wrote ${Object.keys(PEOPLE).length} avatars to ${OUT}`);
