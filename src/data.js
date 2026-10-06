// Static game data: the road, towns, bases, enemies and shop items.

// The Tokaido road, south (start) to north (Oni Mountain). Settlements sit on path
// points: two small towns, then a great city, then two towns, then another city.
export const PATH = [
  [0, 60], [0, 0], [25, -130], [60, -260], [25, -390], [0, -540],
  [-60, -680], [-120, -800], [-90, -920], [-40, -1030], [15, -1160], [40, -1310],
  [20, -1450], [0, -1570],
];
export const TOWN_IDX = [1, 3, 5, 7, 9, 11];
export const TOWN_R = 30;
export const CITY_R = 72;
export const ARENA = { x: 0, z: -1570, r: 28 };
export const BOUNDS = { minX: -320, maxX: 320, minZ: -1640, maxZ: 100 };
// North of here the land is scorched by Oni Mountain.
export const ASH_Z = -1390;

// The road between settlement i and i+1 (the last leg leads to the Demon King).
// tier picks the enemy mix; danger is the star rating shown on screen.
export const REGIONS = [
  { name: 'Bamboo Road', danger: 1, tier: 0 },
  { name: 'Riverlands', danger: 2, tier: 1 },
  { name: 'Capital Plains', danger: 2, tier: 1 },
  { name: 'Stone Pass', danger: 3, tier: 2 },
  { name: 'Moonlit Forest', danger: 3, tier: 2 },
  { name: 'Ashen Wastes', danger: 4, tier: 3 },
];

// Lakes sit away from the road. The water surface is at WATER_Y.
export const WATER_Y = -0.45;
export const LAKES = [
  { x: -62, z: -45, r: 18 },
  { x: 128, z: -245, r: 24 },
  { x: -215, z: -560, r: 26 },
  { x: 150, z: -960, r: 22 },
];

