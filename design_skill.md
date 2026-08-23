---
name: textured-playful-ui
description: >
  Use this skill when designing or building a UI that should feel warm, hand-made, and
  full of personality rather than clean-corporate or minimal — think saturated color,
  print-grain and risograph texture, organic hand-drawn shapes, and springy, characterful
  motion. Trigger it for landing pages, mobile apps, dashboards, onboarding, empty states,
  and marketing screens where the brief asks for something playful, illustrative, tactile,
  "not another Tailwind template," or explicitly references a motion/illustration aesthetic
  (grainy, riso, textured, bouncy, hand-drawn, whimsical). Works for React/Tailwind, plain
  HTML/CSS, SwiftUI, and design mockups. Do NOT use it when the brief demands strict
  minimalism, dense data tooling, enterprise neutrality, or a system-native look.
---

# Textured & Playful UI

A design methodology for interfaces with the warmth and craft of hand-made
motion-illustration work: saturated palettes, tactile print texture, organic shapes,
and motion that has weight and bounce. The north star is an interface that looks like
a person made it on purpose, with a point of view — not a distribution-mean template.

This skill adapts the sensibility of textured, playful motion-illustration design
(bold color, risograph grain, frame-by-frame liveliness) into interface decisions. It
is about capturing a *spirit* — you invent original assets and palettes; you never trace
or reproduce any specific artist's work.

## The one rule that defines the style

Texture is the signature. A flat, shadow-only interface reads as generic no matter how
good the color is. In this style, surfaces feel *printed*: a fine grain sits over
backgrounds and illustrations, color has slight tooth, and shapes look drawn rather than
extruded. Spend your boldness here and keep everything else disciplined.

## Establish the system first (before any code)

Write a compact token set for the specific brief, then sanity-check it against the
"AI-slop tells" list below. Only build once the tokens feel specific to *this* subject.

