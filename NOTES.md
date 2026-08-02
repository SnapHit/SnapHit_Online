# SnapHit Studios: build notes


## Snaphit Site, First Cut

=======================


## What Is Here


  index.html              the homepage: full-screen game, then the cabinet shelf
  play/snaphit/index.html the hero game, framed by the homepage
  play/hurtle/            Hurtle, folded in and ready
  play/beakdown/          Beakdown, folded in and ready


## What Was Changed In The Game Copies


  Beakdown got the same three edits as Hurtle: /icon.png made relative, and
  its four content page links pointed back at beakdown.fun. Its canonical to
  beakdown.fun was already in place, and it already sets a framed class and
  hides its own chrome, so it needed nothing for the embed. Only index.html
  and icon.png were copied; the sitemap, robots, llms.txt, 404, _redirects
  and the four content pages belong at the root of beakdown.fun.


## What Was Changed In The Hurtle Copy


  Only three things, all in index.html:

    /icon.png            -> icon.png
    /apple-touch-icon.png -> apple-touch-icon.png
      Root-relative paths would have resolved against snap-hit.online.

    /slope-2, /slope-3, /slope-online -> https://hurtle.site/...
      The cluster pages stay on hurtle.site. This copy carries only the game.
      Those links are hidden inside the frame anyway; the rewrite is for
      anyone who opens the path directly.

  The canonical to hurtle.site was already there, which is what stops this
  copy competing in search. Hurtle also already sets a 'framed' class on the
  html element when window.self !== window.top and hides its own footer
  chrome, so it needed nothing for the embed. Verified in place.

  Only index.html and the two icons were copied. sitemap.xml, robots.txt,
  llms.txt, 404.html and the three slope pages belong at the root of
  hurtle.site and were deliberately left out.

  Same-origin is what makes the gyroscope work inside the iframe. A
  cross-origin frame gets no orientation events at all.


## How The Unlock Works


  Clearing all twelve ducks posts a message to the page, which reveals the
  chevron and writes to localStorage so returning visitors are not made to
  earn it twice. Scrolling past 45% of the first screen also unlocks it, so
  nobody is ever walled out, and the shelf is real HTML from the first byte
  so crawlers see it regardless.

  The game now holds on the splash instead of resetting. Tap to play again.


## Why The Chevron Is A Button And Not A Scroll Hint


  On a phone a vertical drag is both "pull back to fire" and "scroll down".
  You cannot have both on the same surface, so dragging inside the game is
  always aiming and the chevron scrolls the page programmatically. Mouse
  wheel, PageDown and arrow keys all work as normal.


## Pacing


  Between the game and the first machine there is a deliberate empty descent,
  just under half a screen, with a thin gradient thread down the middle and a
  glowing dot travelling down it on a 3.6 second loop. A shorter version of
  the same thread sits between machines. The jump straight from the game to a
  cabinet was too abrupt; this gives the eye something to follow and a beat
  to land on. The dot is stilled under prefers-reduced-motion.

  Machines stack in a single column rather than wrapping, so each one gets
  its own moment on the way down. Measured on a 412 phone: 439px of descent
  before the first machine, 256px between machines.

  The NO ADS, NO LAGS tagline is gone from both the welcome splash and the
  footer.


