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

The road is about 2.7 km long, and each stretch is longer and more dangerous than the one before. Every two villages there is a great walled city:

| Stop | Kind | The road beyond |
| --- | --- | --- |
| Sakura Village | village | Bamboo Road: bandits, red oni, Kage Hideout |
| Kawaguchi | village | Riverlands, Mist Fang Camp |
| **Miyako, the Capital** | city (Forge of Masamune: **Kogarasu-maru**) | Capital Plains |
| Ishiyama | village | Stone Pass, Iron Shadow Fort |
| Tsukimura | village | Moonlit Forest |
| **Kurogane Castle City** | city | Frost Pass: snow, frozen pines |
| Yukimura | snowy village | Firefly Marsh, Black Lotus Stronghold |
| Hotarumura | village | Iron Valley |
| **Hagane, the Last Citadel** | city (Black Iron Forge: **Dojigiri Yasutsuna**) | Ashen Wastes, then the Demon King |

Three hidden hamlets sit at the end of side trails off the main road: Takenoko (bamboo grove), Kirigamine (snowy mountain) and Minato (fishing village). Each has its own shop and shrine.

**Villages** have two rings of houses and white kura storehouses, a well, a bamboo fence, torii gates, lanterns and rice paddies.
**Cities** are walled and laid out on a grid of paved streets you can walk, with lanterns at every crossing. Each has:
- a market avenue;
- a castle compound with an inner wall, a moat and an arched bridge;
- a temple quarter with a hall and a five-storey pagoda;
- a garden with a pond and bridge.

Every shop also sells armor, charms, potions and six outfits: Wandering Ronin, Crimson Samurai, Shadow Ninja, White Wolf, Demon Hunter and Golden Shogun.

### After the Demon King: a new life

Beating Shuten-doji isn't the end. With his last breath he curses you, and you wake as a **six-year-old child** on an island in another world.
Five villages live there around a great sacred tree at the Crossroads. Pick the one that raises you; its gift lasts your whole life:

| Village | Element | Gift | Heirloom blade at 16 |
| --- | --- | --- | --- |
| Kagemura | Shadow | Run 10% faster, longer dodge rolls | Kagekiri (demonbane) |
| Homuramura | Fire | +15% damage | Homura (burn) |
| Kinmura | Golden | +50% gold | Kinryu (shock) |
| Koorimura | Ice | Take 15% less damage | Hyoga (frost) |
| Mizumura | Water | Health slowly heals on its own | Suigetsu (leech) |

You grow up one year for each life task you finish. The tracker under the minimap shows your age and current task:
- fetch water from the well for your family;
- gather herbs and treasures around the village;
- train on the dojo's straw dummies;
- carry letters to the other villages;
- drive off spirit imps, and later wild oni.

You start with an oak bokken. You get a steel katana at 12, and you grow a little taller every birthday.

At 16 the elder holds your coming-of-age ceremony and gives you the village's heirloom blade. Then the **Echo of Shuten-doji** wakes beneath the sacred tree, and you finish what you started.
After that your life goes on: take jobs for gold and grow old in your village. Your hair turns gray at 45.

The five villages are huge: five rings of houses, two lantern-lit ring streets, a general store and a smithy.
Paths link every village to the Crossroads, to its neighbors, to the two villages across the island, and out to the coast.

Your home is in your village: talk to your family by the door, go inside, and sleep in your futon to heal and save.

### Going inside houses

Every house in every village and city has a door. Walk up to it and press **E** to go inside.
Inside you'll find a farmhouse with a sunken hearth, or a merchant's house with a tea table, a scroll alcove and a gold folding screen.
Search the cupboard in each house once for gold or potions. Press E at the door to step back outside.

### Ninja bases and demon fortresses

Each region has a walled ninja base off the road. Ninjas are fast, dodge your attacks and throw shurikens, so block or parry them.
Defeat the base's **ninja master** to break the seal on its portal. The portal leads to a **demon fortress** on a lava island.
Each fortress has a warlord who guards a chest. The chests hold four swords you can't buy: Shadowfang, Blood Moon, Celestial Blade and Yamata Dragonblade.

### Fighting styles

Pick a style in the character creator (change it anytime from the inventory, I):

| Style | Fighting | Special (X, full Ki) |
| --- | --- | --- |
| Two-Handed Samurai | Katana in both hands, heavier cuts, quick-draw from the scabbard | **Thousand Cuts**: flash through up to 8 foes, every cut lands on the sheathing click |
| One-Handed Swordsman | Sword in one hand: 4-hit combos, faster swings, cheaper dodges, lighter blows | **Whirlwind Dance**: a storm of spinning slashes around you, ending in a big finisher |
| Archer | Yumi bow. Click to shoot (auto-aims at the enemy you face), right-click for a piercing power shot | **Rain of Arrows**: a volley falls over a whole area |

Archers buy bows in town shops: Bamboo Yumi, Lacquered Yumi, Shigeto-yumi (frost), Raiden Bow (shock) and Hamaya (demonbane, Kurogane only).

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
