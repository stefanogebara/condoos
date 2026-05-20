import { Router } from 'express';
import { AuthedRequest, getActiveCondoId, requireAuth, requireBoardCapability } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { MEMORY_TYPES, MemoryType, searchBuildingMemory } from '../lib/memory';

const router = Router();

function parseTypes(value: unknown): MemoryType[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const allowed = new Set<string>(MEMORY_TYPES);
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is MemoryType => allowed.has(item));
}

router.get('/', requireAuth, requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  if (!condoId) return fail(res, 'missing_condo', 400);
  if (req.user!.role === 'concierge') return fail(res, 'forbidden', 403);
  const limit = Number(req.query.limit || 40);
  const result = searchBuildingMemory({
    condoId,
    userId: req.user!.id,
    role: req.user!.role as 'resident' | 'board_admin' | 'concierge',
    query: String(req.query.query || ''),
    types: parseTypes(req.query.types),
    limit: Number.isFinite(limit) ? limit : 40,
  });
  return ok(res, result);
});

export default router;
