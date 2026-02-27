// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.gulfislands.com',
  integrations: [
    sitemap({
      // Exclude claim-listing and submit-listing pages (noindex forms)
      filter: (page) => 
        !page.includes('/claim-listing/') && 
        !page.includes('/submit-listing'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  },
  redirects: {
    // Legacy .html category pages → new directory structure
    '/Food.html': { destination: '/directory/eat/', status: 301 },
    '/Construction.html': { destination: '/directory/trades/', status: 301 },
    '/Education.html': { destination: '/directory/education/', status: 301 },
    '/Health.html': { destination: '/directory/health/', status: 301 },
    '/Services.html': { destination: '/directory/services/', status: 301 },
    '/Shopping.html': { destination: '/directory/shopping/', status: 301 },
    '/FarmGarden.html': { destination: '/directory/farms/', status: 301 },
    '/Legal.html': { destination: '/directory/services/', status: 301 },
    '/Marine.html': { destination: '/directory/marine/', status: 301 },
    '/Community.html': { destination: '/directory/community/', status: 301 },
    '/Organizations.html': { destination: '/directory/community/', status: 301 },
    '/News_GI.html': { destination: '/directory/news/', status: 301 },
    '/transportation.html': { destination: '/directory/getting-here/', status: 301 },
    '/realestate.html': { destination: '/directory/real-estate/', status: 301 },
    '/Recreation.html': { destination: '/directory/activities/', status: 301 },
    '/www_general.html': { destination: '/', status: 301 },
    '/ad_text_1.html': { destination: '/', status: 301 },
    '/Construction_Architects.html': { destination: '/directory/trades/', status: 301 },
    '/arts&crafts_ssi_music.html': { destination: '/directory/arts-culture/', status: 301 },
    '/arts&crafts_saturna.html': { destination: '/directory/arts-culture/', status: 301 },
  }
});
