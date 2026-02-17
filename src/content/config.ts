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
  }),
});

export const collections = {
  'directory': directory,
};
