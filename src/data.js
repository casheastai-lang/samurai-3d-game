// Static game data: the road, towns, bases, enemies and shop items.

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

// One ninja base per region. Each guards a sealed portal to a demon fortress.
export const NINJA_R = 24;
export const NINJA_BASES = [
  { name: 'Kage Hideout', x: -75, z: -150, master: 'Master Kirigakure' },
  { name: 'Mist Fang Camp', x: 125, z: -405, master: 'Master Kasumi' },
  { name: 'Iron Shadow Fort', x: -185, z: -660, master: 'Master Tetsukage' },
  { name: 'Black Lotus Stronghold', x: 135, z: -850, master: 'Master Kokuren' },
];

// Demon fortresses float on lava islands outside the overworld (x > 600).
export const REALM_X = 600;
export const DEMON_R = 48;
export const DEMON_BASES = [
  { name: 'Fortress of Gozu', x: 760, z: -80, warlord: 'Gozu, the Ox-Headed', reward: 'shadow' },
  { name: 'Fortress of Mezu', x: 760, z: -330, warlord: 'Mezu, the Horse-Faced', reward: 'bloodmoon' },
  { name: 'Fortress of Ibaraki', x: 760, z: -580, warlord: 'Ibaraki, the One-Armed', reward: 'celestial' },
  { name: 'Fortress of Kuro', x: 760, z: -830, warlord: 'Kuro, the Black Flame', reward: 'yamata' },
];

export const TOWNS = [
  {
    name: 'Sakura Village', wall: 0xeadfc8, roof: 0x3d4656,
    shopName: 'Hanami General Store', merchant: 'Old Tomoe, shopkeeper',
    stock: ['potion', 'w:steel', 'w:kaze', 'a:leather'],
    elder: [
      'Ronin, thank the heavens you came. Demons pour down from Oni Mountain in the far north.',
      'Their master is Shuten-doji, the Demon King. No blade in this village can stand against him.',
      'Follow the road north to Kawaguchi. West of the bamboo groves the Kage ninja clan has made a hideout. They guard a portal to a demon fortress &mdash; defeat their master to break its seal.',
      'Hold Q to block. Block just as a blow lands to parry it and leave your foe open.',
    ],
  },
  {
    name: 'Kawaguchi', wall: 0xe2d2b0, roof: 0x4a3326,
    shopName: 'Riverside Smithy', merchant: 'Genzo the smith',
    stock: ['potion', 'elixir', 'w:tama', 'w:frost', 'a:iron', 'c:stamina'],
    elder: [
      'Red oni stalk the riverlands now. They hit hard but swing slow &mdash; parry them, or roll through the blow.',
      'Every strike you land fills your Ki. When it is full, press X to unleash a Spirit Slash.',
      'The Mist Fang ninja camp lies east of the river bend. Ishiyama lies to the north-west.',
    ],
  },
  {
    name: 'Ishiyama', wall: 0xcfc8bc, roof: 0x2f3b3a,
    shopName: 'Stoneworks Armory', merchant: 'Master Hideyoshi',
    stock: ['potion', 'elixir', 'w:nodachi', 'w:inferno', 'w:mura', 'a:oyoroi', 'c:vitality'],
    elder: [
      'Blue oni guard the stone pass, and worse &mdash; oni captains clad in black. Their hides shrug off quick cuts.',
      'Use heavy strikes (right-click) on them, and press Tab to lock your gaze on a single foe.',
      'The Iron Shadow ninjas hold a fort west of the pass. Kurogane Fort is the last stronghold before the Ashen Wastes.',
    ],
  },
  {
    name: 'Kurogane Fort', wall: 0xb9b1a6, roof: 0x241d1d,
    shopName: 'Fortress Quartermaster', merchant: 'Captain Ayame',
    stock: ['potion', 'elixir', 'w:raijin', 'w:onikiri', 'a:dragon', 'c:regen'],
    elder: [
      'Beyond our gate lie the Ashen Wastes, and at their end the shrine where Shuten-doji waits.',
      'Ayame keeps Onikiri, the Demon-Cutter, forged for this one fight. The warlords of the demon fortresses carry blades stranger still.',
      'When the Demon King slams the earth, a red ring marks the blow. It cannot be blocked &mdash; roll or jump. Go, ronin. End this.',
    ],
  },
];
TOWNS.forEach((t, i) => { t.index = i; t.x = PATH[TOWN_IDX[i]][0]; t.z = PATH[TOWN_IDX[i]][1]; });

