// Static game data: the road, towns, enemies and shop items.

// The Tokaido road, south (start) to north (Oni Mountain). Towns sit on path points.
export const PATH = [
  [0, 60], [0, 0], [25, -130], [60, -260], [10, -380],
  [-120, -500], [-70, -620], [40, -740], [15, -840], [0, -920],
];
export const TOWN_IDX = [1, 3, 5, 7];
export const TOWN_R = 30;
export const ARENA = { x: 0, z: -920, r: 28 };
export const BOUNDS = { minX: -320, maxX: 320, minZ: -990, maxZ: 100 };

// Region between town i and town i+1 (the last one leads to the arena).
export const REGIONS = [
  { name: 'Bamboo Road', danger: 1 },
  { name: 'Riverlands', danger: 2 },
  { name: 'Stone Pass', danger: 3 },
  { name: 'Ashen Wastes', danger: 4 },
];

export const TOWNS = [
  {
    name: 'Sakura Village', wall: 0xeadfc8, roof: 0x3d4656,
    shopName: 'Hanami General Store', merchant: 'Old Tomoe, shopkeeper',
    stock: ['potion', 'w:steel', 'a:leather'],
    elder: [
      'Ronin, thank the heavens you came. Demons pour down from Oni Mountain in the far north.',
      'Their master is Shuten-doji, the Demon King. No blade in this village can stand against him.',
      'Follow the road north to Kawaguchi. Bandits prowl the bamboo groves &mdash; cut them down, and spend their coin at Tomoe\'s store.',
    ],
  },
  {
    name: 'Kawaguchi', wall: 0xe2d2b0, roof: 0x4a3326,
    shopName: 'Riverside Smithy', merchant: 'Genzo the smith',
    stock: ['potion', 'elixir', 'w:tama', 'a:iron', 'c:stamina'],
    elder: [
      'Red oni stalk the riverlands now. They hit hard but swing slow &mdash; dodge through the blow, then strike.',
      'Genzo forges tamahagane steel. Do not face the stone pass without it.',
      'Ishiyama lies to the north-west, past the river bend.',
    ],
  },
  {
    name: 'Ishiyama', wall: 0xcfc8bc, roof: 0x2f3b3a,
    shopName: 'Stoneworks Armory', merchant: 'Master Hideyoshi',
    stock: ['potion', 'elixir', 'w:mura', 'a:oyoroi', 'c:vitality'],
    elder: [
      'Blue oni guard the stone pass, and worse &mdash; oni captains clad in black. Their hides shrug off quick cuts.',
      'Use heavy strikes (right-click) on them. Rest at the shrine before you go on.',
      'Kurogane Fort is the last stronghold before the Ashen Wastes.',
    ],
  },
  {
    name: 'Kurogane Fort', wall: 0xb9b1a6, roof: 0x241d1d,
    shopName: 'Fortress Quartermaster', merchant: 'Captain Ayame',
    stock: ['potion', 'elixir', 'w:onikiri', 'a:dragon', 'c:regen'],
    elder: [
      'Beyond our gate lie the Ashen Wastes, and at their end the shrine where Shuten-doji waits.',
      'Ayame keeps Onikiri, the Demon-Cutter, forged for this one fight. It will not come cheap.',
      'When the Demon King slams the earth, a red ring marks the blow. Roll out of it. Go, ronin. End this.',
    ],
  },
];
TOWNS.forEach((t, i) => { t.index = i; t.x = PATH[TOWN_IDX[i]][0]; t.z = PATH[TOWN_IDX[i]][1]; });

export const WEAPONS = {
  worn:    { name: 'Worn Katana', atk: 8, price: 0, color: 0x9aa3ab, glow: 0x000000 },
  steel:   { name: 'Steel Katana', atk: 14, price: 90, color: 0xdfe6ee, glow: 0x000000 },
  tama:    { name: 'Tamahagane Blade', atk: 22, price: 260, color: 0xeef5ff, glow: 0x223344 },
  mura:    { name: 'Muramasa', atk: 32, price: 600, color: 0xffb0b0, glow: 0x661010 },
  onikiri: { name: 'Onikiri, Demon-Cutter', atk: 46, price: 1100, color: 0xbff0ff, glow: 0x2a8fb0 },
};

export const ARMORS = {
  cloth:   { name: "Traveler's Robes", def: 0, price: 0 },
  leather: { name: 'Lacquered Leather', def: 3, price: 70 },
  iron:    { name: 'Iron Do', def: 7, price: 240 },
  oyoroi:  { name: 'O-yoroi Armor', def: 12, price: 520 },
  dragon:  { name: 'Dragon-Scale Armor', def: 18, price: 1000 },
};

export const CHARMS = {
  stamina:  { name: 'Wind Charm', desc: '+40 max stamina', price: 150 },
  vitality: { name: 'Jade Charm', desc: '+50 max health', price: 320 },
  regen:    { name: 'Phoenix Charm', desc: 'Slowly regenerate health', price: 500 },
};

export const CONSUMABLES = {
  potion: { name: 'Healing Potion', desc: 'Restores 60 health (Q)', price: 20 },
  elixir: { name: 'Elixir of Life', desc: 'Fully restores health (R)', price: 70 },
};

// poise: 0 = staggered by any hit, 1 = only by heavy/finisher hits, 2 = only by heavy, 3 = never.
export const ENEMIES = {
  bandit:  { name: 'Bandit', hp: 40, dmg: 9, speed: 4.2, range: 1.9, scale: 1, radius: 0.5, xp: 14, gold: [6, 12], windup: 0.5, recover: 0.75, aggro: 16, poise: 0 },
  oni:     { name: 'Red Oni', hp: 95, dmg: 16, speed: 3.6, range: 2.5, scale: 1.35, radius: 0.8, xp: 38, gold: [16, 28], windup: 0.65, recover: 0.85, aggro: 18, poise: 0 },
  blueOni: { name: 'Blue Oni', hp: 180, dmg: 24, speed: 4.0, range: 2.8, scale: 1.55, radius: 0.9, xp: 75, gold: [32, 50], windup: 0.55, recover: 0.7, aggro: 20, poise: 1 },
  captain: { name: 'Oni Captain', hp: 320, dmg: 32, speed: 4.4, range: 3.1, scale: 1.85, radius: 1.1, xp: 150, gold: [70, 100], windup: 0.5, recover: 0.6, aggro: 22, poise: 2 },
  boss:    { name: 'Shuten-doji, the Demon King', hp: 2600, dmg: 38, speed: 4.6, range: 5.2, scale: 3.4, radius: 2.2, xp: 1500, gold: [1000, 1000], windup: 0.75, recover: 0.9, aggro: 36, poise: 3 },
};

export const TIER_MIX = [
  [['bandit', 0.8], ['oni', 0.2]],
  [['bandit', 0.4], ['oni', 0.6]],
  [['oni', 0.45], ['blueOni', 0.45], ['captain', 0.1]],
  [['blueOni', 0.5], ['captain', 0.3], ['oni', 0.2]],
];

export const xpNeeded = lvl => Math.floor(40 * Math.pow(lvl, 1.6));
