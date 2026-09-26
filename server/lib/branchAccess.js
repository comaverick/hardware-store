const isSuperAdmin = (user) => user?.role === "SUPER_ADMIN";

const getAssignedBranchId = (user) => user?.branch?._id || user?.branch || null;

const canAccessBranch = (user, branchId) => {
  if (isSuperAdmin(user)) return true;

  const assignedBranchId = getAssignedBranchId(user);
  return Boolean(
    assignedBranchId &&
      branchId &&
      String(assignedBranchId) === String(branchId),
  );
};

const branchFilter = (user) =>
  isSuperAdmin(user) ? {} : { branch: getAssignedBranchId(user) };

module.exports = {
  isSuperAdmin,
  getAssignedBranchId,
  canAccessBranch,
  branchFilter,
};