## The Galaxy Loop


  The drift was jerking because the whole background, stars included, was on
  a plate repainted four times a second. Diffuse gas can step invisibly at
  that rate. Sharp points cannot.

  It is now two plates. The sky and gas plate drifts, so it repaints every
  seventh frame when there is headroom. The grid, deck, rails and vignette
  plate is painted once, because the camera never moves; drawing it live
  meant paying for shadow-blurred strokes every frame. The stars are drawn
  between the two, live, every frame. Measured drift is now 0.16 to 0.33px
  per frame, evenly, where it used to jump about three pixels four times a
  second.

  On a device that cannot afford the second composite the stars fold back
  onto the plate, the cadence tightens to every second frame, and the frame
  becomes a single blit again. That switch follows the measured frame rate,
  not the resolution rung, because tying it to the rung made a loop: the cost
  of smoothness pushed the resolution down, which switched smoothness off.

  Two bugs found on the way. drawNebula was leaving the context in additive
  mode, which silently killed the horizon haze and the vignette painted after
  it. And every step of the resolution ladder was rebuilding the sprite cache,
  the galaxy, the arena and the deck wordmark, costing a 130ms hitch, when a
  resolution change moves nothing that depends on CSS geometry.

  The gas itself got a good deal more in it, all of it pre-rendered once and
  therefore free per frame: more clouds and dust lanes, bright star-forming
  knots, fourteen globular clusters, seven far galaxies tilted behind
  everything, filaments traced along the arms, and two more star colours for
  red and yellow giants.


## Typography


  The name is set as SnapHit in every place it appears as text: the welcome
  splash, the footer, the cabinet marquees, the control panel plate and the
  wordmark painted into the deck. All caps was being read as one word and
  mispronounced.

  INSTANT PLAY was closing up because HTML collapses the extra spaces that
  letter-spacing was meant to open. It now uses letter-spacing with
  word-spacing on ordinary text. In the canvas splash, which keeps every
  space it is given, the word gaps went to five and six spaces.


## Sound


  Entirely synthesised: oscillators, filtered noise, saturation and a
  generated reverb. No sample files, no fetch, no external request.

  ON BY DEFAULT, off if you turn it off. A browser will not let anything sound
  before a gesture, so the AudioContext is only created on the first pointer
  event of any kind, which makes the first tap the real switch. The control is
  a labelled pill reading SOUND ON or SOUND OFF that breathes until it has
  been used once, then settles to a quiet icon. Its hit box is written by the
  same code that draws it, so the two cannot drift apart.

  THE FIREWORKS ARE SILENT. They had sound and should not have; the shells
  were the only thing being heard.

  WHY ONLY THE FIREWORKS WERE AUDIBLE. Two separate faults.

  First, the explosion was mixed for headphones. Most of its energy sat in a
  sub falling to 26Hz and a rumble at 62Hz, which a phone speaker cannot move
  air at, while the fireworks sat right in the speaker's best octave. Measured
  by rendering each sound offline and integrating energy per band: the
  explosion had 0.67 units in 400Hz to 4kHz for every 1 unit below 200Hz. It
  now has 1.44, and its energy in the band a handset can reach is four to five
  times that of any other sound.

  Getting there meant more than turning it up. The noise layers used lowpass
  filters, which pass everything beneath them and were dumping energy into the
  sub as a side effect; they are bandpass now. The sub is written as a
  fundamental plus its second and third harmonics, so headphones hear the
  bottom octave and a phone hears the harmonics and infers a fundamental it
  cannot reproduce.

  Second, and worse: EVERY GAME CALL SITE HAD BEEN DELETED. Rewriting the SFX
  object with index based slicing took the wiring with it, so the engine was
  perfect and nothing was calling it. The methods tested fine in isolation,
  which is exactly why it went unnoticed. Re-wired, and the check now counts
  what actually fires through a real finale rather than testing the methods:
  5 explosions, 12 ducks, 6 merges.

  THE EXPLOSION is seven layers on one pan position: a shock front of 26ms, a
  crack sweeping 3000 to 1200Hz, the body through the saturator sweeping 1800
  down to 300, a three-part drop written as a fundamental plus two harmonics,
  scattered debris, and two rumbles.

  THE RUMBLES SWELL RATHER THAN DECAY. One takes 0.24 of its length to reach
  full and runs 1.5 seconds; the second takes 0.50 and runs 1.9. Measured in
  50ms slices, the envelope now hits hard at 50ms, falls, and then holds a
  plateau from 400 to 700ms before a long fade, where before it fell away
  monotonically and was silent by a second.

  AND THE CHAIN ITSELF BUILDS. Each detonation is scaled by how far through
  the queue it is, so a chain of eight runs 0.75, 0.87, 0.99, 1.11, 1.23,
  1.34, 1.46, 1.58, and then the big bang lands at 2.1. The gaps were already
  accelerating; now the size accelerates with them.

  Every explosion is jittered a few per cent in pitch and length and panned at
  random, so twenty of them do not sound like one sample twenty times.

  DEEPER AGAIN on a second pass: the body sweeps 1350 down to 165Hz, the drop
  starts at 132Hz and runs over a second, and the lower of the two rumbles
  centres at 180 falling to 68 across 2.4 seconds. Measured energy 60 to 250Hz
  now leads the 250 to 1200 band, where it used to trail it, and the sound is
  still at a third of its peak level three quarters of a second in.

  RELATIVE LEVELS, rendered offline: explosion 0.57, duck 0.09, merge 0.08,
  rim 0.07, landing 0.06. The explosion is six times anything else, which is
  the point of it.

  FIRING MAKES NO SOUND, by choice. It had a plucked string on it and the
  game is better without one; the sling is a constant action and anything on
  it becomes wallpaper within a minute.

  The string is worth recording even though it is gone, because rebuilding it
  from scratch would be slow. It was Karplus-Strong: a few milliseconds of
  noise into a delay line feeding back through a lowpass damper, which is
  physically what a plucked string is, with pitch as the reciprocal of the
  delay. Three things had to be solved.

    - Feedback swept offline rather than guessed. At 0.99 the loop runs away;
      at 0.96 and 0.94 it grows before it decays, because the damper sweeping
      toward the fundamental keeps lifting the round trip gain. Usable band
      0.845 to 0.897.
    - Feedback applies per round trip, so a single value made a hard pull
      decay faster and come out quieter than a soft one, which is backwards.
      Solve for a constant decay TIME instead: pow(0.0016, 1/(f*dur)).
    - A feedback delay cannot go below one render quantum, about 2.9ms, so
      anything above roughly 340Hz clamps and detunes. 198 to 330Hz is safe.

  A DUCK is a knock followed by a note that climbs a step of a major
  pentatonic for every duck taken inside 1.25 seconds, so a run of them pays
  off and then resets.

  Rim hits and landings are throttled at 90 and 55ms; one scramble produced 42
  rim sounds before that, which is a rattle rather than an effect. Explosions
  are throttled at 40ms, a voice counter refuses anything past 30 in a frame,
  and a compressor on the master bus stops a chain clipping.

  The audio suspends whenever the game parks, whether that is the page
  scrolling it away or the tab going to the background.


