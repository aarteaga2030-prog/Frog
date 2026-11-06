# Frog Jedi: Swamp Saga

A 3D browser action game: a rain frog with a lightsaber defends the swamp from waves of droids and the Sith Toad.

## Play

The game loads 3D model files, so it has to be served over HTTP. Opening `index.html` directly from disk won't work.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Three.js is bundled in `lib/`, so the game works offline. It also works on GitHub Pages: enable Pages for the branch and open the site.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Hop around |
| Drag on a touchscreen, mouse, or `←` `→` | Look / aim |
| `J` (or left click) | Saber slash; hits enemies and deflects bolts |
| `K` / `Shift` (or right click) | Block; deflects blaster bolts back at the shooter |
| `Space` | Jump; press again in the air for a Force Flip (costs Force) |
| `F` (or `E`) | Force Push: knocks back enemies and reflects bolts |
| `Q` | Saber Throw: the saber spins out and comes back |
| `M` | Mute |
| `Esc` / `P` | Pause |
| `Enter` | Start, resume, or retry |

## Gameplay

- **Blaster drones** keep their distance and shoot. Block or slash their bolts to send them back.
- **Buzzers** dive in for melee hits. Slash them out of the air.
- **Sith Toad** (every 4th wave) is a dark frog with a red saber. Block just as it swings to **parry** and stun it, then hit back for double damage.
- Start blocking right before a bolt arrives for a **PERFECT** deflect: it costs no Force and flies straight back at the shooter.
- Clearing a wave restores 25 health.

## Project layout

```
index.html          page + HUD markup
src/main.js         game: player, enemies, combat, camera, loop
src/world.js        swamp environment
src/audio.js        synthesized sound effects (Web Audio, no files)
src/style.css       HUD / menu styling
lib/three/          vendored three.js r160 (MIT)
RainFrog_FreeDownload 2.obj        frog model
anakin_skywalkers_lightsaber.glb   lightsaber hilt
Frog.zip            alternate frog model + textures (not used by the game)
```

## Credits

- Lightsaber model: "Anakin Skywalker's Lightsaber" by Paul (https://sketchfab.com/bbfizzle), licensed CC-BY-NC-ND-4.0. Source: https://sketchfab.com/3d-models/anakin-skywalkers-lightsaber-b032515c9ff3471fbb824bb4ec81cde3
- Rain frog model: free download included in this repo.
- [three.js](https://threejs.org) (MIT).
