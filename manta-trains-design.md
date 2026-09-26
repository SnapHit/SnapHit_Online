# Manta trains: design decisions

Working title. Version 1.14, 26 September 2026 (1.14: Nathan's retune after the wild count bug, a far fuller and smaller ocean; lag compensation planned from the first playable rooms, after measuring mobile data; 1.13: how the rooms Worker is deployed, checked and switched off; the rooms go live in two steps; phones and the room run the same build; no pushes during a playtest; maths that differs between machines; 1.12: the greybox built, with bots that give way, every manta drawn, crash debris that sinks away and set pieces that fire once, on screen; the simulation's acceptance tests measured; burst cost set to 1.0 seconds; live rooms decided, and built before the human playtests; 1.11: the greybox's world, rules, bots and leaderboard built; every wild manta counts towards the target; the reef measured apart from moonlight; the greybox's tuned values; 1.10: a crash ends your run, as in slither; wild mantas fewer, smaller and slower to regrow; Nathan's steering values; 1.9: the look spike built and tuned, with its final values; a palette that keeps pink for the pink manta; the greybox plan updated for everything the spike learned; 1.8: every manta bright, as in slither, with warm colours freed from danger duty; your colour rolled at random each run, as in slither; the hierarchy measured for that; no round blobs in the ocean; 1.7: a seabed you can see, lit by moonlight that moves; wild mantas dark like the real animal, lighting up when they join a train; the hierarchy measured the new way round; and Nathan's final tuning; 1.6: a moonlit ocean where life makes the brightest light, the manta measured from a reference photo, electric lime for the player's train, a tighter bloom, and the WebGPU limits learned the hard way; 1.5: the look spike's tuned values, how the brightness hierarchy is measured, untinted bloom and no gold, a page-wide flash cap, three lessons for the greybox, and names for the wake, the sparkle and the bloom; 1.4: the Pixel 9 result and the 60 Hz budget, the repo's paths, automatic fallback, the camera's fixed view area and the decision not to minify; 1.3: the lab page, portrait-first layout, Three.js pinned at r186, Brief 0's scope and how this doc stays in sync; 1.2: WebGPU renderer, the look direction, the identity system and the build approach; 1.1: the prototype gets a cheap procedural look instead of grey shapes). Studio: SnapHit Studios (snap-hit.online). Owner: Nathan.

**Status:** concept locked. The look spike is built and tuned (Briefs 0 to 1J). The greybox is built (Briefs 2A and 2B): the world, the four rules, ten bots, a leaderboard, touch schemes A, B and C, and a debug panel, and the acceptance tests the simulation can run have been measured (section 10.3). Next: live rooms (10.6), decided in September 2026 and built before any human playtests, so testers play each other from their first swim. The human acceptance tests, the cheap Android and three people on the look then run on the multiplayer build.

**How to use this file:** sections 1 to 9 record what was decided and why, section 10 is the build plan, and sections 11 to 15 cover risks, open decisions, parked ideas, terms and sources. Anything marked (P) is a proposed default to confirm in the greybox; everything else is decided.

## 1. Summary

**Pitch:** lead a train of wild manta rays; touch another train and yours scatters, burst through one and you slice it.

Manta trains is a top-down browser arcade game. You play a manta that can never stop swimming. Wild mantas you swim near fall in behind you, and your train's length is your score. Your train is also a wall: a rival leader who touches it crashes and loses their whole train. Bursting costs you followers but lets you slice straight through a rival's train, scattering everything behind the cut. It keeps the proven heart of slither.io, grounds every rule in something real mantas do, and fits SnapHit's static setup by filling the ocean with wild mantas and rival bots. It's set in a moonlit night ocean where life makes the brightest light, and every manta is a catalogued individual whose challenge links carry it into friends' oceans, so the game feels social without a server.

## 2. Goal

- Make a new SnapHit game as elegantly simple as agar.io and slither.io.
- Top-down, simple simultaneous play, instant to start on phones, desktops and school Chromebooks.
- Spread organically through creators, clips, challenges between friends and word of mouth, not paid marketing.
- Genuinely visually stunning in a browser, without costing readability or phone frame rates.

## 3. What we learned from the .io hits

### 3.1 Slither.io (2016)

- Organic growth: a solo developer with no marketing budget. PewDiePie made videos without being approached, followed by other big English and Spanish-language creators.
- Zero friction: browser and iOS on 25 March 2016, Android two days later. HTML5 and WebSockets rather than Flash, so it ran on school computers. Free apart from a one-off payment to remove ads.
- The charts did the rest: the world's most downloaded game from April to June 2016 (80 million plus), the most Googled game of 2016, and Google's ninth-biggest trending search worldwide that year.
- It arrived to a primed audience (agar.io had already taught the loop) and added Snake nostalgia.
- Design that worked: constant motion; your head touching another snake's body kills you, so a tiny snake can kill a giant; dead snakes become bigger, brighter pellets; boosting burns length into a trail of pellets; coiling traps smaller snakes; a deadly circular border; a top-ten leaderboard; skins and names; neon worms on a dark background; chase pellets that flee.
- Weak spots: lag and server capacity, post-death ads, name moderation, low replay value.

### 3.2 Agar.io (2015)

- Organic growth: one 4chan post, then streamers (Vinesauce within a week, then PewDiePie from 30 May 2015, whose fans had already been asking for it).
- Stripped design: the developer considered biology features, then cut back to basics. Bigger cells move slower and shed mass, viruses shatter big cells, and splitting and ejecting mass both cost something.
- Names as flags: players backed countries and causes, and a Games and Culture journal article argued this was the main reason for its success.
- Miniclip scaled it only after it was already a hit.

### 3.3 Snake.io (2016 onwards)

- A fast-follow clone that lasted: offline play, no lag, a bot-filled default mode, an exact-match name, distribution everywhere (web, app stores, Apple Arcade, Netflix, Switch) and paid marketing (TikTok).

### 3.4 The pattern

- The originals went viral for free through creators and word of mouth; the clone leaned on search traffic and paid marketing.
- Real players in the same arena were the heart of agar and slither: the other players were the content.
- The flood of .io clones fragmented players, which is why bots became standard.

### 3.5 What the look did, and didn't do

- Colour wasn't the engine. Agar was flat circles on a grid and still exploded; reviewers praised its simple graphics alongside its gameplay. Slither's neon worms on a dark background were praised, but friction, real people, upsets and creators did the heavy lifting.
- Colour did three jobs worth copying: readability (who can hurt whom at a glance), legibility on video (saturated colour on dark reads in thumbnails and survives compression) and identity.
- Identity was the real lever. A Games and Culture article argued agar's names acting as flags were the main reason for its success. Slither shipped national-flag and YouTuber skins plus a custom skin builder, and its browser version once made players share the game to unlock skins.

## 4. Design principles

The five-point test. Every rule and feature must pass:

1. It explains in one sentence.
2. One number carries the state.
3. The smallest player can beat the biggest.
4. Every button costs something.
5. Every death feeds someone else.

Supporting principles:

- Subtract until it hurts.
- Every rule should be something real mantas do.
- It must be fun with nobody else online.
- Rules before art: the prototype gets a cheap procedural look, but if it isn't fun then, final art won't save it.
- Light carries information: stunning must never hide the game.
- Identity is the lever: give players something to be, somewhere to belong and someone to send it to.

## 5. Decision record

### 5.1 Mantas over seagulls

- Seagull food theft is a crowded joke: itch.io is full of it, and there's a board game.
- A top-down camera suits a manta's silhouette but throws away a gull's comic face.
- Nature supplies manta mechanics: chain feeding in each other's slipstream, and cyclone feeding.
- A dark ocean with glowing plankton suits SnapHit's neon-bloom branding.

### 5.2 Mechanic selection

- Long list of about 35 mechanics in nine families: predation, territory, theft, physics, crowds, roles, deception, cooperation and async.
- Pass 1, would it spread: a stranger gets a silent five-second clip; the rules create sudden upsets; there's a reason to bring a specific friend; the pitch isn't another agar clone.
- Pass 2, would it last and can SnapHit ship it: fun with nobody else online; still interesting on the fiftieth round; one thumb plus at most one button; true to the animal; launches inside the static rules.
- Top five: one hot chip (seagulls), spot the human (seagulls), manta trains, lure the orca, and the cyclone commons.
- Chosen: manta trains.

### 5.3 Trains over the solo loop

- Trains win on truth to the animal, cold start, stakes, readability, touch controls and depth.
- The loop had a more elegant number (wingspan balanced itself) and looked less like slither.
- The solo loop was cut: real cyclone feeding is a group effort, and underneath it was Paper.io's rule, where the safest play is timid little loops.

### 5.4 Closing the length gap

- Problem: train length was only score and liability; it gave no power.
- Options considered: bigger trains recruit from further away (snowballs); only bursts can cut, so trains act as walls; closing your train on itself nets wild mantas (a cyclone).
- Adopted: slither's lethal body (touch a train and you crash) plus the burst-cut. Length now has three jobs: weapon, weakness and ammunition.

### 5.5 Renderer: WebGPU from day one

- Decided: WebGPU from day one, expecting coverage to grow, through Three.js's WebGPURenderer with TSL shaders, which compile to both WebGPU and WebGL2 and fall back to WebGL2 automatically.
- Why: WebGPU raises the ceiling for living-water effects (compute-driven plankton, fish schools and currents), and Three.js avoids writing every shader twice.
- Known costs: coverage estimates range from about 83% (caniuse) to 95%. Samsung phones with Xclipse GPUs probably won't get WebGPU until Chrome 154, Firefox on Android has it behind a flag, and iPhones need iOS 26. Three.js's own docs still call WebGPURenderer experimental, and it's a large library to copy into the repo.
- Rules that follow: the signature look must hold on the WebGL2 fallback; anything built on compute is an enhancement tier with a lesser fallback version; both backends are tested at every milestone; and if WebGPU starts but fails in the first frames, the page rebuilds itself on WebGL2 with a fresh canvas and carries on, since a canvas keeps the first context type it is given.
- Measured on the Pixel 9 (Chrome 153, Arm Valhall) in September 2026: WebGPU is live, both backends hold 60 fps, and neither is faster to a first frame. The gap the fallback exists for is older browsers, not this one.
- Considered and rejected: Canvas 2D (fine for half decent, can't reach stunning), a custom WebGL2 renderer (lean and universal, but no WebGPU path without a rewrite), a custom WebGPU renderer with a hand-written WebGL2 fallback (every shader written twice) and WebGPU only (excludes too many phones).

### 5.6 Identity system selection

- Evidence: identity was the lever behind agar and slither (3.5).
- Long list of about 27 ideas across six layers: self, groups, status, style, social and artefacts.
- Pass 1, would it spread: visible in a clip without explanation; a reason to send something to a specific person; an us and a them; something for creators to build a community around; zero setup. Cut: home reefs, a morph menu, emoji names and a conservation tie-in. Folded: titles into archetypes, and the daily card into the manta card.
- Pass 2, would it last and can SnapHit ship it: works with links and on-device storage alone; the first swim stays instant; safe for kids; the look stays readable; builds attachment over weeks without grind; cheap to build procedurally; gets better if live rooms arrive. Cut: schools (a child-safety line) and creator skins (they need partnerships). Folded: scars into marks, grudges into friends' mantas, and countries into tags. Added: the passport.
- Result: the eight-part system in 7.3.

## 6. Core rules

### 6.1 The four rules

1. Swim near wild mantas and they fall in behind you; your train's length is your score.
2. You never stop and only swim forwards (true to life: mantas must keep swimming to breathe).
3. If your leader touches another train or the reef, you crash: your whole train, you included, scatters into glowing wild mantas for anyone to recruit, and you start again as a lone manta somewhere else in the ocean.
4. Hold burst to speed up, paid for by your last follower, who drops off behind you (the exact touch input is chosen in the greybox). Burst through another train and you cut it instead of crashing; everything behind the cut goes wild.

### 6.2 How they pass the test

- One sentence: the pitch.
- One number: length is a wall others crash into, a long target for cuts, and the currency for bursts.
- Smallest beats biggest: make a giant crash into you, or slice it.
- Every button costs: each burst sheds a follower.
- Every death feeds someone: crashed and cut mantas go wild and glow.

### 6.3 Rule details and edge cases

(D) means decided or directly implied by the four rules. (P) means a proposed default to confirm in the greybox.

Recruiting

- (D) Only your leader recruits; followers don't (rule 1). This stops long trains hoovering up the ocean.
- (P) A wild manta joins when it comes within the recruit radius of your leader.
- (P) New recruits join at the tail.

Trains

- (P) Followers trace the leader's exact path at fixed spacing, so a train reads as a clean line, while each follower keeps its own wingbeat so it still looks like a creature.
- (D) Your own train is harmless to you. Coiling depends on it.

Crashing

- (D) A crash only affects the crasher; the train you hit is unharmed.
- (P) Touching means your leader overlaps any part of another train, and a leader counts as the front of its own train.
- (D) A crash ends your run: your whole train scatters, and you start again as a lone manta somewhere else, so you can never swim back and collect it.
- (P) The restart comes after a death beat of about 1.5 seconds (your train bursts into light, the camera pulls back and your run's peak shows), at least 800 units from the crash and clear of every train.
- (P) A lone leader who touches a train crashes the same way; it has nothing to lose but its place.
- (P) Two leaders meeting head on both crash, unless exactly one is bursting (see below).

Bursting and cutting

- (D) Bursting needs at least one follower to pay with; at zero followers it stops.
- (P) Holding burst drains followers from the tail at a steady rate, like slither's boost.
- (D) A cut happens where a bursting leader touches another train: every follower behind the contact point goes wild, and the rest of that train, including its leader, carries on.
- (P) Bursting into another leader counts as a cut at the very front: their whole train goes wild and their leader carries on alone.
- (P) If two bursting leaders meet head on, both crash.

Wild and scattered mantas

- (D) Scattered mantas glow and join the first leader to touch them.
- (P) The glow lasts a few seconds; anything nobody collects in that time sinks away, so a crash is a feast to race for, not a lasting change to the ocean.
- (P) Every manta is worth one point of length, scattered or not; the pink manta is the exception.
- (P) Wild mantas gather where plankton is densest. Plankton is scenery and an attractor, not something you collect (it was the resource in the rejected solo loop concept, which is why this needs saying).

Scoring

- (D) Score is your current train length, shown on the live top-ten board.
- (P) A run lasts from starting alone to your next crash, and a run's score is its peak length. Your personal best is your best peak, kept on the device.

## 7. Features, look and identity

### 7.1 Features

- Wild mantas are the resource and, technically, bots, so the ocean feels alive with nobody else online.
- Rival leader bots behave like real mantas with personalities (greedy, timid, bully) and carry honest bot tags. Each is a catalogued individual, like a player's manta.
- A rare pink manta flees and can only be caught with a burst. The real one off Lady Elliot Island has a black back and a pink belly, so from above it looks ordinary until it rolls and flashes pink. It gets an original name (the real one's nickname comes from the Pink Panther films). (P) It's worth more than one follower; the exact value is open.
- Identity: every manta is a catalogued individual, with crews, secret names and friends' mantas swimming in your ocean; no skin menu and nothing before the first swim (full system in 7.3).
- Look: a moonlit night ocean where life makes the brightest light (full direction in 7.2). Followers keep individual wingbeats and break formation the moment they're cut or scattered, so a train reads as a line of creatures rather than a snake.
- No death screen: a crash ends the run with a death beat of about a second and a half and a small card with your run's peak length, your best, a clip button, a challenge link and a way to your manta card, and you're swimming again somewhere new, as in slither but without a menu.
- Top-ten leaderboard.
- Daily seeded ocean plus events: a plankton bloom that drags every train together, a whale shark that ploughs through lines, the pink manta's appearances. (P) The whale shark cuts any train it crosses, and touching its body counts as a crash.
- Challenge links: every run ends with a link that replays the same seed with your score attached and carries your manta into the friend's ocean (7.3); no server needed.
- Clip button: one tap saves the last few seconds as a video recorded on the device.
- Controls: steering plus one burst input, on touch, keyboard and mouse (candidates in section 10.2).
- Camera: follows your leader and zooms out as your train grows, so big trains can see the danger coming.

### 7.2 Look: life makes the brightest light

- **The idea:** a moonlit night ocean seen from above. Moonlight refracted through the waves lays a slow, flowing web of caustics across the seabed, the mantas' shadows glide over it, and now and then a cloud dims the moon and lets it back, so the water itself is alive and never quite the same twice. Against that stage, every moving thing stirs bioluminescent plankton, which glows when disturbed, so trains paint glowing ribbons, bursts flare, cuts explode into light, and each match leaves a fading light painting of itself. The living light is the signature effect, and it's what every clip will show. Moonlight sets the stage; life makes the brightest light. Every manta is bright, as in slither. A wild manta wears its own colour and takes its train's colour when it joins; after a scatter it glows in that colour while it's up for grabs, until its own colour returns.
- **Light carries information:** every manta is bright and saturated, as in slither, and the moonlit seabed sits beneath them all. Your train glows brightest: whatever colour it rolled, it burns hotter than any other manta and trails the brightest light, and the camera keeps it centred. A train's colour says whose it is, and its members trail light in that colour; wild mantas wear their own colours and stir only the plankton's own faint blue-green. Events at peak. Glow, the camera and a colour no one else wears that run set your train apart; formation, trails and colour tell trains from wild mantas. It is measured, not eyeballed, by four conditions: (1) your train burns hotter: its median is at least 1.4 times what the same colour measures at the level every other manta uses, lifted towards white where a saturated colour runs out of room; (2) moonlight never outshines life: the seabed's and the caustics' brightest crests stay below the dimmest manta's median, while the reef's glow is a danger marker, not moonlight, and is measured apart; (3) every manta's median is at least twice the water in a ring around it, over the brightest seabed, inside a wake, beside a train, and anywhere more than a wingspan inside the reef; (4) the wake just behind a train's last follower stays dimmer than that follower, so the end of a train is never ambiguous. Sparkle crests may be as bright as they like, since a few bright pixels hide nothing. Version 1.7 made wild mantas dark silhouettes, as in the reference photo; on the phone Nathan preferred slither's bright colours for every manta, so 1.8 measures brightness, contrast and colour instead.
- **Colour discipline:** slither's lesson is saturated colour that contrasts with its background, which reads at a glance, in thumbnails and through video compression. Against a teal-blue seabed the colours that pop are warm and violet, so every manta other than yours wears one of a small set of bright hues: orange, scarlet, violet, purple, azure and green. Your own train's colour is rolled at random each run, as in slither, from electric lime and the same set except scarlet, which can't burn hotter and stay red. It is yours alone for that run: no rival or wild manta wears it, and a wild manta takes it only by joining you. Bots may share colours with each other, never with you. Pink stays reserved for the pink manta, so nothing may read as a bright pink: warm colours lighten towards their own hue and stop at about 0.65 saturation on screen (0.90 in linear light), because a light red is pink by definition, while cool colours lighten towards white. A dim plum tint in the tail of a red wake over blue water is colour mixing, not pink, and is allowed. Coral was dropped and the rose red became scarlet for the same reason. Warm colours are no longer reserved for danger: the reef reads as danger by its place, its ring and its slow pulse, the way slither's border does. Bloom is untinted, so it amplifies each source's own colour. A wake takes the colour of the train that made it, so a trail shows whose it is, with its freshest light burning towards white, or for a warm colour towards a lighter version of itself. The moonlight is a cool blue-white, and the seabed it lights is cyan-teal where the moon reaches and bluer in shadow. White was ruled out for your train because it merges with the fresh wake and the moonlight, and a gold tint on the bloom was ruled out because it turned your train yellow-green.
- **Depth:** three layers: the seabed, a real floor of sand, rubble and dark reef seen through moonlit water, where the caustics and the mantas' shadows play in slow parallax; the swimming layer; and a subtle surface ripple over everything, which also bends the light beneath it. Marine snow at three depths and wild mantas at varying depths give the ocean volume.
- **The mantas:** silhouettes whose wings flex in the shader, with each follower's wingbeat slightly behind the one ahead, so a whole train ripples like a single ribbon. Name-generated patterns, rim-lit from the glow beneath. The outline is measured from a reference photo (10.2). At play scale a manta is about 40 CSS pixels across, so identity reads through colour, brightness and silhouette; patterns and marks read in close-ups (the manta card and the victory roll), and at play scale they only need to register as texture. Every manta wears the real animal's markings, a pale V and pale wingtips, over its colour.
- **Set pieces:** the recruit (a wild manta taking its new train's colour, from the head out), the cut (a shockwave ripple through the water, a light burst, a beat of slow motion), the crash (your whole train unravelling into scattered lights as the camera pulls back, before you start again elsewhere), the coil (the ring brightening as it closes), the whale shark (a vast dark shape visible only by the plankton it disturbs) and the pink manta's flash.
- **Rendering:** an ocean and plankton shader; a caustic pattern generated once in code and sampled twice per pixel as it flows; a low-resolution pass that casts the mantas' shadows onto the seabed; a light memory texture around the camera that fades each frame and is stamped by every moving manta; all mantas as one instanced mesh; particles; a low-resolution bloom chain; and a final grade with vignette, grain and shockwave distortion. On WebGPU devices, compute can later add living water (hundreds of thousands of plankton particles, fish schools and currents), with a lesser version on the fallback.
- **Phone budget:** resolution scales with frame time, and quality tiers step down visuals, never gameplay. The plankton lives in a shader, so cost scales with pixels rather than object counts. Few shaders keep it opening instantly. Target: 60 fps on Nathan's phone and a cheap Android. Measured budget: 16.7 ms a frame, since the Pixel 9 reports 60 Hz; whether 120 Hz is reachable is a separate question. Resolution follows the adaptive ladder already proven in the repo's NOTES.md.
- **Accessibility:** cap flashes at three a second across the whole page rather than per effect, offer a reduced-flash setting that also follows the system's reduced motion preference, and never rely on hue alone to tell you from rivals. Reduced flash keeps the information (the scatter after a cut) and drops the flash to 30 percent, the slow motion and the distortion. Moonlight changes slowly: a cloud pass takes seconds, never a flash.
- **Precedent:** flOw, a free Flash game with a similar look, was praised for its visuals, but reviewers flagged its simple gameplay and some called it more art piece than game. Here the look serves the rules.
- **Briefs carry specifics, not adjectives:** palette hex values, the brightness hierarchy, and reference footage (Hanifaru drone footage of manta trains, night bioluminescence).

### 7.3 Identity system

Rules that shape it:

- No server or accounts: identity lives on the device and travels in links.
- Nothing before the first swim; every identity feature is automatic or optional.
- Safe for kids: players name their manta, not themselves; the game never asks for a school or location; symbols are curated or abstract.
- Identity lives in patterns, emblems and marks. The glow hierarchy (your train brightest) never changes.
- True to the animal: each real manta has a unique belly spot pattern that stays largely unchanged for life, like a fingerprint. Researchers keep photo-ID catalogues, number and name individuals (the pink manta is number 900 in Project Manta's database; Taurus, first recorded off Lady Elliot Island in 1982, is at least 50) and log injuries and scarring.

The system, ranked by impact:

1. **Friends swim in your ocean.** A challenge link carries your manta: name, pattern, crew, marks and a bot brain tuned to how you play. Opening it adds that manta to the friend's ocean as a named rival they can cut, and theirs comes back the same way, so your ocean fills with people you know without a server. Your pod lists every manta you've met, and visiting mantas hold a grudge against whoever cut them last. Creators can send their manta to every fan with one link. Only mantas whose owners chose to send them ever appear. Precedent: Forza's Drivatars, AI modelled on real players that appear in friends' races.
2. **Any tag is a flag.** A tag in brackets, such as [REEF], gives everyone using it the same crew emblem, generated from the tag, so friend groups, classes and creator communities form crews instantly. Country names are special tags that paint flag colours into the back pattern, never the glow. Emblems are abstract, so nobody can draw anything hateful.
3. **Secret names.** A curated list of words unlocks rare morphs and looks; every other word generates a normal pattern, so there's nothing to exploit. Agar's predefined words spread through lists and videos, and this seeds the same rumour mill.
4. **A catalogued individual.** Every manta gets a spot pattern generated from its name, a catalogue number and a morph. After a big cut it barrel-rolls and flashes its belly, so its fingerprint appears at its best moment, right in the clip. Followers glow in its colours, so the bigger the train, the bigger the flag. Default names are good enough that people keep them.
5. **What kind of manta are you?** A playstyle archetype (six types, such as slicer, collector, coiler and daredevil) computed from runs. It evolves, it's shareable, and it sets the bot brain's greed, caution and aggression dials when the manta visits friends' oceans, so one calculation does two jobs.
6. **Marks that tell your story.** A small set of permanent marks for real feats (catching the pink manta, a 100-long train, a huge cut, surviving the whale shark, a week's streak), visible wherever the manta swims.
7. **The manta card.** One shareable card with pattern, name, crew emblem, archetype, marks, records, catalogue number and the challenge link. It's this game's Wordle grid, and the envelope the manta travels in.
8. **The passport.** The whole manta in one private link or QR code, so it survives cleared browser storage and moves between phone and school laptop, with no accounts.

All of it is cosmetic or social; the four rules and the five-point test are untouched.

## 8. Against slither

Matched or beaten: upsets (two routes), death feeds the living (a glowing swarm), a price on power, constant motion and coiling, a chase target (the pink manta), identity (catalogued mantas, crews, secret names and friends' mantas), look (a moonlit ocean where life makes the brightest light), and restart (the crash card).

Slither's weak spots beaten: lag (rooms send only each leader's path, the server runs the same simulation as the phone, and solo play has none), ads (none, since zero external requests rules them out, and nothing to buy), names (nobody sees a name you didn't share), replay value (daily ocean and events).

Can't copy, and the substitute:

- Real humans: friends' mantas carried in by links and driven by bots tuned to how their owners play, plus bots with personalities and honest tags, and live rooms full of bots that people replace as they join (10.6).
- Nostalgia: the "wait, mantas really do that?" facts.
- App stores and 2016 YouTube: the built-in clip button and loud money shots (the cut, the crash, the coil).

## 9. Constraints

Technical (the repo's CLAUDE.md invariants apply):

- Static site on Cloudflare Workers Static Assets, deployed from GitHub (SnapHit/SnapHit_Online).
- Zero external requests: no ad networks, analytics, external fonts, CDNs or third-party scripts. Everything ships in the repo.
- One Worker, for Manta trains' live rooms only, with a Durable Object per room. It runs on snap-hit.online itself, so zero external requests still holds, and everything else stays static. This changes CLAUDE.md's no-Worker invariant deliberately (September 2026).
- The Worker lives in rooms/ at the repo root, outside docs/, so it is never served. Only /lab/manta/rooms/* reaches it; every other request, a miss included, stays on the free asset server. Secrets such as the admin key live in Cloudflare's dashboard, never in the repo.
- Only main deploys, with a pinned tool: npx wrangler@4.141.0 deploy, set in Cloudflare's dashboard. Other branches never deploy.
- A Worker that fails to build blocks every deploy of the whole site, every game included, so any commit touching rooms/, wrangler.jsonc or a simulation module the Worker imports passes a dry run of the deploy first.
- Rooms switch off with a one-line change that refuses room connections, and the lab falls back to solo. Once a Durable Object class is deployed, reverting the commit that added it fails to deploy, so removing rooms is a deliberate migration, never a revert.
- Renderer: WebGPU through Three.js's WebGPURenderer with TSL shaders, falling back to WebGL2 automatically. Three.js is pinned at r186 (npm three 0.186.0, released 8 September 2026) and copied into the repo with its licence file, never loaded from a CDN. Its unminified build carries its own JSDoc, so the vendored files double as version-exact API docs.
- The prototype lives at snap-hit.online/lab/manta/: a standalone page, not linked from the arcade shelf, marked noindex, and not embedded in a cabinet until launch.
- Repo paths: the site is served from docs/, so the page is docs/lab/manta/, Three.js is docs/vendor/three/r186/, and this doc sits at the repo root, outside docs/, so it is never served. CLAUDE.md carries the lab's bounded exception to the one-file rule, plus the storage, vendoring and real-device rules that follow from it.
- WebGPU guarantees 8 vertex buffers per render pipeline, and three.js spends one per attribute unless they are interleaved. Going over draws nothing and reports nothing (ten mantas once vanished that way), so the lab page counts its buffers and watches the device for errors on the phone. Headless Chrome 153 runs the WebGPU path for wiring and errors, but its canvas can't be read for pixel checks, which still run on WebGL2.
- Audio: games default to silence when audio files can't load, recorded soundtracks aren't stored in the repo, and nothing streams from external hosts.
- On-device storage for personal bests makes no network request, but confirm it against CLAUDE.md before using it.

Platform:

- Mobile-first: touch on phones is the primary input.
- Portrait-first on phones, with landscape supported.
- Keyboard steering too, for desktops, Chromebooks and SnapHit's existing cabinets.
- "Instant. Play.": no accounts and no menus before the first swim.
- Safe for kids: players name their manta, not themselves; the game never asks for a school or location; identity symbols are curated or abstract; names only reach people a player chooses to share with.

Workflow:

- Nathan works exclusively on mobile, so every build, test and deploy step must work from a phone.
- Claude is architect and reviewer; Claude Code implements from briefs written as full copyable prompt blocks; Nathan is the intermediary.
- Proposals come before consequential changes.
- Claude Code commits straight to main, so verification before each commit is the only safety check.
- Check Claude Code's session reports carefully; one was once misdirected between sites.
- Claude Code's cloud sessions reach package registries and GitHub but not snap-hit.online, so checks on the live site happen on Nathan's phone.
- Test devices: Nathan's Pixel 9 (Chrome, Arm Valhall, WebGPU live) at every stage, plus one cheap Android for GPU variety and an iPhone before launch. Every test page shows which backend is running and can force the WebGL2 fallback, so one phone covers both backends.
- Every brief caps how long verification may run and requires a hard timeout on each browser and server command, because a run once hung and had to be stopped by hand.
- API questions are answered by reading the vendored Three.js source directly, not by fanning out parallel recon agents, which once took 13 minutes to find what one 600-line addon file already said.

## 10. Build plan

### 10.1 Milestones

1. **Look spike:** one screen, no gameplay: the ocean, light memory, bloom and ten mantas swimming, on WebGPU and the WebGL2 fallback, at 60 fps on Nathan's phone (spec in 10.2). Built and tuned on the Pixel 9 in Briefs 0 to 1J.
2. **Greybox prototype:** the four rules on the look spike's rendering pipeline, tuned on Nathan's phone (spec in 10.2).
3. **Live rooms:** people play each other in rooms kept full by bots, with solo play one tap away (spec in 10.6).
4. **Playtest and tune:** run the acceptance tests (10.3) on the multiplayer build with testers playing at the same time, then settle the (P) defaults and the touch scheme.
5. **Art pass:** the full lighting model in 7.2, set pieces for the cut, crash and coil, and audio.
6. **Identity and share layer:** catalogued mantas, secret names, crews, archetypes, marks, the manta card, challenge links that carry mantas, friends in your ocean, the passport, the crash card, personal bests and the daily ocean.
7. **Variety:** bot personalities, blooms as events, the whale shark and the pink manta.
8. **Clip button:** built last because of Apple's canvas recording history.
9. **Launch** on snap-hit.online.

Later: compute-driven living water for WebGPU devices.

### 10.2 Milestones 1 and 2: look spike and greybox spec

**Look spike (milestone 1)**

Purpose: prove the look and the frame rate on real phones before any gameplay sits on top.

In scope:

- The ocean: a deep gradient, a faint seabed in slow parallax and a subtle surface ripple.
- Light memory: a low-resolution texture around the camera that fades each frame and is stamped by every moving manta, read by the plankton shader.
- Bloom at low resolution, a final grade (tone, vignette, grain) and one shockwave distortion.
- Ten mantas on scripted paths, including a short train with offset wingbeats, drawn as one instanced mesh.
- A triggered test of the cut set piece: shockwave, light burst and scattering mantas.
- Dynamic resolution and automatic quality tiers.
- A toggle that forces the WebGL2 fallback, and a frames-per-second readout.

Passes when:

- It holds 60 fps on Nathan's phone and on one cheap Android, on both backends.
- The look holds up on the WebGL2 fallback.
- Mantas and trains stay readable through the glow.
- Three people shown it call it beautiful without being prompted.

Status on 23 September: the first three pass on the Pixel 9 (60 fps on both backends, the look holding on WebGL2, and the four conditions measured at every tier). The cheap Android and the three people are still to run.

Tuned so far on the Pixel 9 (22 September), and the starting point for everything after the spike:

- Wingspan 40 for leaders and 28 for followers, with followers 31 apart along the path. Collision radii stay 14 and 10 until the greybox tunes them, since those are gameplay numbers.
- The outline in the table below: twice as wide as long, a leading edge swept back about 29 degrees, and a sickle wing ending in a sharp tip. The tail runs 0.30 W from the body's end, tapering from about 1.3 CSS pixels to 0.5, dark at the root and pale behind.
- Wingbeat 0.35 Hz, a travelling wave of 1.4 radians along each wing, each follower 0.5 radians behind the one ahead, and 0.90 radians of depth at the tip, Nathan's final choice. The wings narrow by up to 38 percent at the ends of the stroke, a kite shape accepted for the bigger stroke, and light moving across the wings shows the beat.
- Markings brighten rather than darken, so the hierarchy's medians hold: soft pale shoulder patches parting in a V, pale wingtips and a faint spine stripe.
- Water made blue by hue rather than brightness, about rgb(4, 14, 29) in its body, moving to the reference photo's purer hue at the same brightness, about rgb(0, 15, 29).
- Unattached mantas at 0.75 of #2b4a52.
- The wake, in the drawer's units: fade 0.987, deposit 3.00, sparkle 7.9, ribbon 0.25, fresh wake whiteness 1.00, plankton 5.00, marine snow 2.75 and long memory 0.05, Nathan's final tuning. The long memory at 0.05 leaves a faint light painting of the match. Sparkle carries the wake rather than a smooth glow, which drowned a dim manta swimming through it (1.43 times its surroundings against 2.72 to 3.64 with sparkle).
- The player's colour rolled at random each run from lime, orange, violet, purple, azure and green (never scarlet), by the seeded generator, burning 1.4 times hotter than the same colour at every other manta's level. Every other colour sits in a base-level band of 0.248 to 0.280 with a ceiling, so no other manta out-glows your train; lime and turquoise run dimmer on others as a result. Marking strength 2.00.
- Bloom untinted: strength 0.15, radius 0.53 and threshold 0.35, Nathan's final tuning. A wide halo once hid dim wild mantas beside a train; bright wild mantas stand clear of it. At threshold 0.25 and strength 0.6 a rival clipped to the same white as the player's train.
- Neutral tone mapping, since without it the water nearly doubles in brightness and unattached mantas stop reading. Vignette 15 percent at the corners, grain 1.2 percent, and 4x multisampling at the high tier.
- Cost on the Pixel 9: 60 fps on both backends with all of the above and 18 mantas (your train of five, three rival trains of three and four wild), 17 to 18 draw calls and 13 passes, worst 1 percent 17.5 to 19.4 ms.
- Measured margins at these values: condition 1 from 1.57 (orange) to 3.01 (lime) against 1.4; condition 2 at 75 against a dimmest manta of 112; condition 3 at 2.71 against 2.0; condition 4 with over 100 to spare.
- The moonlit seabed: moonlight strength 2.75 (the cap, set by condition 3), caustic strength 1.50, caustic speed 3.00, cloud amount 0 (Nathan turned the cloud passes off) and shadow strength 2.00, Nathan's tuning. The seabed texture is generated in code at 1024 square, 300 units a tile, in about 10 ms on WebGPU and 25 ms on WebGL2 on the Pixel 9. Nothing in the ocean may read as a round blob.
- The seabed, measured from a second reference photo of a manta over a moonlit seabed: water cyan-teal (about 195 degrees) where lit and bluer (about 207) in shadow; the view's edges about 0.6 of its centre; texture whose contrast grows with size, about 3 percent in the finest grain, 7 percent at a fifth of a wingspan and 10 percent at a wingspan and above; and the real manta about a quarter as bright as the seabed around it.

The manta's outline, measured from a reference photo of a manta seen from above with both wings averaged. Values are fractions of the wingspan W: across is the distance out from the midline, and the edges are how far behind the head's front they sit. From 0.00 to 0.10 across is the head, a blunt front about 0.03 back made of two short rounded lobes (the rolled head fins). At the midline the body ends 0.52 back, where the tail starts.

| Across | Leading edge | Trailing edge |
|---|---|---|
| 0.12 (shoulder) | 0.08 | 0.43 |
| 0.16 | 0.10 | 0.39 |
| 0.20 | 0.13 | 0.37 |
| 0.25 | 0.15 | 0.33 |
| 0.30 | 0.17 | 0.31 |
| 0.35 | 0.19 | 0.29 |
| 0.40 | 0.22 | 0.28 |
| 0.44 | 0.24 | 0.28 |
| 0.47 | 0.26 | 0.29 |
| 0.49 | 0.28 | 0.30 |
| 0.50 (tip) | 0.29 | 0.30 |

**Greybox (milestone 2)**

Purpose: prove the four rules are fun and readable on a phone before anything else is built. It renders through the look spike's pipeline, so nothing gets thrown away.

In scope:

- A circular arena with a reef ring, and four static plankton blooms that draw wild mantas.
- Wild mantas spread evenly across the ocean in small groups on a lattice, drawn gently towards plankton blooms and regrowing slowly away from leaders to their count. Crash and cut debris is separate from that count: it glows and can be collected, then sinks away, so crashes can neither empty nor flood the ocean. Under a crash every half second for a minute, the wild count held at 19 to 20 of 20, where counting debris against it had collapsed it to about 4.
- Your leader and train, with recruiting, crashing, bursting, cutting and scattering, using the (P) defaults in 6.3.
- Rival leader bots using the simple brain below.
- A camera that follows your leader and zooms out as your train grows.
- A text leaderboard (top ten, bots tagged) plus your current and peak length.
- Touch and keyboard controls, with a switch between the touch schemes under test.
- A debug panel: live parameter sliders, frames per second, counts, slow motion, pause and the current seed.

Out of scope: final art, audio, identity features, the pink manta, events, the full crash card (the greybox shows only the death beat and your run's peak), the daily ocean, challenge links, clips, saved bests and site integration.

Prototype look (all drawn in code, no image files):

- The look spike's ocean: the moonlit seabed and its moving light, marine snow at three depths and ambient plankton.
- The spike's mantas: the measured outline, bright colours, markings and wingbeat, as one instanced mesh with each follower's phase behind the one ahead, so trains ripple. Leaders are larger. Wild mantas' size is a tuning value, 28 today and the same as a follower by Nathan's choice, and train size can scale trains up if they need to read apart; colour, formation and trails tell food from trains.
- Glow from the look spike's light memory and bloom pass, not per-object effects.
- Colour and brightness tell the story: your train brightest, each rival its own hue, wild mantas in their own bright colours, scattered mantas glowing in their old train's colour until their own returns.
- The spike's wake behind every moving manta, in its train's colour and brighter while bursting.
- Juice on the big moments: a flash and particle burst where a cut lands, a brief slow-motion beat on big cuts, and a small screen shake when you crash.
- The reef as a glowing ring with a slow pulse, and plankton blooms as denser, brighter plankton sparkle, never as clouds or round shapes.
- A debug toggle that switches to flat shapes, to separate rendering cost from simulation cost.

Starting parameters. These are guesses to tune on the phone. Units are world units, and at zoom 1 every screen sees the same area of ocean, about what a 390 by 844 phone sees, fitted to the screen's shape. A laptop therefore never sees more ocean than a phone, challenge scores stay comparable across devices, and the light memory texture covers the same patch of water everywhere.

| Parameter | Start | Notes |
|---|---|---|
| Arena radius | 2,000 (P) | Reef ring; retuned on the Pixel 9 in September 2026, taking effect from the next restart |
| Cruise speed | 200 per second | Never zero; tuned on the Pixel 9 |
| Burst speed | 470 per second (P) | Retuned on the Pixel 9 |
| Turn rate | 5.2 rad/s cruising, 4.1 rad/s bursting (P) | A burst carves a much wider circle, about 115 units against 38 |
| Leader radius | 14 | |
| Follower radius | 10 | |
| Follower spacing | 19 | Along the leader's path, by arc length: as close as real chain-feeding mantas swim, and a continuous wall for coiling |
| Recruit radius | 30 (P) | Measured from the leader; retuned on the Pixel 9 |
| Burst cost | 1 follower every 1.0 seconds | Taken from the tail. Tuned on the Pixel 9. In bot matches at 0.35, bots that never burst took first place about 60 percent of the time; at 1.0, never bursting and bursting took it 47 and 45 percent |
| Scatter glow | 10 seconds | Collectable while it glows, then it sinks away |
| Death beat | 1.5 seconds | Then you start again |
| Restart distance | At least 800 | From the crash, clear of every train |
| Wild mantas | 300 (P) | In groups of 3 to 5 on an even lattice, regrowing one every 0.5 seconds up to the count, away from leaders. Crash debris is counted separately and never stops regrowth. Until September 2026 every lab game started with 120 by mistake, whatever the setting, so earlier tuning of this value is void; Nathan's retune, with the smaller arena, makes the ocean roughly 60 times denser than 20 in radius 4,000 |
| Wild wingspan | 28 | The same as a follower, Nathan's choice; leaders are 40 |
| Train size | 1.0 | Scales leaders and followers, visuals and collision alike |
| Bloom pull | 0.36 | How strongly plankton blooms draw wild mantas, each bloom holding only a handful |
| Bot leaders | 10 | One brain with greed, caution and aggression dials, dealt as greedy, timid and bully presets |
| Plankton blooms | 4 | Static in the greybox |
| Camera zoom | 1.0 at length 0, easing to 0.55 at length 300 | |
| Simulation rate | 60 fixed steps per second | Separate from rendering |

Bot brain (one brain, three dials):

- Every half second, pick a goal: the nearest reachable group of wild mantas, or a plankton bloom if none are close.
- Steer towards the goal while avoiding the reef and any train segment ahead.
- Burst to cut when a rival train crosses close ahead and the bot has enough followers to pay.
- Give way to any leader closing ahead. Most bot crashes were two leaders meeting at the same food, and giving way cut crashes per bot per five minutes from about 13 to between 0.7 (timid) and 5.3 (bully).
- Never pick food beyond its own turn-back line from the reef.
- Each bot has three dials: greed (how far it chases wild mantas), caution (how early it avoids trains) and aggression (how often it bursts to cut). The greedy, timid and bully personalities are presets of these dials.

Touch schemes to compare:

- **A:** steer towards your finger (the direction from your leader to the touch point); double-tap and hold to burst.
- **B:** steer towards your first finger; hold a second finger anywhere to burst.
- **C:** a floating joystick on one side and a burst button on the other.

Keyboard: left and right (or A and D) to turn, space or up to burst. Mouse: steer towards the cursor, hold a button to burst.

Implementation notes:

- Keep a ring buffer of the leader's recent positions; follower n sits n times the spacing back along that path, measured along the path's arc length rather than its parameter, or trains stretch on bends (the spike found gaps growing from 31 to 103).
- Every manta steers its heading and then moves along it. Never write a position as a function of time, or mantas crab sideways (the spike found 79.5 degrees off the nose after two minutes).
- Set pieces run on a real clock, not the simulation's clamped delta, or they stall on slow devices; what moves inside them, like the scatter, still moves in scene time.
- Put every leader and follower circle into a uniform spatial hash grid each step, so each leader only checks nearby cells.
- Every simulated manta is drawn, and nothing solid is ever undrawn: the instance pool grows when trains outgrow their reserved slots. Long bot tails were once solid but invisible.
- The simulation records each crash and each cut once, where it happened, and a set piece fires only if it is on screen. Events off screen spend none of the page-wide flash allowance.
- Use a seeded random generator for everything from day one (layout, spawns, bot dials), so the daily ocean and challenge links need no refactor.
- Run the simulation on a fixed timestep, separate from rendering.
- Keep the simulation a plain module with no rendering imports, so tests can step it thousands of times a second in Node. The spike's headless browser draws at one or two frames a second, too slow to sample anything shorter than a frame, which is also why every set piece takes an injectable clock.
- Every train's followers use the arc-length rule, not only yours. A leader crossing the world edge must not empty its recorded path, and spacing is measured from where the leader is, not from its last recorded point; the spike's rival trains closed to a point and ran 1.5 units long before those fixes.
- The spike kept its camera still, so its light memory, shadow target and seabed parallax were locked to the world. The greybox's first rendering job is scrolling all three with a moving, zooming camera, and checking the wake still reads at zoom 0.55.
- Colour ownership has one writer for each per-instance attribute. A wild manta takes its train's colour from the head out when it joins; scattered and severed mantas glow in the old colour, then fade to their own over about four seconds.
- Render with Three.js's WebGPURenderer and TSL (automatic WebGL2 fallback), drawing all mantas as one instanced mesh and pooling everything, and hold a steady 60 fps on Nathan's phone at the starting parameters.
- Follow the existing SnapHit cabinet conventions for file layout, input focus and pausing (confirm from the repo first; see 10.4).

### 10.3 Greybox acceptance tests

1. **Readable:** a first-timer told nothing works out recruiting, and that touching trains is bad, within about a minute (watch three people).
2. **The cut lands:** players try deliberate cuts within five minutes, and landing one gets a reaction.
3. **Upsets happen:** in a five-minute session, the top train is cut or crashed by a smaller one at least once.
4. **No dominant strategy:** neither never bursting nor constant bursting reliably tops the board.
5. **Touch works:** after five minutes, players land a deliberate cut on a phone about one attempt in three.
6. **Coiling works:** a player can deliberately trap a smaller leader with their train.
7. **Smooth:** a steady 60 fps on Nathan's phone, on WebGPU and on the fallback.

If tests 1 to 3 still fail after tuning, rethink the rules before any art.

Measured in the simulation, bots only, over 50 to 100 seeds of five minutes (September 2026): test 3, an upset in every seed, about eight per five minutes; test 4, see the burst cost row in 10.2; test 6, a train at spacing 19 leaves no gap a leader can pass, and all 72 escape headings crash. Tests 1, 2, 5 and 7 need people and phones.

### 10.4 Before the first Claude Code brief

- Confirm how existing cabinet games are structured in SnapHit/SnapHit_Online: single file or folder, shared components, how cabinets embed a game, how keyboard focus and pausing are handled, and whether there's a build step (Brief 0).
- Dev-only path: decided, /lab/manta/ (section 9).
- Confirm on-device storage is acceptable under CLAUDE.md (Brief 0; needed from milestone 6).
- Pin a Three.js release: decided, r186. Brief 0 copies its WebGPU build and TSL addons into the repo. The API changes between releases (by r186, PostProcessing has been renamed RenderPipeline), so every brief requires checking Three.js and TSL names against the vendored files rather than memory or online examples.
- Commit this doc to the repo outside the served folder, so briefs can point at it instead of pasting it (Brief 0).
- Add a bare diagnostics page at /lab/manta/ that reports the active backend, frame rate and time to first frame, and can force the fallback; the look spike grows out of it (Brief 0).
- Done: Brief 0 committed this doc, Three.js r186 and the lab page; Brief 0.1 added the automatic fallback, honest cold and warm load reporting and a measured refresh rate.
- Write each brief as one full copyable prompt block, using sections 6, 7.2 and 10.2 as the spec and 10.3 as the checklist.

### 10.5 Build approach

- Claude Code builds in the repo, so the prototype lives where the game will live, with history to roll back and a real URL to test on the phone.
- The architect and reviewer role moves to a fresh chat in the SnapHit project, with this doc in project knowledge as the source of truth.
- Models: Opus 5 by default for both. Anthropic's docs recommend starting with Opus 5 and moving to Fable 5.1 for demanding long-horizon work, or when Opus at higher effort falls short. Keep Fable for a problem Opus fails to fix twice, a performance pass or a polish pass. Fable costs twice Opus's API price; on Pro it runs on usage credits from the first message, on Max it's included up to half the weekly limit, and it needs Claude Code 2.1.255 or later.
- Sequence: brief 0 is read-only recon of the cabinet conventions, then committing this doc, Three.js r186 and the diagnostics page, each as its own verified commit; brief 1 is the look spike; brief 2A is the greybox's world, recruiting and rules, played against the spike's scripted rival trains; brief 2B adds bots, the leaderboard, the other touch schemes and a gameplay debug panel. The look and the tuning drawer carry over from the spike, and each stage is verified before committing.
- Tuning happens on the phone with the debug sliders; small briefs lock values in.
- One source of truth: this doc lives in project knowledge and in the repo, outside the served folder. Each new version is uploaded by hand to both, and the next brief gives Claude Code the hash to check the repo copy against, so the two can never drift.
- Nathan sends screenshots and screen recordings to the architect chat, which turns what looks off into the next brief.

### 10.6 Milestone 3: live rooms spec

Decided in September 2026: live rooms come before the human playtests. (P) marks a default to confirm in testing.

Shape:

- A room is one ocean as tuned: arena radius 4000, 20 wild mantas and 11 mantas in all. (P) Each person who joins replaces a bot, and bots refill the room as people leave, so a room is never empty or overfull. A full room opens another.
- Opening the page joins the public room. A private room has its own link.
- Solo play, the game against bots on the phone alone, stays one tap away. It is the fallback when the server is down, and the comparison that separates rule problems from network ones in feedback.
- Names are generated, never typed, so there is nothing to moderate.

Server:

- One Cloudflare Worker, for rooms only, with one Durable Object per room.
- The room runs the existing simulation unchanged, as the referee: bots, recruiting, crashes, cuts and bursts are all decided there.
- Phones send only what the player does, steering and burst, and only when it changes, up to 20 times a second (P).
- The room sends every phone a snapshot 20 times a second (P): each leader's position and its new path points, train lengths, and events (recruits, crashes, cuts, wild mantas appearing and sinking). Followers are rebuilt on each phone from the same path points, so every phone draws each train where the server has it.
- A room with no people in it shuts down and costs nothing while idle.
- The room imports the lab's simulation modules directly, so solo and rooms share one set of rules. Cloudflare's maths differs from Node's in the last bit (sine, cosine and a few others), so a room's run can't be replayed elsewhere from its seed. Tests compare phones against the server's snapshots, never against a separate re-run.
- Phones and the room run the same build: a phone on an older build is told to reload.
- Every push to main redeploys the room and disconnects everyone in it, so there are no pushes during a playtest.

On the phone:

- Your own leader moves the instant you steer (prediction), and eases back to the server's position when they differ.
- Rival leaders are drawn a fraction of a second in the past, smoothly between snapshots (interpolation).
- Crashes and cuts happen when the server says, and the set pieces play from its events.
- Cuts are judged where the server has the trains, with lag compensation: the server judges your leader against rival trains where your phone showed them when you steered. Measured on the Pixel 9 over 4G in September 2026, a round trip to Cloudflare's edge took 318 ms at the median and 377 ms at the 95th percentile. At a burst speed of 470 that is about 150 units of disagreement, several follower gaps, so without it a cut that looked clean on the phone would miss.

Tuning:

- Look settings stay on each phone.
- Gameplay settings belong to the room, because a shared ocean needs one set of rules. Public rooms run Nathan's values, which he changes live with an admin key. A private room's creator tunes it for everyone in it, which keeps tuning in the feedback loop.

Dropped connections: (P) when a phone drops, a bot holds its manta for 15 seconds, labelled as a bot. Reconnect in time and it's yours again.

Cost: Cloudflare's free plan covers development, where one room busy all day uses about 10,800 of its 13,000 GB-seconds a day. Before the public feedback release, move to Workers Paid (a US$5 a month minimum) with a usage alert.

Privacy: a one-paragraph note on the page saying the room server sees your connection and what your manta does, and the game keeps none of it after the room closes.

Acceptance:

- Fake players in Node fill rooms, join, leave and drop, and every phone's trains match the server's.
- Round trips from the Pixel 9 are measured on wifi and on mobile data, and your own leader never visibly jumps.
- Nathan and at least two others share a room, some on mobile data. A deliberate cut lands and feels fair to both players.
- Solo play works with the server switched off.

Build order, about six to ten sessions: the server skeleton, live in two steps (first a plain Worker that echoes, which a revert can still remove, proving the site's routing in production; then the Durable Object rooms); the room runs the simulation and phones watch it; phones play, with prediction and smoothing; rooms fill, empty and reconnect, with private rooms and the admin key; then a tester build with a clean playtest mode and session stats, tested by several people at once.

## 11. Risks and mitigations

- **It reads as slither with mantas.** Individual wingbeats, instant break-up on cuts and crashes, the glow, and the cut as the signature move; the pitch and name lead with herding, not steering.
- **Bots feel lifeless.** Distinct personalities, real manta behaviours, events that reshape the ocean, and honest bot tags.
- **The burst-cut unbalances play.** Burst cost and speeds are tunable, and the greybox tests for a dominant strategy.
- **Touch steering is too imprecise for deliberate cuts.** Compare control schemes in the greybox before committing.
- **Crash self-recovery.** You start again at least 800 units away, so you can never swim back and collect your own scattered train.
- **Snowballing.** Only leaders recruit, big trains are big targets, plankton blooms and events redistribute mantas, and wild mantas regrow slowly, so a train can only grow as fast as the ocean refills. The first greybox build held 300 wild mantas by respawning each one instantly, and trains grew to ridiculous lengths within minutes.
- **Performance on mid-range phones.** Spatial hashing, object pooling and capped counts.
- **No real humans online.** Live rooms kept full by bots that people replace, plus challenge links, the daily ocean and clips.
- **Lag makes cuts feel unfair.** The server judges every cut from one shared ocean, your own leader is predicted, rivals are smoothed, and lag compensation corrects for the round trip, measured at over 300 ms on mobile data (10.6).
- **Feedback mixes the rules with the network.** Solo play stays one tap away in the tester build, so a complaint that holds in solo is about the rules.
- **Challenge links replaying differently.** Browsers' maths can differ in the last bit, as Cloudflare's does from Node's, so a seed rebuilds the same ocean but play can drift apart on another device. Decide before the identity layer whether challenge links need maths that matches everywhere.
- **A broken Worker stops the whole site updating.** Every commit that touches the Worker passes a dry run of the deploy first, and a failed deploy leaves the last good version live.
- **Server costs or outages.** Rooms shut down when empty, a usage alert watches the bill, and solo play works with the server off.
- **Canvas recording bugs on Apple devices.** Feature-detect, hide the clip button where it fails, and build it last.
- **A weak name.** Pick a one-word name that says the verb before launch.
- **WebGPU coverage and fallback quality.** Design the signature look for the WebGL2 fallback, keep a toggle that forces it, and test both at every milestone.
- **Three.js's WebGPU renderer is labelled experimental, and TSL changes between releases.** Pin a release, copy it into the repo, and give Claude Code the matching docs.
- **Library weight against "Instant. Play."** Measured on the Pixel 9: 732 KB over the wire, 3.7 MB decoded, and the whole library costs about 140 to 170 ms of a 480 ms first frame. Decided: don't minify and don't trim. Minifying needs a build step and trimming means editing the vendored library, and both are invariants to spend on a small prize. The ocean paints in CSS before Three.js loads instead, so the screen is never blank.
- **Shader bugs on particular phone GPUs.** Test on at least one iPhone and one cheap Android.
- **Glow soup.** The brightness hierarchy is non-negotiable: if a screenshot looks spectacular but you can't find your train, it's wrong. It is measured by the four conditions in 7.2 at every stage and every quality tier.
- **Moonlight competing with life.** Caustics that move everywhere could bury the information the light carries. They are capped below the dimmest manta, measured with the hierarchy at every stage, and stepped down by the quality tiers.
- **Wild mantas and rival trains look alike.** With every manta bright, and wild mantas now the same size as followers, brightness and size no longer tell food from walls; formation, trails and colour have to. The greybox's first acceptance test checks it, and the levers if it fails are a stronger glow on train members or paler wild colours.
- **Finding your own train.** With a random colour and every manta bright, your train is found by the camera centring on it, its hotter glow and brightest trail, and a colour no one else wears that run. Slither shows centring works; the greybox's first acceptance test confirms it here.
- **Cold shader compiles on WebGL2.** On a cold load the Pixel 9's first WebGL2 draw took 991 ms, against about 165 ms warm, because every shader compiles before the first frame, and each shader the ocean adds, adds to it. It reached 1,358 ms on the first load of the ten-bot build. The CSS ocean covers the wait; measure it on the cheap Android, and compile the shaders ahead of the first frame before launch.
- **Photosensitivity.** Cap flashes and offer a reduced-flash setting.
- **Offensive names in links.** Names only reach people a player chose to send them to, and crew emblems are abstract.
- **Country flags and politics.** A curated list, with disputed territories handled deliberately rather than by accident.
- **Friends' mantas feeling creepy.** Only mantas whose owners chose to send them ever appear.
- **Lost progress.** The passport survives cleared storage and device changes.

## 12. Open decisions

1. The game's name (working title: Manta trains).
2. The pink manta's name and value.
3. The touch control scheme: A, B and C are built; choose after the human playtests.
4. Every (P) default in section 6.3.
5. Event frequency and the whale shark's exact behaviour.
6. Clip length and video format.
7. Where the game sits on snap-hit.online.
8. Live rooms: decided in September 2026, built before the human playtests (10.6). Still open: its (P) defaults.
9. Whether to add cyclone netting after launch (section 13).
10. The six archetypes and how each is computed.
11. The secret names list and what each unlocks.
12. The marks list and each feat's threshold.
13. Crew tag syntax and how emblems are generated from tags.
14. The country list, including disputed territories.
15. What a manta link carries, and its length limit.
16. How many visiting mantas one ocean holds, and how the pod is managed.
17. The final palette: the spike's tuned values are in 10.2, every manta's colour comes from lime, orange, scarlet, violet, purple, azure and green, and the final set is tuned in the greybox.
18. Whether 120 Hz is worth chasing on adaptive displays, and what that would cost.
19. Whether your manta's colour is rolled every run, as in slither, or rolled once on its first swim and kept with its identity (7.3), so friends recognise it in their ocean.

## 13. Parked and rejected ideas

Rejected for this game:

- **Seagulls:** a crowded theme, and a top-down camera loses the comedy.
- **Eat-smaller cores:** saturated by clones, and mantas don't eat mantas.
- **The solo loop:** not true manta behaviour, Paper.io's rule underneath, and it pushes players towards timid play.
- **Ads:** they'd break zero external requests, and they were slither's most criticised feature.
- **A skin menu:** replaced by name-generated patterns.
- **A death screen:** replaced by the crash card.
- **Canvas 2D:** fine for half decent, but it can't reach stunning.
- **A custom WebGL2 renderer:** lean and universal, but no WebGPU path without a rewrite.
- **A custom WebGPU renderer with a hand-written WebGL2 fallback:** every shader written twice.
- **WebGPU only:** excludes too many phones.
- **School identity:** a child-safety line; the game never asks a player for a school.
- **Home reefs as factions:** charming, but nobody grew up supporting Hanifaru, and choosing one needs a menu.
- **A morph menu:** fails zero setup; morphs come from names instead.

Parked, for later modes or future games:

- **Cyclone netting:** closing your train on itself nets every wild manta inside it, which is how real cyclones start (the front of the chain catches its tail). It adds a rule, so it has to earn its place.
- **Lure the orca:** no manta can hurt another; an orca hunts the brightest light, fast swimming lights you up, and you lead it into rivals.
- **The cyclone commons:** mantas circling together spin up a cyclone that feeds everyone in it until, past a tipping point, it collapses into a free-for-all.
- **One hot chip:** seagull keep-away where the prize grows the longer one gull holds it (chip, burger, snapper, esky) and slows the holder down.
- **Spot the human:** each player is one gull in a flock of identical bot gulls; act natural, find your rival and peck them first.
- **Emoji names:** little clip value for the cost.
- **Creator skins:** they need partnerships, and crews already do the job.
- **A conservation tie-in:** no way to spread, and easy to overclaim.
- **Compute-driven living water:** plankton particles, fish schools and currents on WebGPU devices, after launch.

## 14. Glossary

- **Leader:** the manta you steer.
- **Follower:** a manta in a train behind its leader.
- **Train:** a leader plus its followers.
- **Wild manta:** a manta in no train. It wears its own bright colour until it joins a train and takes the train's.
- **Scattered manta:** a wild manta just released by a crash or cut; it glows and joins the first leader to touch it.
- **Recruit:** a wild manta joining your train.
- **Crash:** your leader touches another train or the reef; your whole train scatters, your run ends, and you start again elsewhere.
- **Death beat:** the second and a half after a crash when your train bursts into light, the camera pulls back and your run's peak shows, before you start again.
- **Burst:** holding to speed up, paid for with followers.
- **Cut:** bursting through another train, which sends everything behind the contact point wild.
- **Run (P):** from starting alone to your next crash.
- **Peak length:** the highest length in a run, and that run's score.
- **Reef:** the arena's deadly boundary.
- **Plankton bloom:** a patch of dense plankton that draws wild mantas. Briefs always say plankton bloom for this, because bloom alone means the renderer's glow.
- **Daily ocean:** the seeded ocean everyone shares each day.
- **Challenge link:** a link carrying a seed and a score to beat.
- **Crash card:** the small card after a crash showing your peak, your best, a clip button, a challenge link and a way to your manta card, while play continues.
- **Look spike:** the one-screen visual test that proves the look and frame rate before any gameplay.
- **Wake:** the glowing trail a moving manta leaves in the light memory, carried mostly by sparkle.
- **Sparkle:** the plankton's glittering crests, visible only where the water has been stirred.
- **Bloom:** the renderer's soft glow around anything bright on screen. It is untinted, so it takes each source's own colour.
- **Caustics:** the moving web of light that moonlight refracted through the waves lays on the seabed.
- **Marine snow:** faint specks drifting at three depths that give the water volume and scale.
- **Light memory:** a low-resolution texture that remembers recent movement and lights the plankton. It is locked to the world, so the look spike keeps its camera still and scrolling it with a moving camera is the greybox's problem.
- **Fallback:** the WebGL2 backend Three.js switches to when WebGPU isn't available.
- **Lab page:** the prototype's standalone page at /lab/manta/, unlinked and marked noindex; it starts as a diagnostics page and grows into the look spike.
- **Catalogue number:** a manta's ID number, like a researcher's photo-ID entry.
- **Morph:** a manta's colour form, generated from its name.
- **Victory roll:** the barrel roll after a big cut that flashes the manta's belly pattern.
- **Tag:** a word in brackets in a manta's name that sets its crew emblem.
- **Crew:** players sharing a tag, and so an emblem.
- **Emblem:** the abstract crew symbol generated from a tag.
- **Secret name:** a curated word that unlocks a rare look.
- **Mark:** a permanent feature earned by a feat.
- **Archetype:** a playstyle type computed from runs.
- **Visiting manta:** a friend's manta carried in by their link and driven by a bot tuned to their style.
- **Pod:** the list of mantas you've met.
- **Manta card:** the shareable card showing a manta's identity, records and challenge link.
- **Passport:** a private link or QR code holding a whole manta, for restoring or moving it.

## 15. Sources

The .io games:

- Slither.io (Wikipedia): https://en.wikipedia.org/wiki/Slither.io
- Agar.io (Wikipedia): https://en.wikipedia.org/wiki/Agar.io
- Slither.io's 80 million downloads in Q2 2016 (PocketGamer.biz): https://www.pocketgamer.biz/slitherio-achieved-80-million-downloads
- Slither.io as 2016's most Googled game (PocketGamer.biz): https://www.pocketgamer.biz/news/64647/slitherio-most-googled-game-of-2016/
- Google's 2016 trending searches (CNBC): https://www.cnbc.com/2016/12/14/pokemon-go-donald-trump-and-iphone-7-lead-googles-top-global-searches-in-2016.html
- PewDiePie's unprompted slither.io videos (TheGamer): https://www.thegamer.com/slitherio-history-success-guide-strategy/
- Agar.io's single 4chan post (Vice): https://www.vice.com/en/article/a-browser-game-called-agario-got-googled-more-in-2015-than-fallout-4/
- Snake.io's App Store listing: https://apps.apple.com/app/1104692136
- Snake.io's FAQ (Kooapps): https://development.snake.io/faq.php
- Snake.io's install estimates (AppGoblin): https://www.appgoblin.info/apps/com.amelosinteractive.snake
- Snake.io's TikTok case study: https://ads.tiktok.com/business/en-US/inspiration/kooapps-x-snake.io-438

Manta behaviour:

- Chain and cyclone feeding (National Geographic): https://www.nationalgeographic.com/magazine/article/manta-rays
- Chain feeding in the slipstream (Scuba Diver): https://www.scubadivermag.com/?p=53343
- Cyclones as a coordinated group behaviour (Divernet): https://divernet.com/world-dives/perfect-storm-cycloning-manta-rays
- Chaos feeding beyond a hundred mantas (Maldives Traveller): https://maldivestraveller.mv/en/news/maldives-news-beat/manta-ray-and-whale-shark-nique-location
- Manta trains at Hanifaru Bay (Zublu): https://www.zubludiving.com/articles/zublu-insights/hanifaru-bay
- Why mantas can't stop swimming (Manta Ray Advocates): https://mantarayadvocates.com/?p=1756
- The pink manta (National Geographic): https://www.nationalgeographic.com/animals/article/pink-manta-ray-australia-rare
- The pink manta's colouring and photo-ID number (Bundaberg Now): https://www.bundabergnow.com/?p=104689

Market and technology:

- Seagull games on itch.io: https://itch.io/games/tag-seagull
- Beaks, a seagull board game (Foyles): https://www.foyles.co.uk/product/beaks/5061032933631
- Cloudflare Durable Objects: https://www.cloudflare.com/developer-platform/products/durable-objects/
- Canvas captureStream browser support: https://web-platform-dx.github.io/web-features-explorer/features/capture-stream-canvas
- WebKit bug on blank canvas recordings: https://bugs.webkit.org/show_bug.cgi?id=229611

Rendering:

- WebGPU (Wikipedia): https://en.wikipedia.org/wiki/WebGPU
- WebGPU implementation status (gpuweb): https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- WebGPU in all major browsers, with mobile gaps (webgpu.com): https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/
- Three.js WebGPURenderer manual: https://threejs.org/manual/en/webgpurenderer
- The caniuse coverage figure and fallback caveats (BuildMVPFast): https://www.buildmvpfast.com/blog/threejs-webgl-to-webgpu-renderer-migration-2026
- The 95% coverage estimate (Utsubo): https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- flOw (Wikipedia): https://en.wikipedia.org/wiki/Flow_(video_game)
- Three.js r186 release: https://github.com/mrdoob/three.js/releases/tag/r186

Identity:

- Belly spots as fingerprints (Manta Trust): https://www.mantatrust.org/mantabase
- Morphs, photo-ID areas and scarring records (Bird's Head Seascape): https://birdsheadseascape.com/?p=7888
- Taurus and Project Manta's photo-ID (UniSC): https://edit.usc.edu.au/about/structure/schools/school-of-science-technology-and-engineering/project-manta/become-a-citizen-scientist
- Forza Drivatars explained (Forza support): https://support.forza.net/hc/en-us/articles/360005302934-FH3-Drivatars
- Cursing a specific Drivatar (Destructoid review): https://destructoid.com/?p=162253
- Drivatars as "a bit creepy" (ctrl blog): https://o.ctrl.blog/entry/forza-drivatars.html

Tools and models:

- Claude Code cloud environments and network access: https://code.claude.com/docs/en/cloud-environments
- Claude Fable 5.1 overview and model guidance: https://platform.claude.com/docs/en/models/fable-5-1/overview
- Fable models on your plan (Claude Help Center): https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
- Fable pricing (Anthropic): https://www.anthropic.com/claude/fable
- Opus 5 pricing (BenchLM): https://benchlm.ai/anthropic/api-pricing
