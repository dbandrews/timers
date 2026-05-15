# Toddler Timer

A single-page visual timer designed to help toddlers understand "how much time is left." Each animation is a solid mass that retracts as the timer counts down — easy to read at a glance.

Pick a duration, pick a style, press start.

## Visualizations
- **Big Bar** — horizontal bar shrinks right-to-left
- **Juice Bar** — purple juice drains out of a glass tube with a wavy edge
- **Clock Pie** — a pie chart slice retracts around a clock face
- **Sun Ring** — a donut ring around a smiling sun retracts
- **Rainbow** — seven rainbow rings vanish one-at-a-time, outer-first

## Running locally
No build step. Just serve the folder:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
