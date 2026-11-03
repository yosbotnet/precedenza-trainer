# Precedenza — right-of-way trainer

A browser game for practising Italian right-of-way rules (precedenza) at junctions and roundabouts, for the driving test.

Play: https://yosbotnet.github.io/precedenza-trainer/

## Modes

- **Read the signal**: live traffic freezes, then you answer. Predict a car's exit from its blinker, tap every vehicle whose path crosses yours, or pick the cars that will pass in front of your roundabout entry.
- **Who goes first?**: random junctions with signs, traffic lights, queues, scooters, buses, pedestrians on zebra crossings and ambulances. Tap everyone in the order they go; afterwards the scene plays out.
- **Junction live**: drive through busy junctions full of AI traffic that follows the rules. Set your blinker and press GO when it's your turn. Going early and missing a clear gap are both marked.
- **Roundabout live**: choose safe gaps into the roundabout and use the blinker correctly on the way in and on the way out.
- **Rules**: a summary of the rules the game uses.

There are four views: top-down map, 3D orbit, behind the car, and driver's seat.

## Code

This is a static site with no build step. three.js is loaded from a CDN.

- `js/geo.js`: junction and roundabout geometry, and vehicle paths
- `js/sim.js`: traffic simulation and the right-of-way rules (signs, precedenza a destra, left turns, lights, pedestrians, emergency vehicles, roundabouts)
- `js/render.js`: three.js scene, the Italian-town scenery, vehicles and cameras
- `js/modes.js`: the four game modes
- `js/ui.js`, `js/main.js`: UI, stats (saved in localStorage), input and the main loop

Practice tool only. Always follow your instructor and the Codice della Strada.
