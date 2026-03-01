import fsPromises from 'fs/promises';
import path from 'path';

const ROOT = '/home/clawd/projects/astro-sites/gulfislands';
const CONTENT_DIR = path.join(ROOT, 'src/content/directory');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

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
    return rawText;
  }
}

async function processListings() {
  const files = await fsPromises.readdir(CONTENT_DIR);
  let processed = 0;

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    
    const filePath = path.join(CONTENT_DIR, file);
    const fileContent = await fsPromises.readFile(filePath, 'utf-8');
    
    if (fileContent.includes('description_long: |') && !fileContent.includes('_description_formatted: true')) {
      console.log(`Processing: ${file}`);
      
      const match = fileContent.match(/description_long: \|\n([\s\S]*?)(\n[a-z_]+:|$)/);
      if (match) {
        const rawDesc = match[1];
        
        if(rawDesc.includes('<p>') || rawDesc.includes('DINING:') || rawDesc.includes('SPECTACULAR')){
            const newDesc = await formatDescription(rawDesc.trim());
            console.log("Formatted " + file);
            
            const lines = newDesc.split('\n');
            const indentedDesc = lines.map(line => '  ' + line).join('\n');
            
            let updatedContent = fileContent.replace(
                `description_long: |\n${rawDesc}`,
                `description_long: |\n${indentedDesc}\n`
            );
            
            updatedContent = updatedContent.replace(
                'description_long: |',
                '_description_formatted: true\ndescription_long: |'
            );
            
            await fsPromises.writeFile(filePath, updatedContent);
            processed++;
            await new Promise(r => setTimeout(r, 500));
        }
      }
    }
  }
  
  console.log(`\n✅ Finished formatting ${processed} descriptions.`);
}

processListings().catch(console.error);
