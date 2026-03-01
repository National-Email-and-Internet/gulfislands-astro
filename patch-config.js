import fs from 'fs';

const configPath = 'src/content/config.ts';
let config = fs.readFileSync(configPath, 'utf-8');

const fieldsToAdd = `
    phone: z.string().optional(),
    email: z.string().email().or(z.string().length(0)).optional(),
    address: z.string().optional(),
    // Premium Listing Fields`;

config = config.replace('// Premium Listing Fields', fieldsToAdd);

fs.writeFileSync(configPath, config);
console.log("Config updated.");