## The Studio Card


  After the last machine, in the same materials as the cabinets: navy body,
  cyan inner edge, orange outline and glow, with a raking gloss. A CRT bezel
  on the left with scanlines and a barrel vignette, and on the right the
  studio, positioned as a studio rather than as a channel: an eyebrow, the
  name, a one-line position, the score table, a button out to the build log
  and a maker's credit underneath.

  The table is the point. It states the studio's values as a scoreboard
  rather than a sentence, which keeps the page free of explanation:

     GAMES SHIPPED ........ 04
     IN DEVELOPMENT ....... 01
     ADS SERVED ........... 00
     SIGN-UPS REQUIRED .... 00
     INSTALL SIZE ....... 0 MB

  SUBSCRIBERS came out. It was channel framing, and it was the one figure
  that would go stale. IN DEVELOPMENT replaced it, which says the studio is
  working rather than that the channel is popular.

  DELIBERATELY NOT A YOUTUBE EMBED. A channel iframe is roughly a megabyte
  across dozens of third-party requests, which would undo both optimisation
  passes, and YouTube embeds can serve ads on a page whose splash says the
  opposite. The button links out instead.

  The card is headed by the RENDERED mark, img/studio.jpg, 1200x578 at 164 KB.
  This is the one place on the site that carries it rather than the drawn line
  version, because it is the one place where fidelity is the point. It is the
  only image on the site, it is below the fold and lazy loaded, and it is
  faded into the card at the bottom edge so it sinks in rather than sitting on
  top as a pasted rectangle.

  Everywhere else, including the marquees, footer, 404, favicon, share card
  and both wordmarks inside the game, stays on the drawn line mark.

  The visible name came off, since the mark carries it; an h1-level heading
  is still there for crawlers and screen readers, visually hidden.

  The CRT bezel is gone with it. A monitor showing a face was a person's
  profile. A studio leads with its own mark.

  The footer carries the brand's cyan line variant, drawn as SVG rather than
  keyed out of the brand sheet. The keyed bitmap came to 364 KB for a 52px
  glyph, which is the wrong answer by two orders of magnitude.

  A NOTE ON THE PALETTE. The brand sheet specifies #0A1A2F, #E67E22, #00E5FF
  and #FDFE0D. The site runs slightly hotter: #FF9424 rather than #E67E22 for
  the orange and #37D0F5 rather than #00E5FF for the cyan, because they were
  tuned against a black background where the specified values read muddy. The
  footer glyph uses the exact #00E5FF. Say the word if you want the whole site
  moved onto the sheet values.

  PLACEHOLDERS TO REPLACE:
    - the position line and the GAMES SHIPPED / IN DEVELOPMENT figures
    - the channel URL, currently youtube.com/@GamerNate


