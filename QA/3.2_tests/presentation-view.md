# QA — Presentation view

**Phase:** 3.2. Verifies *"presentation view displays [encounter images]
full-screen."* The DM opens a full-screen viewer and pages through an encounter's
images for a projector/screen-share.

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
DM, open **"Test 1"** → **Encounters**, select an encounter with **at least two**
images (from [encounters-editing.md](encounters-editing.md)).

## Steps

- [x] With images present, a **▶ Present (N)** button shows in the Images header.
- [x] Click **Present** → a **full-screen black overlay** opens: first image large
      (fit to screen), encounter title top-left, **`1 / N`** counter top-right.
- [x] A captioned image shows its caption centered beneath it.
- [x] **›** / **→** advances; **‹** / **←** goes back; the counter updates; arrows
      disable at the ends.
- [x] **Esc** (or **✕ Close**) closes the overlay.
- [x] **Single-image** encounter → Present opens, shows the image, **no** prev/next
      arrows.
- [x] **No displayable images** → **no** Present button.

## Pass criteria

The presentation view opens full-screen, shows each image large with its caption,
pages via arrows and the keyboard, closes with Esc/Close, and handles the
single-image and no-image cases cleanly.

## Run log

- **2026-07-15** — PASS. DM (`ejcaldwell06`), "Test 1". Present opens full-screen
  (black), image fit-to-screen with title + `n / N` counter, captions shown; arrow
  + keyboard paging with ends disabled; Esc/Close exits; single-image (no arrows)
  and no-image (no button) cases handled.
