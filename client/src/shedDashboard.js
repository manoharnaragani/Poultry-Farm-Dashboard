export function getShedData(state, shedId) {
  const shed = state.sheds.find((row) => String(row.id) === String(shedId));
  if (!shed) return null;
  const workers = state.workers.filter((row) => row.assignedShed === shed.name);
  const workerIds = new Set(workers.map((row) => String(row.id)));
  return {
    shed, workers,
    attendance: state.attendance.filter((row) => workerIds.has(String(row.workerId))),
    eggs: state.eggs.filter((row) => row.shed === shed.name),
    mortality: state.mortality.filter((row) => row.shed === shed.name),
    feedUsage: state.feedUsage.filter((row) => row.shed === shed.name),
    expenses: state.expenses.filter((row) => row.shed === shed.name),
  };
}