## Novlr


  After the studio card, two parchment cards in the dark: Forgery and Escape
  (or die), linking to novlr.com and novlr.com/escape.

  DELIBERATELY NOT IN CABINETS, AND DELIBERATELY NOT EMBEDDED.

  A cabinet is a promise. Everything about it says reflex, noise, sixty
  seconds, tap and go. A serif reading puzzle behind that glass makes the
  machine lie to whoever is looking at it, and they would tap expecting
  Hurtle and get a paragraph of Victorian prose.

  They are also dailies, so one play and then nothing until tomorrow, which
  is a strange thing to sit inside a page you are scrolling. And they are
  reading. Long serif passages in a 268px bezel serve nobody.

  So nothing here borrows the arcade's clothes: paper instead of neon, serif
  instead of Arial Black, a link instead of a button, and a warm glow behind
  them in the void rather than a cyan one. The contrast stops being a problem
  and becomes the argument. Six neon machines and then two quiet cream cards
  says the person has range more convincingly than a sentence would.

  Each card carries a taste of the actual mechanic rather than a description:
  Forgery shows a passage with the MISSING SENTENCE chip and the A to D
  options, Escape shows a room header and two doors. The whole card is the
  link, so the tap target is the card.

  A NOTE ON THE URLS: Forgery points at novlr.com as given. If it has its own
  path the way Escape does, change the href on the first .paper.


## Brand


  The tagline is INSTANT. PLAY. Two sentences, so it reads three ways at
  once: as the phrase instant play, as a description, and as two commands.

  The full stops make it fussy to set. Both CSS letter-spacing and the manual
  spacing used before track after every character, punctuation included,
  which detaches the stop from the word it ends. In the canvas splash the
  lines now use ctx.letterSpacing and ctx.wordSpacing, which track properly
  and keep the stop attached, resetting to zero afterwards so nothing else
  inherits it. There is a manually spaced fallback for anything that lacks
  the API. In the footer each stop is wrapped in an <i> pulled back by
  -0.24em against the tracking.

  Used on the welcome splash, in the footer, in the page title and in the
  meta description.

  The splash reveals in four stages off the big bang: WELCOME TO at 0.45s,
  SNAPHIT at 1.35s settling down from 30 per cent oversized, STUDIOS at
  2.55s, INSTANT PLAY at 3.55s, all in by 4.75s and held. Every line is
  auto-fitted to the screen width and the block clears the deck.


## Layout


  There is no explanatory copy on the page. The cabinet is the argument. An
  h1 is present but visually hidden, so crawlers and screen readers still get
  a sentence describing what the studio does. Each cabinet keeps a small
  heading with the game name and a link out to that game's own site.