// speed scales attack speed, reach adds range, len scales the model.
// effect: burn (fire damage over time), frost (slows), shock (chains to nearby foes),
// leech (heals you), demonbane (+50% damage against demons).
export const WEAPONS = {
  worn:      { name: 'Worn Katana', atk: 8, price: 0, color: 0x9aa3ab, glow: 0x000000, desc: 'A chipped blade from better days.' },
  steel:     { name: 'Steel Katana', atk: 14, price: 90, color: 0xdfe6ee, glow: 0x000000, desc: 'Honest steel. Reliable.' },
  kaze:      { name: 'Kaze Wakizashi', atk: 12, price: 130, color: 0xd8ffe8, glow: 0x0a3a20, len: 0.7, speed: 1.3, reach: -0.3, desc: 'Short and light. Strikes 30% faster.' },
  tama:      { name: 'Tamahagane Blade', atk: 22, price: 260, color: 0xeef5ff, glow: 0x223344, desc: 'Folded a thousand times.' },
  frost:     { name: 'Frost Fang', atk: 24, price: 380, color: 0xbfe8ff, glow: 0x3aa0ff, effect: 'frost', desc: 'Frost: hits slow enemies.' },
  nodachi:   { name: 'Mountain Splitter', atk: 32, price: 460, color: 0xcfd4da, glow: 0x000000, len: 1.45, speed: 0.82, reach: 1.0, style: 'nodachi', desc: 'A giant odachi. Slow, with long reach.' },
  inferno:   { name: 'Inferno Edge', atk: 30, price: 650, color: 0xffb070, glow: 0xff4a00, effect: 'burn', desc: 'Burn: sets enemies on fire.' },
  mura:      { name: 'Muramasa', atk: 34, price: 720, color: 0xffb0b0, glow: 0x8a1010, effect: 'leech', desc: 'Leech: drinks blood to heal you.' },
  raijin:    { name: "Raijin's Thunder", atk: 40, price: 950, color: 0xfff6a0, glow: 0xffd000, effect: 'shock', style: 'jagged', desc: 'Shock: lightning jumps to nearby foes.' },
  onikiri:   { name: 'Onikiri, Demon-Cutter', atk: 46, price: 1100, color: 0xbff0ff, glow: 0x2a8fb0, effect: 'demonbane', desc: 'Demonbane: +50% damage to demons.' },
  // Warlord rewards: found in demon fortress chests, never sold.
  shadow:    { name: 'Shadowfang', atk: 30, price: 0, color: 0x404050, glow: 0x6a2aff, effect: 'leech', speed: 1.15, desc: 'Taken from Gozu. Fast, and leeches life.', reward: true },
  bloodmoon: { name: 'Blood Moon', atk: 42, price: 0, color: 0xff3030, glow: 0xc00000, effect: 'burn', style: 'jagged', desc: "Taken from Mezu. Burns with a crimson fire.", reward: true },
  celestial: { name: 'Celestial Blade', atk: 52, price: 0, color: 0xffffff, glow: 0x9ad8ff, effect: 'shock', len: 1.15, desc: 'Taken from Ibaraki. Calls down the storm.', reward: true },
  yamata:    { name: 'Yamata Dragonblade', atk: 62, price: 0, color: 0x80ffb0, glow: 0x00c060, effect: 'demonbane', len: 1.3, reach: 0.6, style: 'nodachi', desc: 'Taken from Kuro. The bane of all demons.', reward: true },
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

// Cosmetic outfits. Sold by every town's shop.
export const SKINS = {
  ronin:   { name: 'Wandering Ronin', price: 0, cloth: 0x1f2b4d, cloth2: 0x24242e, hat: 'kasa', scarf: 0xa3231a, desc: 'Indigo robes and a straw kasa.' },
  crimson: { name: 'Crimson Samurai', price: 150, cloth: 0x7a1414, cloth2: 0x2a1010, hat: 'kabuto', scarf: 0xd4a72c, armor: 0x8e1b1b, desc: 'Red lacquer and a horned kabuto helmet.' },
  shadow:  { name: 'Shadow Ninja', price: 200, cloth: 0x1b1b21, cloth2: 0x121216, hat: 'ninja', scarf: 0x8a1010, desc: 'Black shinobi garb and a mask.' },
  wolf:    { name: 'White Wolf', price: 250, cloth: 0xe6e3dc, cloth2: 0x7d7f88, hat: 'kasa', scarf: 0x3a6ab8, desc: 'Pale robes of a northern swordsman.' },
  hunter:  { name: 'Demon Hunter', price: 450, cloth: 0x3b1f5a, cloth2: 0x1a1026, hat: 'onimask', scarf: 0x9a3aff, desc: 'Wear the face of what you hunt.' },
  shogun:  { name: 'Golden Shogun', price: 800, cloth: 0x2a2420, cloth2: 0x1a1612, hat: 'kabuto', scarf: 0xffffff, armor: 0xc9a227, desc: 'Gilded armor fit for a warlord.' },
};

export const CONSUMABLES = {
  potion: { name: 'Healing Potion', desc: 'Restores 60 health (key 1)', price: 20 },
  elixir: { name: 'Elixir of Life', desc: 'Fully restores health (key 2)', price: 70 },
};

// poise: 0 = staggered by any hit, 1 = only by heavy/finisher hits, 2 = only by heavy, 3 = never.
// ranged: throws shurikens. evade: chance to leap away from an incoming attack.
export const ENEMIES = {
  bandit:   { name: 'Bandit', hp: 40, dmg: 9, speed: 4.2, range: 1.9, scale: 1, radius: 0.5, xp: 14, gold: [6, 12], windup: 0.5, recover: 0.75, aggro: 16, poise: 0 },
  ninja:    { name: 'Ninja', hp: 50, dmg: 10, speed: 6.2, range: 1.9, scale: 1, radius: 0.5, xp: 26, gold: [10, 18], windup: 0.35, recover: 0.5, aggro: 24, poise: 0, ranged: { dmg: 7, cd: 2.6, min: 5, max: 16 }, evade: 0.3 },
  ninjaMaster: { name: 'Ninja Master', hp: 300, dmg: 18, speed: 6.6, range: 2.1, scale: 1.15, radius: 0.6, xp: 160, gold: [90, 130], windup: 0.32, recover: 0.4, aggro: 26, poise: 2, ranged: { dmg: 9, cd: 2.0, min: 4, max: 18, fan: 3 }, evade: 0.35 },
  oni:      { name: 'Red Oni', hp: 95, dmg: 16, speed: 3.6, range: 2.5, scale: 1.35, radius: 0.8, xp: 38, gold: [16, 28], windup: 0.65, recover: 0.85, aggro: 18, poise: 0 },
  blueOni:  { name: 'Blue Oni', hp: 180, dmg: 24, speed: 4.0, range: 2.8, scale: 1.55, radius: 0.9, xp: 75, gold: [32, 50], windup: 0.55, recover: 0.7, aggro: 20, poise: 1 },
  captain:  { name: 'Oni Captain', hp: 320, dmg: 32, speed: 4.4, range: 3.1, scale: 1.85, radius: 1.1, xp: 150, gold: [70, 100], windup: 0.5, recover: 0.6, aggro: 22, poise: 2 },
  warlord:  { name: 'Demon Warlord', hp: 700, dmg: 30, speed: 4.6, range: 3.8, scale: 2.4, radius: 1.4, xp: 400, gold: [200, 260], windup: 0.6, recover: 0.7, aggro: 30, poise: 3 },
  boss:     { name: 'Shuten-doji, the Demon King', hp: 2600, dmg: 38, speed: 4.6, range: 5.2, scale: 3.4, radius: 2.2, xp: 1500, gold: [1000, 1000], windup: 0.75, recover: 0.9, aggro: 36, poise: 3 },
};
export const DEMON_TYPES = new Set(['oni', 'blueOni', 'captain', 'warlord', 'boss']);

export const TIER_MIX = [
  [['bandit', 0.8], ['oni', 0.2]],
  [['bandit', 0.4], ['oni', 0.6]],
  [['oni', 0.45], ['blueOni', 0.45], ['captain', 0.1]],
  [['blueOni', 0.5], ['captain', 0.3], ['oni', 0.2]],
];
// Enemies in ninja bases and demon fortresses get stronger with each tier.
export const tierScale = tier => ({ hp: 1 + 0.6 * tier, dmg: 1 + 0.45 * tier, reward: 1 + 0.7 * tier });

export const xpNeeded = lvl => Math.floor(40 * Math.pow(lvl, 1.6));
