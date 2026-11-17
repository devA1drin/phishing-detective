// Educator data scoping: educators see only students in sections they own; superadmins see everyone.
export class ScopeError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function adminScope(repo, admin, sectionParam) {
  const sections = await repo.listSections();
  const isSuper = admin.role === 'superadmin';
  const own = isSuper ? sections : sections.filter((s) => s.owner_admin_id === admin.id);
  let chosen = own;
  if (sectionParam !== undefined && sectionParam !== null && sectionParam !== '' && sectionParam !== 'all') {
    const s = own.find((x) => String(x.id) === String(sectionParam));
    if (!s) throw new ScopeError(sections.some((x) => String(x.id) === String(sectionParam)) ? 403 : 404, 'Section not found in your classes');
    chosen = [s];
  }
  const all = isSuper && chosen === own;
  const ids = new Set(chosen.map((s) => s.id));
  const playerIds = all ? null : new Set((await repo.listPlayerSections()).filter((p) => ids.has(p.section_id)).map((p) => Number(p.id)));
  return {
    all, isSuper, sections: own, chosen,
    label: all ? 'All participants' : chosen.length === 1 ? chosen[0].name : chosen.length ? `${chosen.length} sections (${chosen.map((s) => s.name).join(', ')})` : 'No sections yet',
    has: (pid) => all || playerIds.has(Number(pid)),
  };
}