// One ninja base per region. Each guards a sealed portal to a demon fortress.
export const NINJA_R = 24;
export const NINJA_BASES = [
  { name: 'Kage Hideout', x: -75, z: -150, master: 'Master Kirigakure' },
  { name: 'Mist Fang Camp', x: 140, z: -410, master: 'Master Kasumi' },
  { name: 'Iron Shadow Fort', x: -215, z: -900, master: 'Master Tetsukage' },
  { name: 'Black Lotus Stronghold', x: 140, z: -1150, master: 'Master Kokuren' },
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

// Every settlement has one or more shops. Cities (city: true) are walled, with a castle,
// a pagoda, a market street and a master swordsmith.
export const TOWNS = [
  {
    name: 'Sakura Village', wall: 0xeadfc8, roof: 0x3d4656,
    shops: [{ shopName: 'Hanami General Store', merchant: 'Old Tomoe, shopkeeper', stock: ['potion', 'w:steel', 'w:kaze', 'b:yumi', 'a:leather'] }],
    elder: [
      'Ronin, thank the heavens you came. Demons pour down from Oni Mountain in the far north.',
      'Their master is Shuten-doji, the Demon King. No blade in this village can stand against him.',
      'Follow the road north to Kawaguchi, and beyond it the great capital, Miyako. West of the bamboo groves the Kage ninja clan guards a portal to a demon fortress &mdash; defeat their master to break its seal.',
      'Hold Q to block. Block just as a blow lands to parry it and leave your foe open.',
    ],
  },
  {
    name: 'Kawaguchi', wall: 0xe2d2b0, roof: 0x4a3326,
    shops: [{ shopName: 'Riverside Smithy', merchant: 'Genzo the smith', stock: ['potion', 'elixir', 'w:tama', 'w:frost', 'b:lacquered', 'a:iron', 'c:stamina'] }],
    elder: [
      'Red oni stalk the riverlands now. They hit hard but swing slow &mdash; parry them, or roll through the blow.',
      'Every strike you land fills your Ki. When it is full, press X: draw like lightning and cut down every foe around you in a single breath. We call it Iaijutsu.',
      'The capital, Miyako, lies north. Its walls still hold. The Mist Fang ninja camp hides east of the road.',
    ],
  },
  {
    name: 'Miyako, the Capital', city: true, wall: 0xf2ece0, roof: 0x2f3a4a,
    shops: [
      { shopName: 'Grand Market of Miyako', merchant: 'Merchant Guild of the Capital', stock: ['potion', 'elixir', 'w:tama', 'w:frost', 'a:iron', 'a:oyoroi', 'c:stamina', 'c:vitality'] },
      { shopName: 'Forge of Masamune', merchant: 'Masamune, master swordsmith', stock: ['w:kogarasu', 'w:mura', 'w:nodachi', 'w:inferno', 'b:lacquered', 'b:shigeto'] },
    ],
    elderTitle: 'Magistrate of Miyako',
    elder: [
      'Welcome to Miyako, ronin. The capital has not fallen, but the demons test our walls every night.',
      'Masamune\'s forge is here. His Kogarasu-maru is light and quick; no finer blade is sold on this road.',
      'North lie Ishiyama and the moon village of Tsukimura, then Kurogane, the castle city at the edge of the Ashen Wastes.',
    ],
  },
  {
    name: 'Ishiyama', wall: 0xcfc8bc, roof: 0x2f3b3a,
    shops: [{ shopName: 'Stoneworks Armory', merchant: 'Master Hideyoshi', stock: ['potion', 'elixir', 'w:nodachi', 'w:inferno', 'a:oyoroi', 'c:vitality'] }],
    elder: [
      'Blue oni guard the stone pass, and worse &mdash; oni captains clad in black. Their hides shrug off quick cuts.',
      'Use heavy strikes (right-click) on them, and press Tab to lock your gaze on a single foe.',
      'The Iron Shadow ninjas hold a fort west of the pass. Tsukimura lies beyond.',
    ],
  },
  {
    name: 'Tsukimura', wall: 0xd8d4c8, roof: 0x34304a,
    shops: [{ shopName: 'Moon Gate Trader', merchant: 'Widow Aoi', stock: ['potion', 'elixir', 'w:raijin', 'b:raiden', 'a:dragon', 'c:regen'] }],
    elder: [
      'Our village watches the moon, and lately it rises red over Oni Mountain.',
      'The Black Lotus ninjas keep their stronghold east of the forest road. Their master is the last seal.',
      'Kurogane Castle City is the last great wall before the Demon King. Rest there before the end.',
    ],
  },
  {
    name: 'Kurogane Castle City', city: true, wall: 0xc9c2b6, roof: 0x241d1d,
    shops: [
      { shopName: 'Fortress Quartermaster', merchant: 'Captain Ayame', stock: ['potion', 'elixir', 'w:onikiri', 'a:dragon', 'c:regen'] },
      { shopName: 'Black Iron Forge', merchant: 'Old Yasutsuna', stock: ['w:dojigiri', 'w:onikiri', 'w:raijin', 'b:raiden', 'b:hamaya'] },
    ],
    elderTitle: 'Lord of Kurogane',
    elder: [
      'Beyond our walls lie the Ashen Wastes, and at their end the shrine where Shuten-doji waits.',
      'Old Yasutsuna keeps Dojigiri, the blade that cut the Demon King once, long ago. It hungers to do it again.',
      'When the Demon King slams the earth, a red ring marks the blow. It cannot be blocked &mdash; roll or jump. Go, ronin. End this.',
    ],
  },
];
TOWNS.forEach((t, i) => {
  t.index = i; t.x = PATH[TOWN_IDX[i]][0]; t.z = PATH[TOWN_IDX[i]][1];
  t.r = t.city ? CITY_R : TOWN_R;
});
// Save files from before the cities were added stored towns by their old position.
export const OLD_TOWN_ORDER = [0, 1, 3, 5];

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
  // City forges only.
  kogarasu:  { name: 'Kogarasu-maru', atk: 30, price: 560, color: 0xe0e8ff, glow: 0x203050, speed: 1.15, desc: 'The little crow. Light, quick and razor-keen. Sold only in Miyako.' },
  dojigiri:  { name: 'Dojigiri Yasutsuna', atk: 54, price: 1700, color: 0xfff0d0, glow: 0xc08020, effect: 'demonbane', len: 1.1, desc: 'The blade that cut down Shuten-doji once before. Sold only in Kurogane.' },
  // Warlord rewards: found in demon fortress chests, never sold.
  shadow:    { name: 'Shadowfang', atk: 30, price: 0, color: 0x404050, glow: 0x6a2aff, effect: 'leech', speed: 1.15, desc: 'Taken from Gozu. Fast, and leeches life.', reward: true },
  bloodmoon: { name: 'Blood Moon', atk: 42, price: 0, color: 0xff3030, glow: 0xc00000, effect: 'burn', style: 'jagged', desc: "Taken from Mezu. Burns with a crimson fire.", reward: true },
  celestial: { name: 'Celestial Blade', atk: 52, price: 0, color: 0xffffff, glow: 0x9ad8ff, effect: 'shock', len: 1.15, desc: 'Taken from Ibaraki. Calls down the storm.', reward: true },
  yamata:    { name: 'Yamata Dragonblade', atk: 62, price: 0, color: 0x80ffb0, glow: 0x00c060, effect: 'demonbane', len: 1.3, reach: 0.6, style: 'nodachi', desc: 'Taken from Kuro. The bane of all demons.', reward: true },
};

