import express from 'express';
import typesenseClient from '../../config/typesense';
import { APIResponseBuilder } from '../../utility';

const router = express.Router();

const collectionName = 'companies';

const schema = {
  name: collectionName,
  fields: [
    { name: 'company_name', type: 'string' as const },
    { name: 'num_employees', type: 'int32' as const },
    { name: 'country', type: 'string' as const, facet: true },
  ],
  default_sorting_field: 'num_employees',
};

// Initialize collection and seed data
router.post('/init', async (req, res, next) => {
  try {
    // Delete if exists
    try {
      await typesenseClient.collections(collectionName).delete();
    } catch (err) {
      // Ignore if not found
    }

    await typesenseClient.collections().create(schema);

    const documents = [
      {
        id: '124',
        company_name: 'Stark Industries',
        num_employees: 5215,
        country: 'USA',
      },
      {
        id: '125',
        company_name: 'Acme Corp',
        num_employees: 1002,
        country: 'France',
      },
    ];

    await typesenseClient.collections(collectionName).documents().import(documents, { action: 'create' });

    res.json(new APIResponseBuilder().setSuccess({ message: 'Collection created and seeded' }).build());
  } catch (error) {
    next(error);
  }
});

// Search
router.get('/query', async (req, res, next) => {
  try {
    const { q } = req.query;
    
    const searchParameters = {
      q: (q as string) || '*',
      query_by: 'company_name',
      filter_by: 'num_employees:>100',
      sort_by: 'num_employees:desc'
    };

    const searchResults = await typesenseClient
      .collections(collectionName)
      .documents()
      .search(searchParameters);

    res.json(new APIResponseBuilder().setSuccess(searchResults).build());
  } catch (error) {
    next(error);
  }
});

// Health check
router.get('/health', async (req, res, next) => {
  try {
    const health = await typesenseClient.health.retrieve();
    res.json(new APIResponseBuilder().setSuccess(health).build());
  } catch (error) {
    next(error);
  }
});

export default router;