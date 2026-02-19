import { defineCollection, z } from 'astro:content';

const directory = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    url: z.string().url().optional().or(z.string().length(0)),
    island: z.string(),
    category: z.string(),
    subcategory: z.string().optional(),
    description: z.string().optional(),
    title: z.string().optional(),
    featured: z.boolean().optional(),
    // Claim System Fields
    claimed: z.boolean().optional().default(false),
    tier: z.enum(['basic', 'featured', 'premium']).optional().default('basic'),
    owner_email: z.string().email().optional(),
    verified: z.boolean().optional().default(false),
    verified_date: z.string().optional(),
    // Premium Listing Fields
    gallery: z.array(z.string()).optional(),
    hours: z.record(z.string()).optional(),
    map: z.object({
      lat: z.number(),
      lng: z.number()
    }).optional(),
    description_long: z.string().optional(),
    social: z.object({
      instagram: z.string().optional(),
      facebook: z.string().optional(),
      twitter: z.string().optional(),
    }).optional(),
  }),
});

export const collections = {
  'directory': directory,
};
