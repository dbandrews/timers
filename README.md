# Toddler Timer

A single-page visual timer designed to help toddlers understand "how much time is left." Each animation is a solid mass that retracts as the timer counts down — easy to read at a glance.

Pick a duration, pick a style, press start.

## Visualizations
- **Big Bar** — horizontal bar shrinks right-to-left
- **Juice Bar** — purple juice drains out of a glass tube with a wavy edge
- **Clock Pie** — a pie chart slice retracts around a clock face
- **Sun Ring** — a donut ring around a smiling sun retracts
- **Rainbow** — seven rainbow rings vanish one-at-a-time, outer-first

## AI timer designer
The "Make a brand-new friend" panel asks an LLM (OpenAI, `gpt-5.4-mini`) to invent a never-before-seen timer visualization on the spot — optionally around a theme like "dinosaurs". Generated designs appear as new cards, are smoke-tested before they're accepted, and the last 6 are kept in `localStorage`.

It needs an OpenAI API key. Paste it into the **OpenAI API key** box on the page — it's stored only in your browser's `localStorage` and sent only to `api.openai.com`. Do **not** commit a key to this repo: GitHub Pages is public and OpenAI revokes leaked keys. (For a private deployment you can hardcode one in `EMBEDDED_OPENAI_API_KEY` at the top of `ai.js`.)

## Running locally
No build step. Just serve the folder:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
