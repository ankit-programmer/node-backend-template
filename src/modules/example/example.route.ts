// TEMPLATE: demo feature slice — copy this module's layout (route/service/schema) for real features, then delete it.
import { Router } from 'express';
import { AuthMethod, auth } from '../../middleware/auth';
import { ok } from '../../utility/response';
import { createExampleSchema, exampleParamsSchema } from './example.schema';
import { createExample, getExample } from './example.service';

export const exampleRouter = Router();

// No try/catch needed: Express 5 forwards sync throws and async rejections
// (including zod .parse failures) to the global error handler.
exampleRouter.get('/:id', auth([AuthMethod.API_KEY]), async (req, res) => {
    const { id } = exampleParamsSchema.parse(req.params);
    const { value, cached } = await getExample(id);
    res.json(ok(value, { cached }));
});

exampleRouter.post('/', auth([AuthMethod.API_KEY]), async (req, res) => {
    const input = createExampleSchema.parse(req.body);
    const created = await createExample(input);
    res.status(201).json(ok(created));
});
