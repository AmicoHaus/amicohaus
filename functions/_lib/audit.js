// Records admin actions for accountability. Called from every admin-only
// mutation (deleting others' content, resolving reports, suspending users).
export async function logAdminAction(db, adminUserId, action, targetType, targetId, details) {
  await db.prepare(
    'INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(adminUserId, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null).run();
}