## Sizing


  The phone drives the whole cabinet through --pw, and every other dimension
  is a multiple of it. The cabinet is 1.44 phone widths on narrow screens and
  1.62 on wide ones, so the screen is the object and the cabinet is the frame
  around it. On narrow screens the viewport width decides the size; on wide
  ones the height does.

  The phone now takes 69% of the cabinet width on a phone and 62% on a
  desktop. It used to be 44%. Measured:

    412x915    cabinet 386x856, phone 268x581   (was 322x501 / 157x340)
    360x740    cabinet 334x741, phone 232x503
    345x600    cabinet 319x708, phone 222x480   (artefact-sized panel)
    1440x900   cabinet 386x762, phone 239x517
    1920x1080  cabinet 455x897, phone 281x608

  Verified on six viewports: the phone holds 9:19.5 on all of them and the
  cabinet never exceeds the viewport width.


## The Cabinet And The Phone


  Control panel: the studio logo, rebuilt in SVG. Dark slab with a cyan
  grid, a triple-stroked orange glowing edge, and the circuit joystick
  standing on it.

  The joystick is drawn to match the logo rather than approximate it. The
  base is a cylinder: a shadow, a side wall with three orange bands wrapping
  it, a lit face, then eighteen orange traces radiating out, twenty-six cyan
  and amber components placed around the rings, three concentric rings, and
  a four-step hub climbing to the stem. The stem is brass with a specular
  edge and a collar. The orb is a real hex-faceted sphere: fifty-two hexagons
  laid on a hex lattice, each one scaled by its own sphere-z so the facets
  compress toward the rim, each one shaded twice, once by an ember glow
  centred low and once by a specular at the top left, plus a rim light along
  the bottom where the base throws orange back up at it.

  Three buttons alongside, foreshortened as ellipses at 0.73 of their width
  so the panel reads as a surface tilting away. Two player-start pills and a
  SNAPHIT STUDIOS maker's plate, as the logo carries it. Under the panel, a
  coin door with two slots and a return flap.

  The game name below the cabinet was removed. The attract screen already
  says it, and the marquee says who made it.

  MARQUEE: a 4.4 second brightness cycle with a double blink near the peak,
  the way a tube-lit marquee behaves. Disabled under prefers-reduced-motion.

  Phone: a brushed metal rail rather than a flat rounded rectangle, three
  side keys standing slightly proud of it, a dynamic island sitting over the
  display with a camera lens in it, a raking glass reflection across the
  front and a home indicator. The glass and island are pointer-events:none so
  they never intercept a tap, and all of it is hidden while expanded.

  THE REVEAL BUTTON is bottom right, not bottom centre. Centre is where the
  slingshot lives and the two collided.


## Colour


  The cabinet used to be near-black on near-black and barely read as an
  object. It is now a mid navy-blue body with a 2px orange outline and glow,
  a cyan inner edge, orange and cyan decal stripes down both side panels, an
  orange hairline around the screen aperture and an orange leading edge on
  the control deck. All three colours are taken from the logo.

  Three shine layers sit over it: a bright hairline on each front edge where
  a real cabinet catches the light, a broad gloss raking across the left
  face, and a thin highlight along the top. Without these it reads as a flat
  rectangle rather than a box.


## Tap To Expand


  Hurtle has ten sliders. In the cabinet the screen is 157 by 340, which is a
  diagram rather than a game, so each phone has an expand button. It styles
  the phone in place instead of moving it in the DOM, so the iframe is never
  reloaded and a run in progress survives. Escape or the close button returns
  it. The Fullscreen API is deliberately not used: iOS Safari will not honour
  requestFullscreen on an iframe.