- **Palette (4–6 named hex values).** High chroma, warm-leaning, confident. Pick one
  loud hero color, one or two supporting colors, one deep near-black ink for text, and a
  warm ground. Avoid the muted-cream (#F4F1EA) + terracotta (#D97757) combination — it is
  the current default and reads instantly as AI-generated. Push saturation further than
  feels safe: tomato/coral reds, marigold and mustard yellows, deep bottle greens,
  teal, warm clay, hot pink as an accent. Colors can slightly overlap and vibrate.
- **Ink, not black.** Body text is a very dark version of a palette hue (deep green-black,
  warm brown-black), never pure #000. It makes the whole screen feel dyed rather than
  printed on white.
- **Texture pass.** Decide the grain treatment now: a fine noise overlay on the ground
  (low opacity), a heavier grain baked into illustrations, and optionally a halftone-dot
  or duotone treatment on photos. This is non-negotiable for the style.
- **Type (2 roles minimum).** A characterful display face used with restraint + a clean,
  highly legible body face. Add a mono/utility face only if data demands it.
- **Shape language.** Generous rounded radii, organic "blob" forms, wobbly hand-drawn
  dividers and underlines, sticker-like elements with a slight rotation. Not everything
  is a pill; vary the radii intentionally.
- **Signature element.** The single thing the screen is remembered by — usually a custom
  textured hero illustration or an animated character/mascot. Name it explicitly.

## Color

Work with a limited but loud palette. Three to five colors carrying the whole product
feels more crafted than a big tint ramp. Let large flat fields of saturated color do the
heavy lifting; use white/ground space as a deliberate rest, not a default. A single
unexpected accent (electric pink on greens, marigold on teal) is the "one risk" — use it
sparingly so it stays loud. Backgrounds are warm and tinted, never clinical white.

## Texture & grain (the craft layer)

- **Ground grain:** a subtle full-bleed noise over the background (roughly 3–8% opacity).
  In CSS, an inline SVG `feTurbulence` filter or a tiled noise PNG both work; keep it
  fixed so it doesn't scroll and shimmer.
- **Illustration grain:** heavier and baked in, so spot art looks screen-printed.
- **Risograph misregistration:** offset a color layer 1–3px from its outline for the
  "printed slightly off" charm. Use on accents and stickers, not on body text.
- **Halftone / duotone photos:** convert photography to a two-color halftone or duotone
  in the palette so it belongs to the world instead of fighting it.
- **Legibility guardrail:** text always sits on a clean-enough patch. Grain goes *behind*
  and *around* content, never directly under small type where it kills contrast.

## Shape & layout

Organic over rigid. Blob shapes as section backgrounds and image masks, hand-drawn
squiggle dividers, imperfect circles, arrows and underlines that look sketched. Underneath
the playful surface, keep a disciplined grid and an 8pt spacing rhythm — the structure is
what keeps "playful" from tipping into "messy." Cards can tilt a degree or two like
stuck-on stickers; keep interactive targets generous (44pt+). Depth comes from texture,
flat color layering, and offset outlines rather than glossy drop shadows.

## Typography

Pair a display face with genuine personality against a quiet, readable body. Good display
directions: a chunky rounded grotesque, a warm high-contrast display serif, or a slightly
irregular hand-adjacent face. Good body directions: a humanist sans that stays calm at
small sizes. Set a clear scale with bold display weights and comfortable body leading. The
type treatment itself should be memorable — oversized headlines, a hand-drawn underline or
highlight behind a keyword, a word set in the accent color — not a neutral delivery vehicle.
Sentence case, warm tone. One characterful face, used with restraint, beats two competing ones.

## Motion & micro-interactions

Motion should have weight and squash, like frame-by-frame animation.

- **Springy easing with overshoot** on entrances and taps (a spring, or a cubic-bezier
  that overshoots then settles), roughly 300–450ms. Avoid linear or purely ease-in-out —
  it feels lifeless in this style.
- **Squash & stretch** on press: buttons compress slightly and pop back.
- **Staggered entrances:** list items and cards bounce in one after another on load.
- **Ambient "boil":** hero illustrations get a subtle 2–3 frame jitter loop so line art
  feels alive and hand-drawn rather than static.
- **Looping background motion:** slow drifting shapes or a swaying illustrated element for
  atmosphere — quiet, never distracting.
- **Always** honor `prefers-reduced-motion`: drop boil, overshoot, and loops to simple
  fades. The interface must be fully usable and calm with motion off.

## Illustration & iconography

Custom textured spot illustrations are the heart of the style; generic line-icon sets
break the spell. Draw (or commission/generate) a cohesive set in one hand: consistent line
weight, the shared palette, baked-in grain. Give the product a character or mascot with
personality — it can carry empty states, loading, and celebrations. Icons should feel part
of the illustrated family, not imported from a neutral system set.

## Copy & personality

Words are design material. Keep the voice warm, playful, specific, lightly witty — and
still clear. Name things by what the person controls. Treat empty states and errors as
moments for delight and direction, not apology: an empty screen is an invitation to act,
voiced by the product's character. Success states earn a small animated celebration. Never
let charm cost clarity — a label still labels.

## Restraint & self-critique (Chanel's mirror)

Maximalist warmth still needs an editor. Pick one signature (usually the texture or the
mascot) and keep everything around it quiet. Before shipping, remove one accessory. Then
run these gates — every screen should pass:

1. **Texture** — does at least one real texture/grain treatment exist, applied without
   hurting legibility? (If it's flat, it's not this style.)
2. **Color** — 3–5 confident colors, warm tinted ground, one loud accent, ink instead of
   pure black? Not the muted-cream default?
3. **Shape** — organic/hand-drawn elements present, sitting on a disciplined grid?
4. **Type** — one characterful display face doing something memorable, calm readable body?
5. **Motion** — springy with weight, ambient life, and a clean reduced-motion fallback?
6. **Personality** — custom illustration/mascot and voiced copy, including empty states?
7. **Accessibility floor** — contrast holds over texture, targets ≥44pt, keyboard focus
   visible, motion respected.

## Anti-slop tells to avoid

- Muted cream background + terracotta accent + high-contrast serif (the default trio).
- Flat cards with only soft drop shadows and no texture.
- A neutral off-the-shelf line-icon set standing in for real illustration.
- Uniform pill radius on everything; perfectly rigid geometry.
- Linear or timid ease-in-out motion; no weight, no bounce.
- Pure #000 text on pure #FFF.
- Generic hero: big number + small label + gradient blob.

## Quick starter (garden / nature product example)

Palette: deep bottle green ink, marigold hero, warm clay ground, teal support, hot-pink
accent. Signature: a grainy hand-drawn watering-can-and-sprout mascot that "boils" gently
on the home screen and does a squash-and-pop when a plant is watered. Texture: fine grain
over a clay ground; duotone plant photos in green/marigold. Motion: cards of today's
plants bounce in staggered; watering a plant triggers a springy droplet animation.

