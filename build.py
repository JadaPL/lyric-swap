"""Build Lyric Swap into single-file pages.

  python3 build.py

Writes:
  index.html       full page for GitHub Pages (or any static host)
  lyric-swap.html  page body for publishing as a Claude artifact
"""
import base64, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
MODULES = ['extract.js', 'analyze.js', 'doc.js', 'match.js', 'syll.js', 'plan.js', 'render.js', 'scan.js', 'app.js']
CDN = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
    'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
]
FONTS = [('r', '400-normal'), ('i', '400-italic'), ('b', '700-normal'), ('bi', '700-italic')]


def module(name):
    s = open(os.path.join(SRC, name), encoding='utf-8').read()
    return re.sub(r"\nif \(typeof module !== 'undefined'\) module\.exports = \{[^}]*\};\n?", "\n", s)


def main():
    shell = open(os.path.join(SRC, 'shell.html'), encoding='utf-8').read()
    fonts = {k: base64.b64encode(open(os.path.join(ROOT, 'fonts', f'tinos-{v}.ttf'), 'rb').read()).decode() for k, v in FONTS}
    fontjs = ('/* Tinos (SIL Open Font License 1.1, see fonts/LICENSE-Tinos.txt), Latin subset,'
              ' used where the score has no usable font */\nconst TINOS = {'
              + ','.join(f'{k}:"{v}"' for k, v in fonts.items()) + '};\n')
    code = fontjs + '\n'.join(module(m) for m in MODULES)
    scripts = ''.join(f'<script src="{u}"></script>\n' for u in CDN)
    body = shell + '\n' + scripts + '<script>\n"use strict";\n' + code + '\n</script>\n'
    with open(os.path.join(ROOT, 'lyric-swap.html'), 'w', encoding='utf-8') as f:
        f.write(body)
    page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            '<meta name="description" content="Swap new lyrics into sheet music: same score, new words under the same notes.">\n'
            '<style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
            '</head>\n<body>\n' + body + '</body>\n</html>\n')
    with open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)
    print(f'index.html {len(page):,} bytes, lyric-swap.html {len(body):,} bytes')


if __name__ == '__main__':
    main()