## Performance


  A friend reported lag, so this was measured rather than guessed, with
  Chrome CPU throttling standing in for a phone. Two passes.

  The finding: the game is fill bound, not CPU bound. At 4x throttle JS was
  taking about 17ms a frame while the frame itself took 167ms. The rest was
  rasterising a 1.51 megapixel canvas.

  What changed:

  1. BACKGROUND PLATE. Sky, galaxy, grid, dust, deck, rails and vignette are
     painted onto an offscreen plate four times a second and blitted after
     that. About five full-screen fills per frame became one. This was by far
     the biggest win, and I nearly shipped without it: the first attempt
     patched against a line that had been deleted three revisions earlier and
     failed silently. The test caught it.

  2. ADAPTIVE RESOLUTION. The backing store walks a ladder of 2 / 1.6 / 1.3 /
     1.05 / 0.85 based on measured frame rate, dropping below 34fps and
     climbing back above 52. A fast device holds the top rung. The frame rate
     watchdog now measures wall time, not the clamped delta, which was
     overstating the rate on exactly the devices that needed help.

  3. NO BACKDROP-FILTER. The reveal button sat on top of a 60fps canvas with
     a 6px backdrop blur, forcing the compositor to re-blur every frame.

  4. THE DESCENT DOT ANIMATED top, which runs layout every frame forever. Now
     a composited transform.

  5. THE MARQUEE animated filter: brightness, which repaints. Now opacity on
     a blend-mode overlay.

  6. Star count roughly halved on small screens, particle ceiling halved,
     per-particle fillStyle and globalAlpha writes batched, score-pop font
     string cached, full-screen finale wash skipped at low quality, and the
     game stops entirely when the tab is hidden.

  Measured, 412x915 at DPR 2, hero game with words on the deck:

     CPU throttle    before        after
     1x (desktop)      -           57-60 fps at full resolution
     2x (good phone)   -           43-46 fps at full resolution
     4x (weak phone)   5-8 fps     32-40 fps
     first paint     644 ms        380 ms
     dom ready      1716 ms        771 ms

  Transfer sizes, gzipped, which is what Cloudflare serves:

     index.html               11 KB
     play/snaphit/            29 KB
     play/hurtle/             62 KB
     play/beakdown/           19 KB

  The unused icon files were dropped from both game copies. Nothing links to
  those paths, so they were never fetched, but they were 98 KB of deploy.

  The source is not minified on purpose. Gzip already takes the game from
  95 KB to 29 KB, and minifying would cost the readability this project runs
  on for a few KB more.


  Nothing in the shelf loads until it is tapped. Each cabinet shows an
  attract card until then. An IntersectionObserver strips the src off any
  game that scrolls out of view and puts the attract card back, and the hero
  game is told to park itself when it leaves the screen and to wake on
  return. Verified: hero running=false after scrolling down, true on return.


## Adding The Next Game


  One entry in the GAMES array near the bottom of index.html:

      { slug:'beakdown', name:'Beakdown',
        tagline:'...', src:'play/beakdown/', site:'https://beakdown.fun' }

  Everything else builds itself. Copy the game's public folder to
  play/<slug>/ and add the canonical tag as above.


## The Wordmark Is Drawn, Not Set


  It is not type any more. The letter outlines are extracted from Poppins
  Medium and every overlapping piece inside each glyph is merged before
  anything is drawn, so a stroke can only ever trace the silhouette.

  WHY THAT MATTERED. A font glyph is often built from overlapping pieces: a
  capital T is a crossbar rectangle and a stem rectangle laid over each other.
  Filled, they merge and you see a clean T. Stroked, you see both rectangles,
  which puts a line under the crossbar and a line across the stem and boxes in
  the junction. Four attempts went into tuning the stroke, the glow, the
  tracking and the size, and none of them could have worked, because the seam
  was in the letterform rather than in the line.

  Proved rather than asserted: walk a vertical line down the centre of the T's
  stem and count how many times it crosses ink. A clean T crosses exactly
  twice, the top of the crossbar and the foot. Measured 2 on the studio card,
  2 on the splash and 2 on the share card.

  SNAPHIT, all caps, Poppins Medium, .10em tracking, 1018 characters of path
  data. One contour for the T, ten for the whole wordmark, which is seven
  letters plus the counters in A, P and the dot on the I.

  It is defined once as an SVG <symbol> and used three times on the page, once
  more in the 404, and rebuilt as a Path2D in the game for the splash and the
  wordmark painted into the deck. The share card is rendered from the same
  path.

  SIZING. All caps is 6.55 wide for every 1 tall, far wider than the mixed
  case type it replaced, so every instance had to come down. The deck plate
  caught it worst: at the height it inherited, the wordmark was 982px wide
  inside a 900px canvas, clipped at both ends, with its lower edge sitting on
  top of STUDIOS. Its height is now set off the width available rather than
  fixed, at 70% of the plate, giving 630 by 96 in a 900 by 250 canvas with a
  25px gap above STUDIOS. Ink box measured clear of all four edges.

  Elsewhere: splash 66% of the screen width, studio card 78% of its column,
  marquee 54% of its band, footer capped at 212px, share card 560px of 1200.

  THREE OTHER PROBLEMS DIED WITH IT. No font fallback, so your phone and mine
  render the same thing. No synthetic bold. And no dependence on
  -webkit-text-stroke, which would have made the wordmark vanish outright on a
  browser without it.

  Poppins is SIL Open Font Licence, and only the outlines ship, not the font,
  so there is nothing to serve and nothing to license.


