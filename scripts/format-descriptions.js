import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import * as matter from 'gray-matter';

const ROOT = '/home/clawd/projects/astro-sites/gulfislands';
const CONTENT_DIR = path.join(ROOT, 'src/content/directory');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY");
  process.exit(1);
}

async function formatDescription(rawText) {
  const prompt = `You are an expert copywriter formatting directory listings for a premium travel website.
Take the following raw description text and format it into clean, readable Markdown.

RULES:
1. DO NOT change facts, invent information, or remove important details.
2. Convert "ALL CAPS" headers (like "DINING:" or "SPA:") into bold inline titles (e.g. "**Dining:**") or ### headings.
3. Fix aggressive title casing/all-caps ("SPECTACULAR CONDO" -> "Spectacular condo").
4. Add appropriate paragraph spacing.
5. Use bullet points for lists of amenities or features if it makes sense.
6. Make it read smoothly and luxuriously but strictly adhere to the original facts.
7. Return ONLY the markdown. No conversational filler, no code block wrappers (do not use \`\`\`markdown ... \`\`\`).

RAW TEXT:
${rawText}
`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://gulfislands.com',
        'X-Title': 'GulfIslands Formatter'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });

    if (!res.ok) throw new Error(`API Error ${res.status}: ${await res.text()}`);
    
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (err) {
    console.error('Error formatting description:', err);
    return rawText; // Fallback to original
  }
}

async function processListings() {
  const files = await fsPromises.readdir(CONTENT_DIR);
  let processed = 0;

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    
    const filePath = path.join(CONTENT_DIR, file);
    const fileContent = await fsPromises.readFile(filePath, 'utf-8');
    
    // Parse the file
    const parsed = matter(fileContent);
    const { data: frontmatter, content: bodyContent } = parsed;

    if (frontmatter.description_long && !frontmatter._description_formatted) {
      console.log(`Processing: ${file}`);
      
      const newDesc = await formatDescription(frontmatter.description_long);
      
      // Update frontmatter
      frontmatter.description_long = newDesc;
      frontmatter._description_formatted = true; // Temporary flag to avoid re-processing
      
      // Stringify back to markdown
      // Note: matter.stringify can sometimes use different yaml styling, 
      // but it'll be valid. To be safe with long text, we can let gray-matter handle it.
      const newFileContent = matter.stringify(bodyContent, frontmatter, {
        lineWidth: -1 // prevents line wrapping in yaml
      });
      
      await fsPromises.writeFile(filePath, newFileContent);
      processed++;
      
      // Be nice to the API
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  console.log(`\n✅ Finished formatting ${processed} descriptions.`);
}

processListings().catch(console.error);
