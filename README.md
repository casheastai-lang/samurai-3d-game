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
| Left click / J | Slash. Keep pressing for a 3-hit combo |
| Right click / K | Heavy strike: breaks the guard of big demons |
| Space | Jump. Also dodges the Demon King's ground slam |
| F | Dodge roll (brief invulnerability) |
| Shift | Sprint |
| E | Talk to elders, trade at shops, pray at shrines |
| Q / R | Drink a healing potion / elixir |
| M / H | World map / help |

## The journey

| Town | Shop sells | The road beyond |
| --- | --- | --- |
| Sakura Village | Steel Katana, Lacquered Leather, potions | Bamboo Road: bandits, a few red oni |
| Kawaguchi | Tamahagane Blade, Iron Do, Wind Charm | Riverlands: red oni and bandits |
| Ishiyama | Muramasa, O-yoroi, Jade Charm | Stone Pass: blue oni, oni captains |
| Kurogane Fort | Onikiri the Demon-Cutter, Dragon-Scale Armor, Phoenix Charm | Ashen Wastes, then the Demon King's shrine |

- **Towns are safe.** Demons won't follow you inside.
- **Shrines** heal you, save your progress, set your respawn point, and let you fast-travel to any town you've found.
- **Leveling up** raises your health and attack.
- **Dying** sends you back to your last shrine and costs 30% of your gold.
- **The Demon King** charges and slams the ground (jump or roll out of the red ring). At half health he becomes enraged and calls in more oni.

Progress is saved in the browser's localStorage.

## Code

- `index.html`, `style.css`: page and HUD
- `src/data.js`: road, towns, enemies, shop items
- `src/models.js`: procedural low-poly characters and buildings
- `src/main.js`: world generation, player, combat, enemy AI, shops, travel, UI