## The Mark


  The lockup is the brand: cyan line joystick, SnapHit in orange, STUDIOS,
  INSTANT. PLAY. It now appears wherever the system asks for a mark.

    icon.png (512) and apple-touch-icon.png (180): the glyph alone, on the
    dark field. The strokes are thickened from 2.2 to 3.6 and the glow from 6
    to 9 for the icons only, because at 16px a hairline vanishes. Checked at
    16x16: 62 of 256 pixels still read cyan.

    og.jpg: the whole lockup, centred, on the dark field with a few stars so
    it belongs to the same sky as the site. 1200x630 at 35 KB, and the lockup
    fills 66% of the width and 67% of the height.

    404.html: the same lockup under the code.

    The welcome splash: the glyph now leads the reveal at 0.15s, before
    WELCOME TO, so the whole lockup assembles top to bottom over about five
    seconds. It is drawn in canvas from the same geometry as the SVG.

  ADDING THE GLYPH MEANT RELAYING THE SPLASH. It used to anchor the wordmark
  to the middle of the void and hang the other lines off it, which had no way
  to know whether the block fitted. It now measures the whole block, and
  because everything except the wordmark is viewport derived, the height
  solves in one step: the wordmark shrinks until the lockup fits rather than
  overflowing. Checked on four viewports, including an 844x390 landscape
  phone where the void is only 159px tall and the wordmark comes down to
  41px. All four fit above and below.

  THE LINE MARK IS NOW THE ONLY LOGO ON THE SITE. Studio card, footer,
  favicon, apple touch icon, share card, 404 and the welcome splash all carry
  the same drawing. The rendered artwork is still the right thing for a press
  kit or a store listing, where it can be large; on the page it was the one
  place carrying a different logo from everywhere else.

  The joysticks inside the scenes are untouched: the one on each cabinet's
  control panel and the one standing in the middle of the arena. Those are
  props, not marks, and flattening them to outlines would cost the depth the
  cabinets rely on. Say the word if you want them wireframed too.


