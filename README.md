# Congyi Nai — personal website

Static site (HTML/CSS/JS, no build step). Files: `index.html`, `style.css`, `globe.js` (hero cubed-sphere globe: wind particles + sliding conv kernels), `main.js`.

## Before publishing
- Optional: add DOI links to the journal papers in the Publications list.

## Preview locally
    python3 -m http.server 8000   # then open http://localhost:8000

## Deploy on GitHub Pages
    git init && git add . && git commit -m "Personal website"
    git branch -M main
    git remote add origin git@github.com:<username>/<username>.github.io.git
    git push -u origin main
Then Settings → Pages → Source: `main` / root. The site goes live at `https://<username>.github.io`.
For a custom domain, add a `CNAME` file containing the domain and point its DNS at GitHub Pages.