// Bows for the archer style. Damage comes from the bow's atk instead of the sword's.
export const BOWS = {
  hankyu:    { name: 'Hunting Hankyu', atk: 9, price: 0, color: 0x6a4a2a, glow: 0x000000, desc: 'A short hunting bow.' },
  yumi:      { name: 'Bamboo Yumi', atk: 15, price: 100, color: 0x8a6a3a, glow: 0x000000, desc: 'Laminated bamboo, taller than a man.' },
  lacquered: { name: 'Lacquered Yumi', atk: 23, price: 280, color: 0x2a1a1a, glow: 0x000000, desc: 'Black lacquer and red silk wrapping.' },
  shigeto:   { name: 'Shigeto-yumi', atk: 32, price: 620, color: 0x3a1a1a, glow: 0x3aa0ff, effect: 'frost', desc: 'Rattan-bound. Frost: arrows slow enemies. Sold in Miyako.' },
  raiden:    { name: 'Raiden Bow', atk: 42, price: 950, color: 0x2a2a3a, glow: 0xffd000, effect: 'shock', desc: 'Shock: lightning leaps from each arrow.' },
  hamaya:    { name: 'Hamaya, Demon-Banishing Bow', atk: 54, price: 1600, color: 0xe8e0d0, glow: 0xff5040, effect: 'demonbane', desc: 'A sacred shrine bow. +50% damage to demons. Sold in Kurogane.' },
};

// Fighting styles, picked in the character creator.
export const STYLES = {
  two:    { name: 'Two-Handed Samurai', special: 'Thousand Cuts', desc: 'Katana in both hands. Heavy cuts, quick-draw from the scabbard.' },
  one:    { name: 'One-Handed Swordsman', special: 'Whirlwind Dance', desc: 'Sword in one hand. Faster 4-hit combos and cheaper dodges, lighter blows.' },
  archer: { name: 'Archer', special: 'Rain of Arrows', desc: 'Yumi bow. Click to shoot, right-click for a piercing power shot.' },
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
  custom:  { name: 'Your Own Style', price: 0, custom: true, desc: 'The colors and headwear you chose in the character creator.' },
  ronin:   { name: 'Wandering Ronin', price: 0, cloth: 0x1f2b4d, cloth2: 0x24242e, hat: 'kasa', scarf: 0xa3231a, desc: 'Indigo robes and a straw kasa.' },
  crimson: { name: 'Crimson Samurai', price: 150, cloth: 0x7a1414, cloth2: 0x2a1010, hat: 'kabuto', scarf: 0xd4a72c, armor: 0x8e1b1b, desc: 'Red lacquer and a horned kabuto helmet.' },
  shadow:  { name: 'Shadow Ninja', price: 200, cloth: 0x1b1b21, cloth2: 0x121216, hat: 'ninja', scarf: 0x8a1010, desc: 'Black shinobi garb and a mask.' },
  wolf:    { name: 'White Wolf', price: 250, cloth: 0xe6e3dc, cloth2: 0x7d7f88, hat: 'kasa', scarf: 0x3a6ab8, desc: 'Pale robes of a northern swordsman.' },
  hunter:  { name: 'Demon Hunter', price: 450, cloth: 0x3b1f5a, cloth2: 0x1a1026, hat: 'onimask', scarf: 0x9a3aff, desc: 'Wear the face of what you hunt.' },
  shogun:  { name: 'Golden Shogun', price: 800, cloth: 0x2a2420, cloth2: 0x1a1612, hat: 'kabuto', scarf: 0xffffff, armor: 0xc9a227, desc: 'Gilded armor fit for a warlord.' },
};

// Character creator choices. "Your Own Style" (the custom outfit) uses the colors and
// headwear picked here; skin tone and hair color apply to every outfit.
export const LOOK_OPTIONS = {
  skin: [0xf0c8a0, 0xe0b48a, 0xc99a72, 0xa87850, 0x7a5236, 0x5a3a26],
  hair: [0x14100c, 0x3a2414, 0x6a4a2a, 0x9a9a9a, 0xe8e8e8, 0x7a1a14],
  cloth: [0x1f2b4d, 0x7a1414, 0x1b1b21, 0xe6e3dc, 0x2a4a2a, 0x3b1f5a, 0x8a5a1a, 0x24467a],
  cloth2: [0x24242e, 0x2a1010, 0x121216, 0x7d7f88, 0x3a3020, 0x1a1026, 0x4a3a2a, 0x2a3440],
  scarf: [0xa3231a, 0xd4a72c, 0x3a6ab8, 0xffffff, 0x2a8a4a, 0x9a3aff, 0x1a1a1a, 0xe07a2a],
  hat: ['kasa', 'none', 'band', 'kabuto', 'ninja', 'onimask'],
};
export const HAT_NAMES = { kasa: 'Straw kasa', none: 'Topknot', band: 'Headband', kabuto: 'Kabuto helmet', ninja: 'Ninja hood', onimask: 'Oni mask' };
export const DEFAULT_LOOK = { skin: 0xe0b48a, hair: 0x14100c, cloth: 0x1f2b4d, cloth2: 0x24242e, scarf: 0xa3231a, hat: 'kasa' };

