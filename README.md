# gulfislands-astro

## Deployment

CI (`push` to `master` -> `.github/workflows/deploy.yml`) builds and rsyncs `dist/` to both boxes. It sets the Meta
pixel env, so CI deploys are safe.

**Any manual / hand-built deploy MUST build with the Meta pixel env**, or the pixel is silently stripped from every
page (Meta PageView / InitiateCheckout / Purchase go dark — happened 2026-11-14):

```sh
PUBLIC_META_PIXEL_ID=2925124884553072 npm run build
# then rsync dist/ to BOTH WEB-01 (51.79.92.134) and WEB-02 (15.235.46.226):
#   rsync -avz --delete --rsync-path="sudo rsync" --chown=www-data:www-data dist/ ubuntu@<host>:/var/www/gulfislands.com/
```

Always deploy to BOTH boxes, else ~50% of requests drop the pixel. Verify after deploy: `https://gulfislands.com/`
and `https://gulfislands.com/email/` must each contain `connect.facebook.net` and `2925124884553072`
(the nightly site-seam check asserts this).

---

# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
