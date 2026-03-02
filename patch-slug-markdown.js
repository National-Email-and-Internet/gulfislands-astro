import fs from 'fs';

const filePath = 'src/pages/directory/[slug].astro';
let content = fs.readFileSync(filePath, 'utf-8');

// Add the marked import at the top
if (!content.includes('import { marked }')) {
  content = content.replace(
    "import PremiumBadge from '../../components/badges/PremiumBadge.astro';",
    "import PremiumBadge from '../../components/badges/PremiumBadge.astro';\nimport { marked } from 'marked';"
  );
}

// Convert description_long before rendering
if (!content.includes('const renderedDescription =')) {
  const destructLine = 'const catLabel = categoryLabels[category] ?? category;';
  content = content.replace(
    destructLine,
    `${destructLine}\n\nconst renderedDescription = description_long ? marked.parse(description_long) : null;`
  );
}

// Replace the render block
content = content.replace(
  '{description_long ? (\n                <div set:html={description_long} />',
  '{renderedDescription ? (\n                <div set:html={renderedDescription} />'
);

fs.writeFileSync(filePath, content);
console.log("Slug page updated with marked parser.");