// What each boss says before the duel. Choices:
//   bow   - honor the duel: you start the fight with full Ki.
//   taunt - the boss is enraged: hits harder, but takes more damage and drops more gold.
//   ask   - the boss reveals how it fights (then you choose again).
export const BOSS_TALK = {
  master0: { lines: ['So the wandering ronin finally finds the Kage. You cut through my students like reeds.', 'Behind me sleeps a gate to the demon realm. My clan was paid well to guard it.'], ask: 'My shuriken fly in threes. Block as they come, and they will fly back to me. If you can.', bow: 'Manners. How rare. Then let us do this properly.', taunt: 'Paid guards? I have cut down scarecrows with more honor.', tauntReply: 'Then die angry, ronin!' },
  master1: { lines: ['Mist hides the blade. Mist hides the gate. Mist will hide your body.', 'Kasumi does not lose twice.'], ask: 'I strike quick and leap away. Strike when I land, not when I flee.', bow: 'A bow... You remind me of my old master. A shame.', taunt: 'Twice? I did not know you had lost even once.', tauntReply: 'Insolent dog! The mist takes you!' },
  master2: { lines: ['Iron Shadow Fort has never fallen. My skin is iron, my will is iron.', 'Turn back, or be hammered flat.'], ask: 'Quick cuts barely scratch me. Only a heavy blow will break my stance.', bow: 'You show respect to iron. Iron will show you none.', taunt: 'Iron rusts, old man.', tauntReply: 'RUST? I will bury you in this fort!' },
  master3: { lines: ['The Black Lotus blooms only in the dark. The Demon King made it so.', 'Every master before me died. I am the last seal.'], ask: 'I fight like all three before me: fans of shuriken, fast steps, and an iron stance.', bow: 'You honor the dead masters. I will send you to them with honor.', taunt: 'The last seal? Then the last to fall.', tauntReply: 'The lotus will drink your blood!' },
  warlord0: { lines: ['GOZU SMELLS STEEL. GOZU SMELLS FEAR.', 'Little human came through the portal. Little human will not leave.'], ask: 'GOZU SMASHES THE GROUND! Red ring means run, little human.', bow: 'Bowing? GOZU LIKES THAT. Gozu will crush you politely.', taunt: 'You smell worse than the lava, ox.', tauntReply: 'GOZU WILL EAT YOUR SWORD!' },
  warlord1: { lines: ['Mezu has watched you since the river. You fight well... for meat.', 'My brother Gozu fell? Then I will be twice as cruel.'], ask: 'My club is long and my patience short. Do not stand still in front of me.', bow: 'Respect, from meat? Mezu will remember it. Briefly.', taunt: 'Your brother squealed when he fell.', tauntReply: 'YOU WILL SCREAM LOUDER!' },
  warlord2: { lines: ['Ibaraki lost an arm to a samurai once. Ibaraki took his head in return.', 'Come. Let us see what you will lose.'], ask: 'I slam the earth when you are close. Jump, or roll out of the ring.', bow: 'That samurai bowed too. Then he begged.', taunt: 'One arm? This should be quick.', tauntReply: 'I will rip off BOTH of yours!' },
  warlord3: { lines: ['Kuro burns. Kuro has always burned.', 'The Demon King gave me this flame. Through me, he sees you now.'], ask: 'My flame makes me relentless. Parry my blows, and my guard breaks.', bow: 'The king will be pleased you died with grace.', taunt: 'Then let him watch his pet go out.', tauntReply: 'BURN, RONIN! BURN!' },
  boss: { lines: ['So. The ronin who walks my road.', 'You slew my masters, my warlords, my children. You stand in my shrine with their blood on your blade.', 'I am Shuten-doji. Kneel, and I will make your death quick.'], ask: 'Hah. I will charge you down, and when I slam the earth, nothing stands. Even you.', bow: 'You bow but do not kneel. Interesting. Then fight, and be remembered.', taunt: 'I did not walk this far to kneel to a drunk demon.', tauntReply: 'INSOLENCE! I will drink from your skull!' },
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
