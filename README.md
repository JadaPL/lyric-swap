# Lyric Swap

Swap new lyrics into sheet music. Upload a score (PDF, or a scan/photo) and a
spreadsheet of new lyrics, and get the same score back with the new words
printed under the same notes. Lines that don't fit cleanly (wrong syllable
count, no new words, lyrics missing from the spreadsheet) are flagged so you
can decide what each one should say.

**Use it:** https://jadapl.github.io/lyric-swap/

Everything runs in your browser. Your score and lyrics are not uploaded
anywhere.

## How to use

1. **Upload** the score and the lyrics file (CSV, Excel, Google Sheets export,
   Word, or plain text). The best layout has one column with the original line
   and one with the new line. Pick the columns if they aren't detected.
2. **Review** the lines. Each flagged line shows the original notes and
   syllables. Type the new syllables with hyphens (`won-der-ful`), use `_` to
   hold a syllable over an extra note, and `~` to put two words on one note.
   You can also keep the original words or leave the notes blank.
3. **Preview & download** the new PDF, plus an optional plain-text copy of
   the hyphenated lyrics.

## What works where

| Feature | GitHub Pages | Opened in Claude |
| --- | --- | --- |
| PDFs exported from MuseScore, Finale, Sibelius, Dorico, Noteflight | Yes | Yes |
| Spreadsheets with original and new columns | Yes | Yes |
| Scanned scores and photos (reading the lyrics) | No | Yes |
| Let Claude fit tricky lines or check syllables | No | Yes |
| New lyrics only, without an original column | No | Yes |

## Limits

- The notes can't be re-spaced in a PDF, so new words that are wider than the
  old ones are nudged or printed slightly smaller. The preview step tells you
  where.
- New lyrics are printed in the score's own lyric font when the PDF includes
  it. Missing letters, and scanned pages, use Tinos, a Times-style serif.

## Building

The page is a single HTML file built from `src/`:

```bash
python3 build.py
```

This writes `index.html` (for GitHub Pages) and `lyric-swap.html` (for
publishing as a Claude artifact).

## License

Copyright (c) 2026 JadaPL. All rights reserved. See [LICENSE](LICENSE)
for details and for third-party licenses.
