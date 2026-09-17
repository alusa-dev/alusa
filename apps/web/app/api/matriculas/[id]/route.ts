import {
  deleteMatriculaRoute,
  getMatriculaRoute,
  patchMatriculaRoute,
} from '@/src/server/matriculas/matricula-operations-http.service';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return getMatriculaRoute(req, ctx);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return patchMatriculaRoute(req, ctx);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return deleteMatriculaRoute(req, ctx);
}
