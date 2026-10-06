# Ronin's Road — samurai-3d-game

A 3D samurai action game that runs in the browser (Three.js). Travel the road north from town to town,
fight bandits and demons, spend your gold at each town's shop, and defeat Shuten-doji, the Demon King.

## Play

The game uses ES modules, so serve the folder over HTTP rather than opening the file directly:

```sh
npx http-server -p 8080 .     # or: python3 -m http.server 8080
```

Then open http://localhost:8080. It also works as-is on GitHub Pages. Three.js is vendored in `vendor/`,
so no install or internet connection is needed.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move (relative to the camera) |
| Mouse | Look around (click the game first). Wheel zooms |
| Left click / J | Slash. Keep pressing for a 3-hit combo. From the scabbard, the first cut is a fast quick-draw (iai) that hits harder |
| Right click / K | Heavy strike: breaks the guard of big demons |
| Q (hold) | Block. Press it just before a hit lands to **parry**: no damage, the enemy is stunned, and shurikens fly back |
| X | Iaijutsu, Thousand Cuts (full Ki): time stops, you flash through up to 8 nearby foes, then sheathe your sword and every cut lands at once |
| Tab | Lock on to an enemy |
| Space | Jump. Also clears ground slams |
| F | Dodge roll (brief invulnerability) |
| Shift | Sprint |
| E | Talk, trade, pray at shrines, open chests |
| 1 / 2 | Drink a healing potion / elixir |
| I | Inventory: swap swords and outfits |
| M / H / G | World map / help / graphics quality (High: glow, grass, sharp shadows; Fast: for weaker computers) |

## The journey

| Town | Swords for sale | The road beyond |
| --- | --- | --- |
| Sakura Village | Steel Katana, Kaze Wakizashi (fast) | Bamboo Road: bandits, a few red oni, Kage Hideout |
| Kawaguchi | Tamahagane Blade, Frost Fang (slows) | Riverlands: red oni, Mist Fang Camp |
| Ishiyama | Mountain Splitter (long odachi), Inferno Edge (burns), Muramasa (lifesteal) | Stone Pass: blue oni, oni captains, Iron Shadow Fort |
| Kurogane Fort | Raijin's Thunder (chain lightning), Onikiri (bonus vs demons) | Ashen Wastes, Black Lotus Stronghold, then the Demon King |

Every shop also sells armor, charms, potions and six outfits: Wandering Ronin, Crimson Samurai, Shadow Ninja, White Wolf, Demon Hunter and Golden Shogun.

### Ninja bases and demon fortresses

Each region has a walled ninja base off the road. Ninjas are fast, dodge your attacks and throw shurikens, so block or parry them.
Defeat the base's **ninja master** to break the seal on its portal. The portal leads to a **demon fortress** on a lava island.
Each fortress has a warlord who guards a chest. The chests hold four swords you can't buy: Shadowfang, Blood Moon, Celestial Blade and Yamata Dragonblade.

### Your samurai and the bosses

A new journey opens the character creator: skin tone, hair, robe, hakama, scarf and headwear. Open it again anytime from the inventory (I).

Before each boss fight (ninja masters, demon warlords and the Demon King) the boss speaks first and you pick a reply:
- **Bow**: start the duel with a full Ki bar.
- **Taunt**: the boss hits 25% harder, takes 25% more damage and drops 60% more gold.
- **Ask how they fight**: hear a hint about their moves, then choose again.

### Rules

- **Towns are safe.** Demons won't follow you inside.
- **Shrines** heal you, save your progress, set your respawn point, and let you fast-travel to any town you've found.
- **Your katana rests in its scabbard** when you're not fighting. Attacking or blocking draws it; after a few calm seconds you sheathe it again.
- **Combos** add up to +30% damage. Landing hits, parrying and deflecting fill your Ki.
- **Dying** sends you back to your last shrine and costs 30% of your gold.
- **The Demon King** charges and slams the ground; neither can be blocked, so jump or roll. At half health he becomes enraged and calls in more oni.

Progress is saved in the browser's localStorage.

## Code

- `index.html`, `style.css`: page and HUD
- `src/data.js`: road, towns, bases, enemies, swords, outfits and shop items
- `src/models.js`: procedural low-poly characters, swords, buildings, portals
- `src/world.js`: terrain, lakes, sky, grass and trees with wind, towns, ninja bases, demon fortresses
- `src/textures.js`: procedural textures (plaster, wood, roof tiles, stone, shoji, fabric, bark, water ripples)
- `src/fx.js`: particles, sword trails, lightning, ambient petals and embers
- `src/main.js`: player, combat, enemy AI, shurikens, portals, shops, inventory, UI
- `vendor/`: Three.js and its bloom post-processing add-ons