## Launch Hygiene, Added Last


  og.jpg and the icons are described under THE WORDMARK IS HOLLOW

  SnapHit is drawn as a neon tube with nothing inside it, matching the sign on
  the brand sheet. Everywhere it appears at display size: the welcome splash,
  the wordmark painted into the deck, the studio card, every cabinet marquee,
  the footer, the 404 and the share card.

  On the page it is one rule. color:transparent with -webkit-text-stroke for
  the tube, and drop-shadow rather than text-shadow for the glow, because
  drop-shadow works off what was actually painted while text-shadow works off
  the solid glyph and would fill the middle of every letter back in.

  In canvas it took two goes. The first attempt kept the old 44px shadowBlur,
  and since canvas shadow spreads inwards as well as out, it closed a ten
  pixel counter completely: one lit run measured across the whole wordmark,
  which is a solid slab.

  The second attempt was hollow but wrong in a different way. It stroked the
  same path three times at three widths, so a bright narrow line sat inside a
  wider dim one, and what you saw was three parallel lines rather than one
  tube. EVERY PASS NOW SHARES ONE LINE WIDTH. Same path, same width, only the
  blur and the alpha change. Measured by band uniformity, which is the number
  that catches this: widest band over median band was about ten to one before,
  and is 1.8 on the splash, 2.0 on the studio card and 1.8 on the share card.
  A single clean outline reads as close to 1.

  The bands themselves came down too, from .05em to .038em on the page and
  from .052em to .036em in canvas, and the two stacked drop-shadows were
  blurring an already blurred copy, which put a faint second ring around the
  tube.

  THEN THE REAL ONE. Arial Black is tightly fitted. Filled, adjacent letters
  read as separate masses even when they nearly touch. Outlined, the right
  edge of one letter sits against the left edge of the next and the pair reads
  as a tangle of crossing lines. That is what was actually wrong, and no
  amount of tuning the stroke was going to fix it.

  Tracking is now .115em on every hollow wordmark: the splash, the deck, the
  studio card, the marquees, the footer, the 404 and the share card. In canvas
  it uses ctx.letterSpacing with the string re-centred by half a trailing
  space, and the width fit measures with the tracking applied so the wordmark
  still shrinks to fit rather than overflowing.

  The bloom had to come down with it, because a glow wider than the tracking
  simply welds the letters back together: outer bloom from .13 to .055 of the
  type size in canvas, and the tight drop-shadow from .055em to .035em on the
  page.

  MAKING THEM ALL AGREE WAS A SEPARATE JOB. The share card was right first
  because it is 96px on a calm dark field. On the page the same rule was
  rendering at 28 to 33px over a starfield, a deck and a sky full of
  confetti, all of which shows straight through hollow letters.

  Two changes. The wordmark grew everywhere so the outline has room: studio
  card from clamp(30,8vw,58) to clamp(40,11vw,80), footer and 404 from 28px
  to clamp(38,9vw,46), marquee from .112 to .150 of a phone width. STUDIOS
  and the tagline came up with them to hold the card's proportions.

  And the splash lockup now sits on a soft radial scrim, faded in with the
  mark, which is the one thing the share card had that the splash did not.

  Audited as rendered rather than as written, because two instances had
  quietly drifted: the marquee was still on a .042em stroke and its own glow
  values, and the canvas was on .036em against the page's .038em. All four
  now report identical tracking (.115em), stroke (.038em), transparent fill
  and glow (.035em and .30em), with only the size differing.

  TWO PLACES STAYED SOLID, both around eleven pixels: the maker's plate on the
  control panel and the STUDIOS line under the wordmark. A hollow letter at
  that size is a smudge. Say the word if you would rather they matched.

  The footer wordmark went from 15px to 28px, because an outline needs room to
  be an outline.

THE MARK above. Until they
  existed, every share of the link was a blank card, and your own Beakdown
  record notes that the first scrape is the one that sticks on WhatsApp,
  Facebook and LinkedIn. twitter:card is summary_large_image so it fills
  rather than thumbnails.

  robots.txt and sitemap.xml, both trivial and both the kind of decision you
  cannot forget to maintain.

  404.html in the same materials, saying no machine at this address.

  STILL YOURS TO DO, ONE TIME:
    - Google Search Console, verified by a DNS TXT record in Cloudflare, so
      no page changes and nothing to remember afterwards. With no analytics
      beacon this is the only source of query and impression data.
    - Look at og.jpg and icon.png before you share the link anywhere. I
      generated them without being able to see them; the numbers say the
      lockup fills two thirds of the card and the glyph still reads at 16px,
      but numbers are not eyes, and the first scrape sticks.


## Deploying


  These files go inside public/ exactly as laid out here. Your existing
  wrangler.jsonc html_handling of auto-trailing-slash serves play/hurtle/
  correctly. Deleting the old public folder rather than extracting over it
  still applies.
