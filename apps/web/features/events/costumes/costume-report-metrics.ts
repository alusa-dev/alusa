import type { CostumeAssignmentDTO, CostumeDTO } from '../events-service';

export function getCostumeReportMetrics(costumes: CostumeDTO[], assignments: CostumeAssignmentDTO[]) {
  const costumeCost = costumes.reduce((sum, costume) => sum + (costume.schoolCost ?? 0) * costume.quantity, 0);
  const separateAssignments = assignments.filter(
    (assignment) => assignment.status !== 'CANCELLED' && assignment.billingMode === 'SEPARATE_CHARGE',
  );
  const includedAssignments = assignments.filter(
    (assignment) => assignment.status !== 'CANCELLED' && assignment.billingMode === 'INCLUDED_IN_REGISTRATION_FEE',
  );

  return {
    costumeCost,
    separateExpectedRevenue: separateAssignments.reduce((sum, assignment) => sum + (assignment.chargedValue ?? 0), 0),
    separateReceivedRevenue: separateAssignments
      .filter((assignment) => assignment.isPaid)
      .reduce((sum, assignment) => sum + (assignment.chargedValue ?? 0), 0),
    includedAssignmentsCount: includedAssignments.length,
  };
}
