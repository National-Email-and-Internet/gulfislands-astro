import fs from 'fs';

const filePath = 'src/pages/directory/[slug].astro';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Update destructuring to include new fields
content = content.replace(
  'const { name, category, subcategory, island, description, description_long, url, tier, claimed, gallery, hours, social, map } = entry.data;',
  'const { name, category, subcategory, island, description, description_long, url, tier, claimed, gallery, hours, social, map, phone, email, address } = entry.data;'
);

// 2. Logic for hero image vs logo
const logicToAdd = `
// Determine hero image vs logo
let heroImage = null;
let logoImage = null;
let galleryImages = [];

if (gallery && gallery.length > 0) {
  const isLogo = (img) => img.toLowerCase().includes('logo') || img.toLowerCase().includes('avatar');
  
  if (isLogo(gallery[0])) {
    logoImage = gallery[0];
    if (gallery.length > 1 && !isLogo(gallery[1])) {
      heroImage = gallery[1];
      galleryImages = gallery.slice(2);
    } else {
      galleryImages = gallery.slice(1);
    }
  } else {
    heroImage = gallery[0];
    galleryImages = gallery.slice(1);
    // Find a logo if one exists further down (edge case)
    const logoIndex = gallery.findIndex(isLogo);
    if (logoIndex > 0) {
      logoImage = gallery[logoIndex];
      galleryImages = galleryImages.filter(img => img !== logoImage);
    }
  }
}
`;

content = content.replace('const catLabel = categoryLabels[category] ?? category;', 'const catLabel = categoryLabels[category] ?? category;\n' + logicToAdd);

// 3. Update the layout to include the hero banner
const heroBannerHtml = `
  {heroImage ? (
    <div class="w-full h-64 md:h-80 lg:h-96 relative overflow-hidden bg-ocean-900 border-b border-gray-200">
      <img src={heroImage} alt={name} class="w-full h-full object-cover opacity-80" />
      <div class="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-gray-900/40 to-transparent"></div>
      <div class="absolute bottom-0 left-0 right-0 p-8 max-w-5xl mx-auto flex items-end justify-between">
        <div class="flex items-center gap-6">
          {logoImage && (
            <div class="w-24 h-24 rounded-2xl bg-white p-2 shadow-xl shrink-0 border-4 border-white/20 hidden sm:block">
              <img src={logoImage} alt={name + " logo"} class="w-full h-full object-contain" />
            </div>
          )}
          <div>
            <div class="flex flex-wrap items-center gap-3 mb-2">
              <span class="bg-white/20 backdrop-blur-md text-white text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest">{catLabel}</span>
              <span class="bg-ocean-600/80 backdrop-blur-md text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest">{island}</span>
              {tier === 'premium' && <PremiumBadge />}
              {claimed && <VerifiedBadge />}
            </div>
            <h1 class="font-['Playfair_Display'] text-3xl md:text-5xl font-bold text-white drop-shadow-md">{name}</h1>
          </div>
        </div>
      </div>
    </div>
  ) : (
    <div class="bg-ocean-900 py-12 border-b border-ocean-800">
      <div class="max-w-5xl mx-auto px-6 flex items-center gap-6">
        {logoImage && (
            <div class="w-20 h-20 rounded-2xl bg-white p-2 shadow-lg shrink-0">
              <img src={logoImage} alt={name + " logo"} class="w-full h-full object-contain" />
            </div>
        )}
        <div>
          <div class="flex flex-wrap items-center gap-3 mb-3">
            <span class="bg-white/10 text-white text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest">{catLabel}</span>
            <span class="bg-ocean-600/80 text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest">{island}</span>
            {tier === 'premium' && <PremiumBadge />}
            {claimed && <VerifiedBadge />}
          </div>
          <h1 class="font-['Playfair_Display'] text-3xl md:text-5xl font-bold text-white">{name}</h1>
        </div>
      </div>
    </div>
  )}
`;

content = content.replace(
  '<section class="py-12 bg-gray-50 min-h-screen">',
  heroBannerHtml + '\n  <section class="py-8 md:py-12 bg-gray-50 min-h-screen">'
);

// 4. Remove original header from inside the content column
const originalHeaderRegex = /<div class="bg-white rounded-3xl p-8 md:p-10 shadow-sm border border-gray-100">\s*<div class="flex flex-wrap items-center gap-3 mb-4">[\s\S]*?<\/div>\s*<h1 class="font-\['Playfair_Display'\] text-4xl md:text-5xl font-bold text-gray-900 mb-6">{name}<\/h1>/;

content = content.replace(originalHeaderRegex, '<div class="bg-white rounded-3xl p-8 md:p-10 shadow-sm border border-gray-100">');

// 5. Update the gallery grid to use the remaining images
const oldGalleryHtml = `
          <!-- Gallery -->
          {gallery && gallery.length > 0 && (
            <div class="bg-white rounded-3xl p-8 md:p-10 shadow-sm border border-gray-100">
              <h2 class="font-['Playfair_Display'] text-2xl font-bold text-gray-900 mb-6">Photos</h2>
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                {gallery.map((img, i) => (
                  <div class={\`rounded-xl overflow-hidden bg-gray-100 \${i === 0 ? 'col-span-2 md:col-span-2 aspect-[16/9]' : 'aspect-square'}\`}>
                    <img
                      src={img}
                      alt={\`\${name} photo \${i + 1}\`}
                      class="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                      loading={i === 0 ? 'eager' : 'lazy'}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
`;

const newGalleryHtml = `
          <!-- Gallery -->
          {galleryImages.length > 0 && (
            <div class="bg-white rounded-3xl p-8 md:p-10 shadow-sm border border-gray-100">
              <h2 class="font-['Playfair_Display'] text-2xl font-bold text-gray-900 mb-6">Photos</h2>
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                {galleryImages.map((img, i) => (
                  <div class="aspect-square rounded-xl overflow-hidden bg-gray-100">
                    <img
                      src={img}
                      alt={name + " photo " + (i + 1)}
                      class="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
`;

content = content.replace(oldGalleryHtml, newGalleryHtml);


// 6. Update Contact Sidebar to include new fields
const contactInfoHtml = `
            <div class="space-y-4">
              {address && (
                <div class="flex items-start gap-3 p-3 bg-white border border-gray-100 rounded-2xl w-full">
                   <div class="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center shrink-0 text-gray-500">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                   </div>
                   <div class="min-w-0 pt-0.5">
                     <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Address</p>
                     <p class="text-sm font-medium text-gray-900 leading-snug">{address}</p>
                   </div>
                </div>
              )}
              {phone && (
                <a href={"tel:" + phone.replace(/[^0-9+]/g, '')} class="flex items-center gap-3 text-ocean-600 hover:text-ocean-800 transition group p-3 bg-ocean-50 rounded-2xl w-full">
                  <div class="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm text-ocean-600 shrink-0">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                  </div>
                  <div class="min-w-0">
                    <p class="text-[10px] font-bold text-ocean-900 uppercase tracking-tighter">Phone</p>
                    <p class="text-sm font-medium truncate">{phone}</p>
                  </div>
                </a>
              )}
              {email && (
                <a href={"mailto:" + email} class="flex items-center gap-3 text-ocean-600 hover:text-ocean-800 transition group p-3 bg-ocean-50 rounded-2xl w-full">
                  <div class="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm text-ocean-600 shrink-0">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                  </div>
                  <div class="min-w-0">
                    <p class="text-[10px] font-bold text-ocean-900 uppercase tracking-tighter">Email</p>
                    <p class="text-sm font-medium truncate ">{email}</p>
                  </div>
                </a>
              )}
              
              {url && (
`;

content = content.replace(
  '<div class="space-y-4">\n              {url && (',
  contactInfoHtml
);


// 7. Update Maps integration
const mapHtml = `
          <!-- Map -->
          {map && (
            <div class="bg-white rounded-3xl p-3 shadow-sm border border-gray-100 overflow-hidden">
               <iframe
                 width="100%"
                 height="250"
                 style="border:0;"
                 loading="lazy"
                 allowfullscreen
                 referrerpolicy="no-referrer-when-downgrade"
                 src={"https://www.google.com/maps/embed/v1/place?key=" + (import.meta.env.PUBLIC_GOOGLE_MAPS_KEY || 'AIzaSyA_FAKE_KEY_FOR_DEV') + "&q=" + map.lat + "," + map.lng + "&zoom=15"}>
               </iframe>
            </div>
          )}
`;
const oldMapHtml = `
          <!-- Map (Premium Only) -->
          {tier === 'premium' && map && (
            <div class="bg-white rounded-3xl p-2 shadow-sm border border-gray-100 overflow-hidden">
              <div class="bg-gray-100 aspect-square rounded-2xl flex items-center justify-center text-gray-400">
                <p class="text-xs text-center p-4">Google Maps Placeholder<br/>(Lat: {map.lat}, Lng: {map.lng})</p>
              </div>
            </div>
          )}
`;
content = content.replace(oldMapHtml, mapHtml);

fs.writeFileSync(filePath, content);
console.log("Slug page updated.");
